'use client';

import { Badge, Button, Field, Input, LoadingLabel } from '@/components/operations/ui';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { fetchWithTimeout, requestErrorMessage } from '@/lib/client/request';

export default function AdminChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    if (newPassword !== confirm) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetchWithTimeout('/api/admin/auth/password', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message || '비밀번호를 변경하지 못했습니다.');
      router.replace('/admin');
      router.refresh();
    } catch (cause) {
      setError(requestErrorMessage(cause, '비밀번호를 변경하지 못했습니다.'));
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

      <div className="anim-rise anim-delay-1 mt-8 w-full max-w-[440px] rounded-3xl border border-slate-800 bg-white p-6 shadow-[var(--shadow-lg)] sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <Badge tone="amber">초기 설정</Badge>
          <ShieldAlert className="h-5 w-5 text-amber-600" />
        </div>
        <h1 className="mt-3 text-[22px] font-bold tracking-[-0.03em] text-slate-950">초기 비밀번호 변경</h1>
        <p className="mt-2 text-xs leading-5 text-slate-500">제시된 초기 비밀번호는 이 단계 후 다시 사용할 수 없습니다.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="현재 비밀번호">
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="새 비밀번호">
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
          </Field>
          <Field label="새 비밀번호 확인">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} required />
          </Field>
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs leading-5 text-slate-500">영문자·숫자·특수문자를 각각 포함한 12자 이상을 사용하세요.</p>
          {error ? (
            <p role="alert" className="anim-rise rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">{error}</p>
          ) : null}
          <Button type="submit" disabled={loading} className="h-12 w-full text-[15px]">
            {loading ? <LoadingLabel>변경 중</LoadingLabel> : <><CheckCircle2 className="h-4 w-4" />비밀번호 변경하고 계속</>}
          </Button>
        </form>
      </div>
    </div>
  );
}
