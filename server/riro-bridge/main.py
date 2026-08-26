import asyncio
import hashlib
import hmac
import logging
import math
import os
import platform
import re
import sys
import threading
import time
import unicodedata
from contextlib import asynccontextmanager
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any, AsyncIterator, Optional
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError


RIRO_ORIGIN = "https://iscience.riroschool.kr"
USER_AGENT = "Mozilla/5.0 (compatible; IntactRiroBridge/1.0)"
BRIDGE_CONTRACT_VERSION = "2"
MINIMUM_PYTHON_VERSION = (3, 11)
MAX_CLOCK_SKEW_SECONDS = 60
NONCE_TTL_SECONDS = 180
MAX_BODY_BYTES = 4096
MAX_LOGIN_RESPONSE_BYTES = 64_000
MAX_PROFILE_RESPONSE_BYTES = 2_000_000
MAX_CONCURRENT_AUTHENTICATIONS = 8
UPSTREAM_ATTEMPTS = 2
UPSTREAM_DEADLINE_SECONDS = 18.0
DEFAULT_RETRY_DELAY_SECONDS = 0.4
MAX_RETRY_AFTER_SECONDS = 5.0
CIRCUIT_FAILURE_THRESHOLD = 3
CIRCUIT_RECOVERY_SECONDS = 15.0
RETRYABLE_HTTP_STATUSES = frozenset({429, 500, 502, 503, 504})
HTTP_TIMEOUT = httpx.Timeout(connect=3.0, read=7.0, write=3.0, pool=2.0)
HTTP_LIMITS = httpx.Limits(max_connections=16, max_keepalive_connections=8)
logger = logging.getLogger("riro_bridge")
KOREA_TIME_ZONE = ZoneInfo("Asia/Seoul")


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    id: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class InvalidCredentials(Exception):
    pass


class PayloadTooLarge(Exception):
    pass


class UpstreamUnavailable(Exception):
    def __init__(
        self,
        category: str,
        *,
        retryable: bool = True,
        status: Optional[int] = None,
        retry_after: Optional[float] = None,
    ) -> None:
        super().__init__(category)
        self.category = category
        self.retryable = retryable
        self.status = status
        self.retry_after = retry_after


class CircuitOpen(UpstreamUnavailable):
    def __init__(self, retry_after: float) -> None:
        super().__init__(
            "circuit_open",
            retryable=False,
            retry_after=max(1.0, retry_after),
        )


class CircuitBreaker:
    """A small lock-protected breaker with a single half-open probe."""

    def __init__(self, failure_threshold: int, recovery_seconds: float) -> None:
        self._failure_threshold = failure_threshold
        self._recovery_seconds = recovery_seconds
        self._failures = 0
        self._opened_until = 0.0
        self._probe_in_flight = False
        self._lock = asyncio.Lock()

    async def before_call(self, now: float) -> bool:
        async with self._lock:
            if self._opened_until <= 0:
                return False
            if now < self._opened_until:
                raise CircuitOpen(self._opened_until - now)
            if self._probe_in_flight:
                raise CircuitOpen(1.0)
            self._probe_in_flight = True
            return True

    async def record_success(self, was_probe: bool) -> None:
        async with self._lock:
            self._failures = 0
            self._opened_until = 0.0
            if was_probe:
                self._probe_in_flight = False

    async def record_failure(self, now: float, was_probe: bool) -> Optional[float]:
        async with self._lock:
            self._failures += 1
            if was_probe or self._failures >= self._failure_threshold:
                self._opened_until = now + self._recovery_seconds
                self._probe_in_flight = False
                return self._recovery_seconds
            return None

    async def cancel_probe(self, was_probe: bool) -> None:
        if not was_probe:
            return
        async with self._lock:
            self._probe_in_flight = False

    async def snapshot(self, now: float) -> dict[str, Any]:
        async with self._lock:
            if self._opened_until <= 0:
                state = "closed"
                retry_after = 0
            elif now < self._opened_until:
                state = "open"
                retry_after = max(1, math.ceil(self._opened_until - now))
            else:
                state = "half_open"
                retry_after = 0
            return {"state": state, "retryAfterSeconds": retry_after}


class StatelessCookies(httpx.Cookies):
    """Prevent a shared client from retaining one student's upstream session."""

    def extract_cookies(self, response: httpx.Response) -> None:
        return None


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    _validate_runtime()
    application.state.bridge_secret = _bridge_secret()
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        limits=HTTP_LIMITS,
        follow_redirects=False,
        headers={"User-Agent": USER_AGENT},
        trust_env=False,
    ) as client:
        client.cookies = StatelessCookies()
        application.state.riro_client = client
        application.state.riro_semaphore = asyncio.BoundedSemaphore(
            MAX_CONCURRENT_AUTHENTICATIONS
        )
        application.state.riro_circuit = CircuitBreaker(
            CIRCUIT_FAILURE_THRESHOLD,
            CIRCUIT_RECOVERY_SECONDS,
        )
        yield


app = FastAPI(
    title="Intact Riroschool Bridge",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

_seen_nonces: dict[str, float] = {}
_nonce_lock = threading.Lock()


def _bridge_secret() -> bytes:
    secret = os.environ.get("RIRO_BRIDGE_SECRET", "")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", secret):
        raise RuntimeError("RIRO_BRIDGE_SECRET must be a 64-character hexadecimal value")
    return secret.encode("utf-8")


def _validate_runtime() -> None:
    if sys.version_info < MINIMUM_PYTHON_VERSION:
        raise RuntimeError("Python 3.11 or newer is required")


def _json_error(
    status: int,
    code: str,
    message: str,
    *,
    headers: Optional[dict[str, str]] = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"ok": False, "error": {"code": code, "message": message}},
        headers={"Cache-Control": "no-store", **(headers or {})},
    )


def _consume_nonce(nonce: str, now: float) -> bool:
    with _nonce_lock:
        expired = [value for value, expires_at in _seen_nonces.items() if expires_at <= now]
        for value in expired:
            _seen_nonces.pop(value, None)
        if nonce in _seen_nonces:
            return False
        _seen_nonces[nonce] = now + NONCE_TTL_SECONDS
        return True


def _verify_request(
    body: bytes,
    timestamp_text: str,
    nonce: str,
    signature: str,
    secret: Optional[bytes] = None,
) -> bool:
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,128}", nonce):
        return False
    if not re.fullmatch(r"[0-9a-f]{64}", signature):
        return False
    try:
        timestamp = int(timestamp_text)
    except ValueError:
        return False
    now = int(time.time())
    if abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS:
        return False
    body_hash = hashlib.sha256(body).hexdigest()
    signed = f"{timestamp_text}.{nonce}.{body_hash}".encode("utf-8")
    expected = hmac.new(secret or _bridge_secret(), signed, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return False
    return _consume_nonce(nonce, float(now))


def _normalize_student_number(raw: str) -> Optional[str]:
    separated = re.search(r"([1-3])\D+([1-9])\D+(\d{1,2})(?:\D|$)", raw)
    if separated:
        normalized = f"{separated.group(1)}{separated.group(2)}{separated.group(3).zfill(2)}"
    else:
        digits = re.sub(r"\D", "", raw)
        normalized = f"{digits[:2]}0{digits[2:]}" if len(digits) == 3 else digits
    if not re.fullmatch(r"[1-3][1-9]\d{2}", normalized):
        return None
    number = int(normalized[2:])
    return normalized if 1 <= number <= 40 else None


def _generation_from_id(riro_id: str) -> Optional[int]:
    match = re.match(r"^(\d{2})", riro_id)
    if not match:
        return None
    year = int(match.group(1))
    entry_year = 1900 + year if year >= 90 else 2000 + year
    generation = entry_year - 1994 + 1
    return generation if 1 <= generation <= 99 else None


def _current_korean_school_year(now: Optional[datetime] = None) -> int:
    current = now.astimezone(KOREA_TIME_ZONE) if now else datetime.now(KOREA_TIME_ZONE)
    return current.year - 1 if current.month < 3 else current.year


def _cohort_is_plausible(generation: int, grade: int, school_year: int) -> bool:
    # Generation 1 entered in 1994. The Korean school year changes in March.
    entry_year = generation + 1993
    expected_grade = school_year - entry_year + 1
    return 1 <= grade <= 3 and grade == expected_grade


def _element_values(element: Any) -> list[str]:
    """Read visible form content from both the legacy div and current input layouts."""
    values: list[str] = []
    if element is None:
        return values
    text = element.get_text(" ", strip=True)
    if text:
        values.append(text)
    for field in [element, *element.select("input, textarea, select")]:
        value = field.get("value")
        if isinstance(value, str) and value.strip():
            values.append(value.strip())
    return list(dict.fromkeys(values))


def _name_from_values(values: list[str]) -> Optional[str]:
    ignored = {
        "학생", "교사", "학부모", "관리자", "이름", "성명", "회원정보",
        "인천과학고", "인천과학고등학교",
    }
    for raw in values:
        normalized = unicodedata.normalize("NFKC", raw).strip()
        normalized = re.sub(r"\s+(?:학생|교사|학부모|관리자)$", "", normalized).strip()
        if normalized in ignored:
            continue
        if re.fullmatch(r"[\uac00-\ud7a3A-Za-z .'-]{2,40}", normalized):
            return normalized
        for candidate in re.findall(r"[\uac00-\ud7a3]{2,8}", normalized):
            if candidate not in ignored:
                return candidate
    return None


def _normalize_student_role(raw: str) -> Optional[str]:
    normalized = unicodedata.normalize("NFKC", raw).strip()
    normalized = re.sub(r"\s+", " ", normalized)
    return "학생" if normalized == "학생" else None


def _entry_student_number_from_id(riro_id: str) -> Optional[str]:
    """Read the immutable first-year class/number from IDs such as 26-10218."""
    compact = re.sub(r"[^0-9]", "", riro_id)
    match = re.fullmatch(r"\d{2}(1)0?([1-4])(\d{2})", compact)
    if not match:
        return None
    normalized = _normalize_student_number("".join(match.groups()))
    if not normalized or not 1 <= int(normalized[2:]) <= 20:
        return None
    return normalized


def _parse_profile(
    html: str,
    submitted_id: str,
    *,
    school_year: Optional[int] = None,
) -> Optional[dict[str, Any]]:
    if len(html) > 2_000_000:
        return None
    soup = BeautifulSoup(html, "html.parser")
    profile_elements = soup.select(
        ".input_disabled, input[name='my_num'], .my_page_name, .user_stu"
    )
    profile_values = [
        value
        for element in profile_elements
        for value in _element_values(element)
    ]

    effective_id = submitted_id
    for identity in soup.select(".elem_fix"):
        for identity_text in _element_values(identity):
            if re.match(r"^\d{2}[-_]?\d", identity_text):
                effective_id = identity_text
                break

    name = _name_from_values(profile_values)
    entry_student_number = _entry_student_number_from_id(effective_id)
    current_student_number = next(
        (
            normalized
            for value in profile_values
            if (normalized := _normalize_student_number(value))
        ),
        None,
    ) or entry_student_number
    generation = _generation_from_id(effective_id)
    role_element = soup.select_one("span.m_level3") or soup.select_one("span.m_level1")
    role = _normalize_student_role(role_element.get_text(" ", strip=True)) if role_element else None

    if not name or not re.fullmatch(r"[가-힣A-Za-z .'-]{2,40}", name):
        return None
    if not entry_student_number or not current_student_number or not generation or not role:
        return None
    effective_school_year = (
        school_year if school_year is not None else _current_korean_school_year()
    )
    if not _cohort_is_plausible(
        generation,
        int(current_student_number[0]),
        effective_school_year,
    ):
        return None
    return {
        "name": name,
        "entryStudentNumber": entry_student_number,
        "currentStudentNumber": current_student_number,
        "generation": generation,
        "role": role[:40],
    }


def _retry_after_seconds(response: httpx.Response) -> Optional[float]:
    value = response.headers.get("retry-after", "").strip()
    if not value:
        return None
    try:
        delay = float(value)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
            delay = retry_at.timestamp() - time.time()
        except (TypeError, ValueError, OverflowError):
            return None
    if not math.isfinite(delay):
        return None
    return min(MAX_RETRY_AFTER_SECONDS, max(0.0, delay))


async def _read_request_body(request: Request, max_bytes: int) -> bytes:
    declared_length = request.headers.get("content-length", "").strip()
    if declared_length.isdigit() and int(declared_length) > max_bytes:
        raise PayloadTooLarge()
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > max_bytes:
            raise PayloadTooLarge()
        body.extend(chunk)
    return bytes(body)


async def _post_with_deadline(
    client: httpx.AsyncClient,
    url: str,
    *,
    deadline: float,
    headers: dict[str, str],
    data: dict[str, str],
    accepted_statuses: frozenset[int],
    status_error_category: str,
    max_response_bytes: int,
    too_large_category: str,
) -> httpx.Response:
    remaining = deadline - asyncio.get_running_loop().time()
    if remaining <= 0:
        raise UpstreamUnavailable("deadline_exhausted")
    try:
        async with asyncio.timeout(remaining):
            async with client.stream("POST", url, headers=headers, data=data) as response:
                if response.status_code not in accepted_statuses:
                    raise _status_error(status_error_category, response)
                declared_length = response.headers.get("content-length", "").strip()
                if declared_length.isdigit() and int(declared_length) > max_response_bytes:
                    raise UpstreamUnavailable(too_large_category)
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(content) + len(chunk) > max_response_bytes:
                        raise UpstreamUnavailable(too_large_category)
                    content.extend(chunk)
                return httpx.Response(
                    status_code=response.status_code,
                    headers=response.headers,
                    content=bytes(content),
                    request=response.request,
                )
    except (TimeoutError, httpx.TimeoutException) as error:
        raise UpstreamUnavailable("timeout") from error
    except httpx.RequestError as error:
        raise UpstreamUnavailable("network_error") from error


def _status_error(category: str, response: httpx.Response) -> UpstreamUnavailable:
    return UpstreamUnavailable(
        category,
        retryable=response.status_code in RETRYABLE_HTTP_STATUSES,
        status=response.status_code,
        retry_after=_retry_after_seconds(response),
    )


async def _authenticate_attempt(
    client: httpx.AsyncClient,
    user_id: str,
    password: str,
    deadline: float,
) -> dict[str, Any]:
    headers = {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
    }
    login_response = await _post_with_deadline(
        client,
        f"{RIRO_ORIGIN}/ajax.php",
        deadline=deadline,
        headers=headers,
        data={
            "app": "user",
            "mode": "login",
            "userType": "1",
            "id": user_id,
            "pw": password,
            "deeplink": "",
            "redirect_link": "",
        },
        accepted_statuses=frozenset({200}),
        status_error_category="login_http",
        max_response_bytes=MAX_LOGIN_RESPONSE_BYTES,
        too_large_category="login_too_large",
    )
    try:
        payload = login_response.json()
    except ValueError as error:
        raise UpstreamUnavailable("login_malformed_json") from error
    if not isinstance(payload, dict):
        raise UpstreamUnavailable("login_invalid_shape")

    code = str(payload.get("code", ""))
    if code in {"400", "902"}:
        raise InvalidCredentials()
    token = payload.get("token")
    if code != "000" or not isinstance(token, str) or not token:
        raise UpstreamUnavailable("login_unexpected_code")
    if len(token) > 4096 or not re.fullmatch(
        r"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+",
        token,
    ):
        raise UpstreamUnavailable("login_invalid_token")

    profile_response = await _post_with_deadline(
        client,
        f"{RIRO_ORIGIN}/user.php",
        deadline=deadline,
        headers={**headers, "Cookie": f"cookie_token={token}"},
        data={"pw": password},
        accepted_statuses=frozenset({200, 302}),
        status_error_category="profile_http",
        max_response_bytes=MAX_PROFILE_RESPONSE_BYTES,
        too_large_category="profile_too_large",
    )
    try:
        profile = _parse_profile(profile_response.text, user_id)
    except Exception as error:
        raise UpstreamUnavailable("profile_parse_error") from error
    if not profile:
        raise UpstreamUnavailable("profile_malformed")
    return profile


async def _authenticate_riro(
    client: httpx.AsyncClient,
    semaphore: asyncio.BoundedSemaphore,
    circuit: CircuitBreaker,
    user_id: str,
    password: str,
    *,
    deadline_seconds: float = UPSTREAM_DEADLINE_SECONDS,
) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + deadline_seconds
    was_probe = await circuit.before_call(loop.time())
    circuit_finished = False
    acquired = False
    try:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise TimeoutError
        try:
            await asyncio.wait_for(semaphore.acquire(), timeout=remaining)
            acquired = True
        except TimeoutError as error:
            await circuit.cancel_probe(was_probe)
            circuit_finished = True
            raise UpstreamUnavailable(
                "capacity_timeout",
                retryable=False,
                retry_after=1.0,
            ) from error

        last_error: Optional[UpstreamUnavailable] = None
        for attempt in range(UPSTREAM_ATTEMPTS):
            try:
                profile = await _authenticate_attempt(client, user_id, password, deadline)
                await circuit.record_success(was_probe)
                circuit_finished = True
                return profile
            except InvalidCredentials:
                await circuit.record_success(was_probe)
                circuit_finished = True
                raise
            except UpstreamUnavailable as error:
                last_error = error
                if not error.retryable or attempt + 1 >= UPSTREAM_ATTEMPTS:
                    break
                delay = (
                    error.retry_after
                    if error.retry_after is not None
                    else DEFAULT_RETRY_DELAY_SECONDS
                )
                if delay >= deadline - loop.time():
                    break
                await asyncio.sleep(delay)

        final_error = last_error or UpstreamUnavailable("unknown")
        if final_error.retryable:
            opened_for = await circuit.record_failure(loop.time(), was_probe)
            if opened_for is not None and final_error.retry_after is None:
                final_error.retry_after = opened_for
        else:
            # A definitive non-retryable upstream response proves the service is reachable.
            await circuit.record_success(was_probe)
        circuit_finished = True
        raise final_error
    finally:
        if acquired:
            semaphore.release()
        if not circuit_finished:
            cleanup = asyncio.create_task(circuit.cancel_probe(was_probe))
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                await cleanup
                raise


@app.get("/health")
async def health(request: Request) -> JSONResponse:
    runtime_ready = sys.version_info >= MINIMUM_PYTHON_VERSION
    secret_ready = isinstance(getattr(request.app.state, "bridge_secret", None), bytes)
    circuit = getattr(request.app.state, "riro_circuit", None)
    if isinstance(circuit, CircuitBreaker):
        circuit_status = await circuit.snapshot(asyncio.get_running_loop().time())
    else:
        circuit_status = {"state": "unavailable", "retryAfterSeconds": 0}
    ready = runtime_ready and secret_ready and circuit_status["state"] != "unavailable"
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status": "ok" if ready else "unhealthy",
            "contractVersion": BRIDGE_CONTRACT_VERSION,
            "runtime": {
                "pythonVersion": platform.python_version(),
                "minimumPythonVersion": ".".join(map(str, MINIMUM_PYTHON_VERSION)),
                "ready": runtime_ready,
            },
            "circuit": circuit_status,
        },
        headers={"Cache-Control": "no-store"},
    )


@app.post("/v1/verify")
async def verify(request: Request) -> JSONResponse:
    try:
        body = await _read_request_body(request, MAX_BODY_BYTES)
    except PayloadTooLarge:
        return _json_error(413, "PAYLOAD_TOO_LARGE", "Request is too large.")
    secret = getattr(request.app.state, "bridge_secret", None)
    if not _verify_request(
        body,
        request.headers.get("x-riro-timestamp", ""),
        request.headers.get("x-riro-nonce", ""),
        request.headers.get("x-riro-signature", ""),
        secret if isinstance(secret, bytes) else None,
    ):
        return _json_error(401, "INVALID_BRIDGE_SIGNATURE", "Unauthorized request.")
    try:
        login = LoginRequest.model_validate_json(body)
    except ValidationError:
        return _json_error(400, "INVALID_REQUEST", "Invalid authentication request.")
    try:
        profile = await _authenticate_riro(
            request.app.state.riro_client,
            request.app.state.riro_semaphore,
            request.app.state.riro_circuit,
            login.id,
            login.password,
        )
        return JSONResponse(
            content={"ok": True, "profile": profile},
            headers={"Cache-Control": "no-store"},
        )
    except InvalidCredentials:
        return _json_error(401, "RIRO_INVALID_CREDENTIALS", "Invalid Riroschool credentials.")
    except UpstreamUnavailable as error:
        # Only allowlisted transport classifications are logged. Never log exception text,
        # credentials, tokens, response bodies, profile fields, or request identifiers.
        logger.warning(
            "upstream unavailable category=%s status=%s",
            error.category,
            error.status if error.status is not None else "none",
        )
        headers = None
        if error.retry_after is not None:
            headers = {"Retry-After": str(max(1, math.ceil(error.retry_after)))}
        return _json_error(
            503,
            "RIRO_UNAVAILABLE",
            "Riroschool is unavailable.",
            headers=headers,
        )
