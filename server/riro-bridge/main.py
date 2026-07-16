import hashlib
import hmac
import json
import os
import re
import threading
import time
import unicodedata
from typing import Any, Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError


RIRO_ORIGIN = "https://iscience.riroschool.kr"
RIRO_SCHOOL_NAME = "인천과학고등학교"
USER_AGENT = "Mozilla/5.0 (compatible; IntactRiroBridge/1.0)"
MAX_CLOCK_SKEW_SECONDS = 60
NONCE_TTL_SECONDS = 180
MAX_BODY_BYTES = 4096

app = FastAPI(
    title="Intact Riroschool Bridge",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_seen_nonces: dict[str, float] = {}
_nonce_lock = threading.Lock()


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    id: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class InvalidCredentials(Exception):
    pass


class UpstreamUnavailable(Exception):
    pass


def _bridge_secret() -> bytes:
    secret = os.environ.get("RIRO_BRIDGE_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("RIRO_BRIDGE_SECRET must be at least 32 characters")
    return secret.encode("utf-8")


def _json_error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"ok": False, "error": {"code": code, "message": message}},
        headers={"Cache-Control": "no-store"},
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


def _verify_request(body: bytes, timestamp_text: str, nonce: str, signature: str) -> bool:
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
    expected = hmac.new(_bridge_secret(), signed, hashlib.sha256).hexdigest()
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


def _student_number_from_id(riro_id: str) -> Optional[str]:
    """Support school IDs such as 26-10218 (entry year-grade-class-number)."""
    compact = re.sub(r"[^0-9]", "", riro_id)
    match = re.fullmatch(r"\d{2}([1-3])0?([1-9])(\d{2})", compact)
    if not match:
        return None
    return _normalize_student_number("".join(match.groups()))


def _parse_profile(html: str, submitted_id: str) -> Optional[dict[str, Any]]:
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
    current_student_number = next(
        (
            normalized
            for value in profile_values
            if (normalized := _normalize_student_number(value))
        ),
        None,
    ) or _student_number_from_id(effective_id)
    generation = _generation_from_id(effective_id)
    role_element = soup.select_one("span.m_level3") or soup.select_one("span.m_level1")
    role = role_element.get_text(strip=True) if role_element else "학생"

    if not name or not re.fullmatch(r"[가-힣A-Za-z .'-]{2,40}", name):
        return None
    if not current_student_number or not generation:
        return None
    return {
        "name": name,
        "currentStudentNumber": current_student_number,
        "generation": generation,
        "role": role[:40],
    }


def _safe_json_shape(value: Any, depth: int = 0) -> Any:
    if depth >= 3:
        return type(value).__name__
    if isinstance(value, dict):
        return {str(key)[:80]: _safe_json_shape(item, depth + 1) for key, item in value.items()}
    if isinstance(value, list):
        return [(_safe_json_shape(value[0], depth + 1) if value else "empty")]
    return type(value).__name__


def _safe_profile_metadata(
    html: str,
    status: int,
    location: str,
    login_payload: dict[str, Any],
) -> str:
    """Return structural diagnostics without user text, values, cookies, or query strings."""
    soup = BeautifulSoup(html[:2_000_000], "html.parser")
    classes = sorted({
        class_name
        for element in soup.find_all(True)
        for class_name in (element.get("class") or [])
        if re.search(r"user|member|profile|student|school|grade|class|name|level|info|elem|input", class_name, re.I)
    })[:80]
    ids = sorted({
        str(element.get("id"))
        for element in soup.find_all(True)
        if element.get("id") and re.search(
            r"user|member|profile|student|school|grade|class|name|level|info",
            str(element.get("id")),
            re.I,
        )
    })[:80]
    input_names = sorted({
        str(element.get("name"))
        for element in soup.find_all(["input", "select"])
        if element.get("name")
    })[:80]
    parsed_location = urlparse(location)
    return json.dumps({
        "status": status,
        "locationPath": parsed_location.path[:160] if parsed_location.path else "",
        "htmlBytes": len(html.encode("utf-8", errors="ignore")),
        "titlePresent": bool(soup.title),
        "classes": classes,
        "ids": ids,
        "inputNames": input_names,
        "loginShape": _safe_json_shape(login_payload),
    }, ensure_ascii=False, separators=(",", ":"))


def _authenticate_riro(user_id: str, password: str) -> dict[str, Any]:
    headers = {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": USER_AGENT,
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
    }
    last_error: Optional[Exception] = None
    for attempt in range(2):
        try:
            with requests.Session() as session:
                try:
                    session.post(f"{RIRO_ORIGIN}/user.php?action=user_logout", timeout=8)
                except requests.RequestException:
                    pass
                login_response = session.post(
                    f"{RIRO_ORIGIN}/ajax.php",
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
                    timeout=15,
                )
                if login_response.status_code != 200 or len(login_response.content) > 64_000:
                    raise UpstreamUnavailable("Riroschool returned an invalid login response")
                try:
                    payload = login_response.json()
                except (requests.JSONDecodeError, json.JSONDecodeError) as error:
                    raise UpstreamUnavailable("Riroschool returned malformed JSON") from error
                if not isinstance(payload, dict):
                    raise UpstreamUnavailable("Riroschool returned an invalid JSON payload")
                code = str(payload.get("code", ""))
                if code in {"400", "902"}:
                    raise InvalidCredentials()
                token = payload.get("token")
                if code != "000" or not isinstance(token, str) or not token:
                    raise UpstreamUnavailable(f"Unexpected Riroschool login code {code}")

                profile_response = session.post(
                    f"{RIRO_ORIGIN}/user.php",
                    headers=headers,
                    data={"pw": password},
                    cookies={"cookie_token": token},
                    allow_redirects=False,
                    timeout=15,
                )
                if profile_response.status_code not in {200, 302}:
                    raise UpstreamUnavailable(
                        f"Riroschool profile HTTP {profile_response.status_code}"
                    )
                profile = _parse_profile(profile_response.text, user_id)
                if not profile:
                    metadata = _safe_profile_metadata(
                        profile_response.text,
                        profile_response.status_code,
                        profile_response.headers.get("location", ""),
                        payload,
                    )
                    raise UpstreamUnavailable(f"Riroschool profile format changed {metadata}")
                return profile
        except InvalidCredentials:
            raise
        except (requests.RequestException, UpstreamUnavailable) as error:
            last_error = error
            if attempt == 0:
                time.sleep(0.4)
    raise UpstreamUnavailable(str(last_error or "Riroschool unavailable"))


@app.get("/health")
def health() -> dict[str, str]:
    _bridge_secret()
    return {"status": "ok", "school": RIRO_SCHOOL_NAME, "tenant": "iscience"}


@app.post("/v1/verify")
async def verify(request: Request) -> JSONResponse:
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        return _json_error(413, "PAYLOAD_TOO_LARGE", "Request is too large.")
    if not _verify_request(
        body,
        request.headers.get("x-riro-timestamp", ""),
        request.headers.get("x-riro-nonce", ""),
        request.headers.get("x-riro-signature", ""),
    ):
        return _json_error(401, "INVALID_BRIDGE_SIGNATURE", "Unauthorized request.")
    try:
        login = LoginRequest.model_validate_json(body)
    except ValidationError:
        return _json_error(400, "INVALID_REQUEST", "Invalid authentication request.")
    try:
        profile = _authenticate_riro(login.id, login.password)
        return JSONResponse(
            content={"ok": True, "profile": profile},
            headers={"Cache-Control": "no-store"},
        )
    except InvalidCredentials:
        return _json_error(401, "RIRO_INVALID_CREDENTIALS", "Invalid Riroschool credentials.")
    except UpstreamUnavailable as error:
        # Messages are deliberately limited to status/contract failures and never include
        # credentials, tokens, response bodies, names, or student numbers.
        print(f"[riro] upstream unavailable: {error}", flush=True)
        return _json_error(503, "RIRO_UNAVAILABLE", "Riroschool is unavailable.")
