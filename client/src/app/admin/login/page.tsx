'use client';

import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';

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
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth/login', {
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
      setError(cause instanceof Error ? cause.message : '관리자 로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-950">
      <div className="w-full max-w-md border border-slate-700 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-6">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center bg-blue-700 text-white"><ShieldCheck size={22} /></span>
            <div>
              <p className="text-[10px] font-black tracking-[0.18em] text-blue-700">RESTRICTED ACCESS</p>
              <h1 className="mt-1 text-xl font-black">인텍트 Admin Console</h1>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">관리자 세션은 일반 포털 로그인과 분리되며 45분 후 만료됩니다.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 px-6 py-6">
          <label className="block">
            <span className="mb-2 block text-xs font-black">관리자 ID</span>
            <span className="flex h-11 items-center border border-slate-300 px-3 focus-within:border-blue-600">
              <KeyRound size={16} className="mr-2 text-slate-400" />
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required className="min-w-0 flex-1 border-0 p-0 text-sm outline-none" />
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-black">비밀번호</span>
            <span className="flex h-11 items-center border border-slate-300 px-3 focus-within:border-blue-600">
              <Lock size={16} className="mr-2 text-slate-400" />
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="min-w-0 flex-1 border-0 p-0 text-sm outline-none" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} className="text-slate-400 hover:text-slate-700">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </span>
          </label>
          {error && <p role="alert" className="border-l-2 border-red-600 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
          <button type="submit" disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 bg-blue-700 text-sm font-black text-white hover:bg-blue-800 disabled:bg-slate-400">
            {loading ? <Loader2 size={17} className="animate-spin" /> : <Lock size={16} />}
            {loading ? '확인 중…' : '보안 로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
