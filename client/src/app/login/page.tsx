'use client';

import AuthFrame from '@/components/operations/AuthFrame';
import { apiErrorMessage, Button, Field, Input, LoadingLabel, readApiEnvelope } from '@/components/operations/ui';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  isValidStudentCode,
  normalizeStudentCode,
  STUDENT_CODE_REQUIREMENTS,
} from '@/lib/student-code';
import { fetchWithTimeout, requestErrorMessage } from '@/lib/client/request';
import { loginPasswordError } from '@/lib/login-credentials';

function safeReturnTo(raw: string | null) {
  if (!raw || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return '/';
  try {
    const origin = window.location.origin;
    const resolved = new URL(raw, origin);
    if (resolved.origin !== origin || !resolved.pathname.startsWith('/')) return '/';
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return '/';
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    if (!isValidStudentCode(studentId)) {
      setError(STUDENT_CODE_REQUIREMENTS);
      return;
    }
    // The current password policy belongs to registration and password changes;
    // login must continue to accept valid legacy passwords.
    const passwordError = loginPasswordError(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);
    try {
      const response = await fetchWithTimeout('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, password, remember }),
      });
      const payload = await readApiEnvelope<{
        user?: { id: string };
        mustChangePassword?: boolean;
        authenticated?: boolean;
        requiresReverification?: boolean;
      }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, '학번 또는 비밀번호를 확인해 주세요.'));
      }
      if (payload.data.requiresReverification) {
        router.push('/reverify');
      } else {
        const returnTo = new URLSearchParams(window.location.search).get('returnTo');
        router.push(safeReturnTo(returnTo));
      }
      router.refresh();
    } catch (cause) {
      setError(requestErrorMessage(cause, '로그인 중 문제가 발생했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame mode="login" title="로그인">
      <form onSubmit={handleSubmit} className="space-y-6" noValidate aria-busy={loading}>
        <Field label="6자리 학번" error={error?.includes('학번') ? error : undefined}>
          <Input
            required
            inputMode="numeric"
            autoComplete="username"
            placeholder="예: 331101"
            className="h-12  border-[#c9ccc6] bg-white px-4 text-[15px] focus:border-[#28745c] focus:ring-2 focus:ring-[#dcebe5]"
            maxLength={6}
            value={studentId}
            disabled={loading}
            onChange={(event) => setStudentId(normalizeStudentCode(event.target.value))}
          />
        </Field>
        <Field label="비밀번호" error={error && !error.includes('학번') ? error : undefined}>
          <div className="relative">
            <Input
              required
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="비밀번호 입력"
              className="h-12  border-[#c9ccc6] bg-white px-4 pr-16 text-[15px] focus:border-[#28745c] focus:ring-2 focus:ring-[#dcebe5]"
              maxLength={128}
              value={password}
              disabled={loading}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} className="absolute right-1 top-1 grid h-10 min-w-12 place-items-center px-2 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--ink)]">
              {showPassword ? '숨기기' : '보기'}
            </button>
          </div>
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
          <label className="flex cursor-pointer items-center gap-2.5 text-[var(--ink-soft)]">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4  accent-[#28745c]" />
            로그인 상태 유지
          </label>
          <Link href="/reset-password" className="font-semibold text-[var(--green-deep)] underline underline-offset-4">비밀번호 재설정</Link>
        </div>

        <Button type="submit" variant="green" disabled={loading} className="h-12 w-full  border-[#255f4d] bg-[#255f4d] text-[15px] font-semibold hover:border-[#1d4d3e] hover:bg-[#1d4d3e]">
          {loading ? <LoadingLabel>확인하는 중</LoadingLabel> : '로그인'}
        </Button>
      </form>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-[13px]">
        <span className="text-[var(--ink-faint)]">처음 방문하셨나요?</span>
        <Link href="/register" className="font-semibold text-[var(--green-deep)] underline underline-offset-4">재학생 인증하고 가입하기</Link>
      </div>
    </AuthFrame>
  );
}
