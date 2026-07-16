import hashlib
import hmac
import os
import time
import unittest

os.environ.setdefault("RIRO_BRIDGE_SECRET", "test-secret-" + "x" * 52)

from main import _parse_profile, _student_number_from_id, _verify_request


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
        html = """
        <html><body>
          <input class="input_disabled" value="홍길동">
          <input class="input_disabled" name="my_num" value="1학년 2반 18번">
          <span class="m_level3">학생</span>
        </body></html>
        """
        self.assertEqual(
            _parse_profile(html, "26-10218"),
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


if __name__ == "__main__":
    unittest.main()
