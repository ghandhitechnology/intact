import asyncio
import hashlib
import hmac
import os
import time
import unittest

import httpx

os.environ.setdefault("RIRO_BRIDGE_SECRET", "test-secret-" + "x" * 52)

from main import (
    CircuitBreaker,
    CircuitOpen,
    InvalidCredentials,
    StatelessCookies,
    UpstreamUnavailable,
    _authenticate_riro,
    _parse_profile,
    _student_number_from_id,
    _verify_request,
    app,
)


PROFILE_HTML = """
<html><body>
  <input class="input_disabled" value="홍길동">
  <input class="input_disabled" name="my_num" value="1학년 2반 18번">
  <span class="m_level3">학생</span>
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
            _parse_profile(PROFILE_HTML, "26-10218"),
            {
                "name": "홍길동",
                "currentStudentNumber": "1218",
                "generation": 33,
                "role": "학생",
            },
        )

    def test_falls_back_to_school_id_for_student_number(self):
        html = '<div class="my_page_name">홍길동 <span>학생</span></div>'
        self.assertEqual(_student_number_from_id("26-10218"), "1218")
        self.assertEqual(
            _parse_profile(html, "26-10218")["currentStudentNumber"],
            "1218",
        )


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
            profile = await _authenticate_riro(client, semaphore, circuit, "26-10218", "secret")
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


if __name__ == "__main__":
    unittest.main()
