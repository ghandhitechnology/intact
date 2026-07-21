'use client';

import AuthFrame from '@/components/operations/AuthFrame';
import { Button, Field, Input, LoadingLabel } from '@/components/operations/ui';
import { CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { fetchWithTimeout, requestErrorMessage } from '@/lib/client/request';

export default function ReverifyPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const verificationResponse = await fetchWithTimeout('/api/auth/invite/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), purpose: 'REVERIFY' }),
      });
      const verificationBody = await verificationResponse.json().catch(() => null);
      if (!verificationResponse.ok || !verificationBody?.ok) {
        throw new Error(verificationBody?.error?.message || '재인증 코드를 확인하지 못했습니다.');
      }
      const response = await fetchWithTimeout('/api/auth/reverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verificationTicket: verificationBody.data.verificationTicket }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message || '재인증을 완료하지 못했습니다.');
      setDone(true);
      window.setTimeout(() => {
        router.replace('/');
        router.refresh();
      }, 900);
    } catch (cause) {
      setError(requestErrorMessage(cause, '재인증을 완료하지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame mode="register" title="재학생 재인증" description="새 학년 학적을 확인하면 기존 계정과 활동 기록이 그대로 유지됩니다.">
      {done ? (
        <div className="anim-rise flex flex-col items-center py-6 text-center">
          <span className="anim-pop grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-lg font-bold tracking-[-0.02em] text-slate-950">재인증을 완료했습니다</h2>
        </div>
      ) : (
        <form onSubmit={submit} className="anim-rise space-y-5">
          <div className="flex items-start gap-2.5 rounded-2xl border border-blue-200/70 bg-blue-50/60 px-4 py-3.5 text-xs leading-5 text-blue-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            운영자에게 받은 재인증 코드를 입력하세요.
          </div>
          <Field label="재학생 재인증 코드" required error={error || undefined}>
            <Input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" placeholder="운영자가 발급한 코드" required />
          </Field>
          <Button type="submit" disabled={loading || !code.trim()} className="h-12 w-full text-[15px]">
            {loading ? <LoadingLabel>확인 중</LoadingLabel> : <><RefreshCw size={16} />재인증 완료하기</>}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
