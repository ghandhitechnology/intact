'use client';

import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export default function AdminChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirm) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth/password', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message || '비밀번호를 변경하지 못했습니다.');
      router.replace('/admin');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '비밀번호를 변경하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-lg border border-amber-400 bg-white p-7 ">
        <ShieldAlert className="text-amber-600" size={30} />
        <h1 className="mt-4 text-2xl font-black text-slate-950">초기 비밀번호를 변경해 주세요</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">제시된 초기 비밀번호는 이 단계 후 다시 사용할 수 없습니다.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-xs font-black">현재 비밀번호<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required className="mt-2 h-11 w-full border border-slate-300 px-3 text-sm font-normal outline-none focus:border-blue-600" /></label>
          <label className="block text-xs font-black">새 비밀번호<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={12} required className="mt-2 h-11 w-full border border-slate-300 px-3 text-sm font-normal outline-none focus:border-blue-600" /></label>
          <label className="block text-xs font-black">새 비밀번호 확인<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} required className="mt-2 h-11 w-full border border-slate-300 px-3 text-sm font-normal outline-none focus:border-blue-600" /></label>
          <p className="text-[11px] leading-5 text-slate-500">영문자·숫자·특수문자를 각각 포함한 12자 이상을 사용하세요.</p>
          {error && <p role="alert" className="bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
          <button disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 bg-blue-700 text-sm font-black text-white disabled:bg-slate-400">{loading ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}{loading ? '변경 중…' : '비밀번호 변경하고 계속'}</button>
        </form>
      </div>
    </div>
  );
}
