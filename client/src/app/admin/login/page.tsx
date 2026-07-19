'use client';

import { Eye, EyeOff, KeyRound, Loader2, Lock } from 'lucide-react';
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
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-950">
      <div className="w-full max-w-md border border-slate-700 bg-white ">
        <div className="border-b-2 border-slate-800 px-5 py-5">
          <p className="text-xs font-semibold text-emerald-800">관리자 전용</p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em]">인텍트 운영 도구</h1>
          <p className="mt-4 text-xs leading-5 text-slate-600">관리자 세션은 일반 포털 로그인과 분리되며 45분 후 만료됩니다.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 px-5 py-5">
          <label className="block">
            <span className="mb-2 block text-xs font-bold">관리자 ID</span>
            <span className="flex h-10 items-center border border-slate-300 px-3 focus-within:border-emerald-600">
              <KeyRound size={16} className="mr-2 text-slate-400" />
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required className="min-w-0 flex-1 border-0 p-0 text-sm outline-none" />
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold">비밀번호</span>
            <span className="flex h-10 items-center border border-slate-300 px-3 focus-within:border-emerald-600">
              <Lock size={16} className="mr-2 text-slate-400" />
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="min-w-0 flex-1 border-0 p-0 text-sm outline-none" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} className="text-slate-400 hover:text-slate-700">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </span>
          </label>
          {error && <p role="alert" className="border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
          <button type="submit" disabled={loading} className="flex h-10 w-full items-center justify-center gap-2 bg-emerald-700 text-sm font-bold text-white hover:bg-emerald-800 disabled:bg-slate-400">
            {loading ? <Loader2 size={17} className="animate-spin" /> : <Lock size={16} />}
            {loading ? '확인 중…' : '보안 로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
