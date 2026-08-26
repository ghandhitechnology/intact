import asyncio
import hashlib
import hmac
import os
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import httpx

os.environ.setdefault("RIRO_BRIDGE_SECRET", "a" * 64)

from main import (
    CircuitBreaker,
    CircuitOpen,
    InvalidCredentials,
    MAX_BODY_BYTES,
    PayloadTooLarge,
    StatelessCookies,
    UpstreamUnavailable,
    _authenticate_riro,
    _cohort_is_plausible,
    _current_korean_school_year,
    _parse_profile,
    _post_with_deadline,
    _read_request_body,
    _entry_student_number_from_id,
    _validate_runtime,
    _verify_request,
    app,
    lifespan,
)


PROFILE_HTML = """
<html><body>
  <input class="input_disabled" value="홍길동">
  <input class="input_disabled" name="my_num" value="1학년 2반 18번">
  <span class="m_level3">학생</span>
</body></html>
"""


def profile_html(role: str | None, student_number: str = "1학년 2반 18번") -> str:
    role_html = f'<span class="m_level3">{role}</span>' if role is not None else ""
    return f"""
    <html><body>
      <input class="input_disabled" value="홍길동">
      <input class="input_disabled" name="my_num" value="{student_number}">
      {role_html}
    </body></html>
    """


def upstream_client(handler) -> httpx.AsyncClient:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        timeout=httpx.Timeout(connect=0.1, read=0.1, write=0.1, pool=0.1),
    )
    client.cookies = StatelessCookies()
    return client


def fresh_resources(limit: int = 8):
    return asyncio.BoundedSemaphore(limit), CircuitBreaker(3, 0.05)


class ChunkedRequest:
    def __init__(self, chunks: list[bytes], content_length: str = "") -> None:
        self.headers = httpx.Headers(
            {"content-length": content_length} if content_length else {}
        )
        self.chunks = chunks
        self.consumed = 0

    async def stream(self):
        for chunk in self.chunks:
            self.consumed += 1
            yield chunk


class GuardedStream(httpx.AsyncByteStream):
    def __init__(self) -> None:
        self.overread = False
        self.closed = False

    async def __aiter__(self):
        yield b"a" * 4
        yield b"b" * 4
        self.overread = True
        yield b"c" * 4

    async def aclose(self) -> None:
        self.closed = True


class BridgeTests(unittest.TestCase):
    def signed_values(self, body: bytes, nonce: str = "nonce_value_1234567890") -> tuple[str, str]:
        timestamp = str(int(time.time()))
        body_hash = hashlib.sha256(body).hexdigest()
        signature = hmac.new(
            os.environ["RIRO_BRIDGE_SECRET"].encode(),
            f"{timestamp}.{nonce}.{body_hash}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return timestamp, signature

    def test_rejects_unsigned_requests(self):
        self.assertFalse(_verify_request(b"{}", "", "", ""))

    def test_rejects_replayed_nonce_before_upstream_call(self):
        body = b'{"id":"student","password":"pw"}'
        nonce = "replay_nonce_1234567890"
        timestamp, signature = self.signed_values(body, nonce)
        self.assertTrue(_verify_request(body, timestamp, nonce, signature))
        self.assertFalse(_verify_request(body, timestamp, nonce, signature))

    def test_parses_current_input_based_profile(self):
        self.assertEqual(
            _parse_profile(PROFILE_HTML, "26-10218", school_year=2026),
            {
                "name": "홍길동",
                "entryStudentNumber": "1218",
                "currentStudentNumber": "1218",
                "generation": 33,
                "role": "학생",
            },
        )

    def test_falls_back_to_school_id_for_student_number(self):
        html = (
            '<div class="my_page_name">홍길동</div>'
            '<span class="m_level3">학생</span>'
        )
        self.assertEqual(_entry_student_number_from_id("26-10218"), "1218")
        self.assertEqual(
            _parse_profile(html, "26-10218", school_year=2026)["currentStudentNumber"],
            "1218",
        )

    def test_keeps_entry_number_separate_from_current_grade(self):
        profile = _parse_profile(
            profile_html("학생", "2학년 3반 7번"),
            "25-10218",
            school_year=2026,
        )
        self.assertIsNotNone(profile)
        self.assertEqual(profile["entryStudentNumber"], "1218")
        self.assertEqual(profile["currentStudentNumber"], "2307")

    def test_rejects_ids_without_an_entry_year_student_number(self):
        self.assertIsNone(_entry_student_number_from_id("25-20218"))
        self.assertIsNone(_entry_student_number_from_id("25-10521"))

    def test_rejects_missing_or_non_student_roles(self):
        self.assertIsNone(_parse_profile(profile_html(None), "26-10218", school_year=2026))
        for role in ("교사", "학부모", "학생회"):
            with self.subTest(role=role):
                self.assertIsNone(
                    _parse_profile(profile_html(role), "26-10218", school_year=2026)
                )

    def test_accepts_only_an_observed_student_role(self):
        parsed = _parse_profile(
            profile_html("  학생  "),
            "26-10218",
            school_year=2026,
        )
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["role"], "학생")

    def test_current_cohort_plausibility_boundaries(self):
        self.assertTrue(_cohort_is_plausible(33, 1, 2026))
        self.assertTrue(_cohort_is_plausible(32, 2, 2026))
        self.assertTrue(_cohort_is_plausible(31, 3, 2026))
        self.assertFalse(_cohort_is_plausible(33, 2, 2026))
        self.assertFalse(_cohort_is_plausible(30, 3, 2026))
        self.assertFalse(_cohort_is_plausible(34, 1, 2026))

    def test_profile_rejects_impossible_generation_and_grade_pair(self):
        self.assertIsNone(
            _parse_profile(
                profile_html("학생", "2학년 2반 18번"),
                "26-20218",
                school_year=2026,
            )
        )
        self.assertIsNotNone(
            _parse_profile(
                profile_html("학생", "2학년 2반 18번"),
                "25-10218",
                school_year=2026,
            )
        )

    def test_korean_school_year_changes_in_march(self):
        self.assertEqual(
            _current_korean_school_year(datetime(2027, 2, 28, tzinfo=timezone.utc)),
            2026,
        )
        self.assertEqual(
            _current_korean_school_year(datetime(2027, 3, 1, tzinfo=timezone.utc)),
            2027,
        )

    def test_runtime_and_secret_requirements_match_installer(self):
        _validate_runtime()
        with patch("main.sys.version_info", (3, 10, 99)):
            with self.assertRaisesRegex(RuntimeError, "Python 3.11"):
                _validate_runtime()


class AsyncBridgeTests(unittest.IsolatedAsyncioTestCase):
    def signed_headers(self, body: bytes, nonce: str) -> dict[str, str]:
        timestamp = str(int(time.time()))
        body_hash = hashlib.sha256(body).hexdigest()
        signature = hmac.new(
            os.environ["RIRO_BRIDGE_SECRET"].encode(),
            f"{timestamp}.{nonce}.{body_hash}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return {
            "content-type": "application/json",
            "x-riro-timestamp": timestamp,
            "x-riro-nonce": nonce,
            "x-riro-signature": signature,
        }

    async def test_lifespan_rejects_invalid_secret_before_startup(self):
        for secret in ("short", "z" * 64, "a" * 63):
            with self.subTest(secret_length=len(secret)):
                with patch.dict(os.environ, {"RIRO_BRIDGE_SECRET": secret}):
                    with self.assertRaisesRegex(RuntimeError, "64-character hexadecimal"):
                        async with lifespan(app):
                            self.fail("invalid configuration started the application")

    async def test_lifespan_and_health_report_runtime_and_circuit_only(self):
        with patch.dict(os.environ, {"RIRO_BRIDGE_SECRET": "b" * 64}):
            async with lifespan(app):
                transport = httpx.ASGITransport(app=app)
                async with httpx.AsyncClient(
                    transport=transport,
                    base_url="http://bridge",
                ) as client:
                    response = await client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("cache-control"), "no-store")
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["contractVersion"], "2")
        self.assertTrue(payload["runtime"]["ready"])
        self.assertEqual(payload["runtime"]["minimumPythonVersion"], "3.11")
        self.assertEqual(
            payload["circuit"],
            {"state": "closed", "retryAfterSeconds": 0},
        )
        self.assertNotIn("school", payload)
        self.assertNotIn("tenant", payload)

    async def test_request_body_cap_stops_streaming_at_the_boundary(self):
        request = ChunkedRequest([b"a" * 3, b"b" * 4, b"never-read".ljust(32, b"x")])
        with self.assertRaises(PayloadTooLarge):
            await _read_request_body(request, 6)
        self.assertEqual(request.consumed, 2)

        declared_too_large = ChunkedRequest([b"never-read"], content_length="7")
        with self.assertRaises(PayloadTooLarge):
            await _read_request_body(declared_too_large, 6)
        self.assertEqual(declared_too_large.consumed, 0)

    async def test_verify_endpoint_rejects_oversized_body_before_authentication(self):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://bridge") as client:
            response = await client.post("/v1/verify", content=b"x" * (MAX_BODY_BYTES + 1))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["error"]["code"], "PAYLOAD_TOO_LARGE")

    async def test_upstream_response_cap_stops_streaming_at_the_boundary(self):
        guarded_stream = GuardedStream()

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, stream=guarded_stream)

        async with upstream_client(handler) as client:
            with self.assertRaisesRegex(UpstreamUnavailable, "stream_too_large"):
                await _post_with_deadline(
                    client,
                    "https://example.test/stream",
                    deadline=asyncio.get_running_loop().time() + 1,
                    headers={},
                    data={},
                    accepted_statuses=frozenset({200}),
                    status_error_category="stream_http",
                    max_response_bytes=6,
                    too_large_category="stream_too_large",
                )
        self.assertFalse(guarded_stream.overread)
        self.assertTrue(guarded_stream.closed)

    async def test_invalid_credentials_are_never_retried(self):
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, json={"code": "400"})

        semaphore, circuit = fresh_resources()
        async with upstream_client(handler) as client:
            with self.assertRaises(InvalidCredentials):
                await _authenticate_riro(client, semaphore, circuit, "student", "secret")
        self.assertEqual(calls, 1)

    async def test_retryable_status_honors_retry_after_with_one_retry(self):
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(503, headers={"Retry-After": "0"})
            if request.url.path == "/ajax.php":
                return httpx.Response(200, json={"code": "000", "token": "safe-token"})
            return httpx.Response(200, text=PROFILE_HTML)

        semaphore, circuit = fresh_resources()
        async with upstream_client(handler) as client:
            with patch("main._current_korean_school_year", return_value=2026):
                profile = await _authenticate_riro(
                    client,
                    semaphore,
                    circuit,
                    "26-10218",
                    "secret",
                )
        self.assertEqual(profile["currentStudentNumber"], "1218")
        self.assertEqual(calls, 3)

    async def test_malformed_login_response_gets_only_one_retry(self):
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, text="not-json")

        semaphore, circuit = fresh_resources()
        async with upstream_client(handler) as client:
            with self.assertRaisesRegex(UpstreamUnavailable, "login_malformed_json"):
                await _authenticate_riro(client, semaphore, circuit, "student", "secret")
        self.assertEqual(calls, 2)

    async def test_upstream_redirect_is_never_followed(self):
        paths: list[str] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            paths.append(request.url.path)
            return httpx.Response(307, headers={"Location": "https://example.test/redirected"})

        semaphore, circuit = fresh_resources()
        async with upstream_client(handler) as client:
            with self.assertRaisesRegex(UpstreamUnavailable, "login_http"):
                await _authenticate_riro(client, semaphore, circuit, "student", "secret")
        self.assertEqual(paths, ["/ajax.php"])

    async def test_total_deadline_cancels_slow_transport(self):
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.2)
            return httpx.Response(200, json={"code": "400"})

        semaphore, circuit = fresh_resources()
        started = time.monotonic()
        async with upstream_client(handler) as client:
            with self.assertRaises(UpstreamUnavailable):
                await _authenticate_riro(
                    client,
                    semaphore,
                    circuit,
                    "student",
                    "secret",
                    deadline_seconds=0.03,
                )
        self.assertLess(time.monotonic() - started, 0.12)
        self.assertEqual(calls, 1)

    async def test_concurrency_is_bounded(self):
        active = 0
        maximum_active = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal active, maximum_active
            active += 1
            maximum_active = max(maximum_active, active)
            try:
                await asyncio.sleep(0.02)
                return httpx.Response(200, json={"code": "400"})
            finally:
                active -= 1

        semaphore, circuit = fresh_resources(limit=2)
        async with upstream_client(handler) as client:
            results = await asyncio.gather(
                *(
                    _authenticate_riro(client, semaphore, circuit, f"student-{index}", "secret")
                    for index in range(6)
                ),
                return_exceptions=True,
            )
        self.assertTrue(all(isinstance(result, InvalidCredentials) for result in results))
        self.assertEqual(maximum_active, 2)

    async def test_health_stays_responsive_while_authentication_waits(self):
        started = asyncio.Event()
        release = asyncio.Event()

        async def handler(request: httpx.Request) -> httpx.Response:
            started.set()
            await release.wait()
            return httpx.Response(200, json={"code": "400"})

        body = b'{"id":"student","password":"secret"}'
        upstream = upstream_client(handler)
        semaphore, circuit = fresh_resources()
        app.state.riro_client = upstream
        app.state.riro_semaphore = semaphore
        app.state.riro_circuit = circuit
        app.state.bridge_secret = os.environ["RIRO_BRIDGE_SECRET"].encode()
        transport = httpx.ASGITransport(app=app)
        async with upstream, httpx.AsyncClient(transport=transport, base_url="http://bridge") as client:
            verify_task = asyncio.create_task(
                client.post(
                    "/v1/verify",
                    content=body,
                    headers=self.signed_headers(body, "health_nonce_1234567890"),
                )
            )
            await asyncio.wait_for(started.wait(), timeout=0.1)
            health = await asyncio.wait_for(client.get("/health"), timeout=0.05)
            self.assertEqual(health.status_code, 200)
            release.set()
            verify_response = await verify_task
        self.assertEqual(verify_response.status_code, 401)

    async def test_error_logs_and_response_redact_credentials_and_profile(self):
        leaked_values = ["student-secret-id", "password-secret", "홍길동", "1218"]

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text=" ".join(leaked_values))

        body = b'{"id":"student-secret-id","password":"password-secret"}'
        upstream = upstream_client(handler)
        semaphore, circuit = fresh_resources()
        app.state.riro_client = upstream
        app.state.riro_semaphore = semaphore
        app.state.riro_circuit = circuit
        app.state.bridge_secret = os.environ["RIRO_BRIDGE_SECRET"].encode()
        transport = httpx.ASGITransport(app=app)
        with self.assertLogs("riro_bridge", level="WARNING") as captured:
            async with upstream, httpx.AsyncClient(transport=transport, base_url="http://bridge") as client:
                response = await client.post(
                    "/v1/verify",
                    content=body,
                    headers=self.signed_headers(body, "redaction_nonce_12345678"),
                )
        combined = " ".join(captured.output) + response.text
        self.assertEqual(response.status_code, 503)
        for leaked_value in leaked_values:
            self.assertNotIn(leaked_value, combined)

    async def test_unavailable_response_includes_retry_after(self):
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(429, headers={"Retry-After": "0"})

        body = b'{"id":"student","password":"secret"}'
        upstream = upstream_client(handler)
        semaphore, circuit = fresh_resources()
        app.state.riro_client = upstream
        app.state.riro_semaphore = semaphore
        app.state.riro_circuit = circuit
        app.state.bridge_secret = os.environ["RIRO_BRIDGE_SECRET"].encode()
        transport = httpx.ASGITransport(app=app)
        with self.assertLogs("riro_bridge", level="WARNING"):
            async with upstream, httpx.AsyncClient(transport=transport, base_url="http://bridge") as client:
                response = await client.post(
                    "/v1/verify",
                    content=body,
                    headers=self.signed_headers(body, "retry_after_nonce_123456"),
                )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers.get("retry-after"), "1")
        self.assertEqual(calls, 2)

    async def test_cancelled_half_open_request_releases_probe(self):
        started = asyncio.Event()

        async def handler(request: httpx.Request) -> httpx.Response:
            started.set()
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

        circuit = CircuitBreaker(failure_threshold=1, recovery_seconds=0.01)
        await circuit.record_failure(asyncio.get_running_loop().time(), False)
        await asyncio.sleep(0.02)
        semaphore = asyncio.BoundedSemaphore(1)
        async with upstream_client(handler) as client:
            task = asyncio.create_task(
                _authenticate_riro(client, semaphore, circuit, "student", "secret")
            )
            await asyncio.wait_for(started.wait(), timeout=0.1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertTrue(await circuit.before_call(asyncio.get_running_loop().time()))
        await circuit.cancel_probe(True)

    async def test_circuit_breaker_allows_only_one_half_open_probe(self):
        circuit = CircuitBreaker(failure_threshold=1, recovery_seconds=0.01)
        await circuit.record_failure(asyncio.get_running_loop().time(), False)
        await asyncio.sleep(0.02)
        self.assertTrue(await circuit.before_call(asyncio.get_running_loop().time()))
        with self.assertRaises(CircuitOpen):
            await circuit.before_call(asyncio.get_running_loop().time())

    async def test_circuit_snapshot_reports_only_operational_state(self):
        circuit = CircuitBreaker(failure_threshold=1, recovery_seconds=0.01)
        loop = asyncio.get_running_loop()
        self.assertEqual(
            await circuit.snapshot(loop.time()),
            {"state": "closed", "retryAfterSeconds": 0},
        )
        await circuit.record_failure(loop.time(), False)
        opened = await circuit.snapshot(loop.time())
        self.assertEqual(opened["state"], "open")
        self.assertGreaterEqual(opened["retryAfterSeconds"], 1)
        await asyncio.sleep(0.02)
        self.assertEqual(
            await circuit.snapshot(loop.time()),
            {"state": "half_open", "retryAfterSeconds": 0},
        )


if __name__ == "__main__":
    unittest.main()
