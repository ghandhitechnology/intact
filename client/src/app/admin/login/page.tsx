'use client';

import { Badge, Button, Field, Input, LoadingLabel } from '@/components/operations/ui';
import { Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { fetchWithTimeout, requestErrorMessage } from '@/lib/client/request';

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetchWithTimeout('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message || '관리자 로그인에 실패했습니다.');
      if (body.data?.mustChangePassword) {
        router.replace('/admin/change-password');
      } else {
        const returnTo = searchParams?.get('returnTo');
        router.replace(returnTo?.startsWith('/admin') ? returnTo : '/admin');
      }
      router.refresh();
    } catch (cause) {
      setError(requestErrorMessage(cause, '관리자 로그인에 실패했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-950 px-4 py-12 text-slate-950">
      <div className="anim-fade flex flex-col items-center gap-2 text-center">
        <span className="text-[24px] font-extrabold leading-none tracking-[-0.05em] text-white">인텍트</span>
        <span className="text-[11px] font-medium tracking-[0.14em] text-slate-500">운영 도구</span>
      </div>

      <div className="anim-rise anim-delay-1 mt-8 w-full max-w-[400px] rounded-3xl border border-slate-800 bg-white p-6 shadow-[var(--shadow-lg)] sm:p-8">
        <Badge tone="green">관리자 전용</Badge>
        <h1 className="mt-3 text-[22px] font-bold tracking-[-0.03em] text-slate-950">인텍트 운영 도구</h1>
        <p className="mt-2 text-xs leading-5 text-slate-500">관리자 세션은 일반 포털 로그인과 분리되며 45분 후 만료됩니다.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="관리자 ID">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required className="pl-10" />
            </div>
          </Field>
          <Field label="비밀번호">
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="pl-10 pr-12" />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                className="absolute inset-y-1 right-1 grid w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-90"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          {error ? (
            <p role="alert" className="anim-rise rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">{error}</p>
          ) : null}
          <Button type="submit" disabled={loading} className="h-12 w-full text-[15px]">
            {loading ? <LoadingLabel>확인 중</LoadingLabel> : <><Lock className="h-4 w-4" />보안 로그인</>}
          </Button>
        </form>
      </div>
    </div>
  );
}
