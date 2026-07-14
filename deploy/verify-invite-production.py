#!/usr/bin/env python3
"""Run a disposable invite verification smoke test on the production host."""

import http.cookiejar
import json
import subprocess
import urllib.request
from datetime import datetime, timedelta, timezone

BASE_URL = "https://ishsoutside.com"
TEST_STUDENT_CODE = "991101"


def sql(statement: str) -> None:
    subprocess.run(
        [
            "docker", "compose", "exec", "-T", "postgres", "psql", "-q",
            "-U", "igwak", "-d", "igwak", "-c", statement,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def cleanup() -> None:
    sql(
        f"""
        DELETE FROM "VerificationTicket" WHERE "studentCode" = '{TEST_STUDENT_CODE}';
        DELETE FROM "AdminAuditLog"
          WHERE "targetType" = 'STUDENT_INVITE'
          AND "targetId" IN (
            SELECT id::text FROM "StudentInvite" WHERE "studentCode" = '{TEST_STUDENT_CODE}'
          );
        DELETE FROM "StudentInvite" WHERE "studentCode" = '{TEST_STUDENT_CODE}';
        UPDATE "User" SET "mustChangePassword" = true WHERE "loginId" = 'admin';
        """
    )


def credentials() -> str:
    values: dict[str, str] = {}
    with open("/root/ishsoutside-admin-credentials.txt", encoding="utf-8") as source:
        for line in source:
            if ": " in line:
                key, value = line.strip().split(": ", 1)
                values[key] = value
    return values["Initial password"]


def main() -> None:
    cleanup()
    sql('UPDATE "User" SET "mustChangePassword" = false WHERE "loginId" = \'admin\';')
    try:
        password = credentials()
        cookie_jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

        def post(path: str, payload: dict[str, str]) -> tuple[int, dict]:
            request = urllib.request.Request(
                BASE_URL + path,
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Origin": BASE_URL,
                    "User-Agent": "InGwak-Deployment-Check/1.0",
                },
                method="POST",
            )
            with opener.open(request, timeout=20) as response:
                return response.status, json.load(response)

        login_status, _ = post(
            "/api/admin/auth/login",
            {"identifier": "admin", "password": password},
        )
        expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        create_status, created = post(
            "/api/admin/invites",
            {
                "realName": "배포검증",
                "studentCode": TEST_STUDENT_CODE,
                "expiresAt": expiry,
                "reason": "운영 배포 자동 검증",
                "purpose": "REGISTER",
            },
        )
        verify_status, verified = post(
            "/api/auth/invite/verify",
            {"code": created["data"]["code"]},
        )
        profile = verified["data"]["profile"]
        print(f"admin_login_http={login_status}")
        print(f"invite_create_http={create_status}")
        print(f"invite_verify_http={verify_status}")
        print(f"verified_name={profile.get('name')}")
        print(f"verified_student_code={profile.get('studentCode')}")
    finally:
        cleanup()


if __name__ == "__main__":
    main()
