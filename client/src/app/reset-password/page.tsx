'use client';

import AuthFrame from '@/components/operations/AuthFrame';
import { apiErrorMessage, Button, cn, Field, Input, LoadingLabel, readApiEnvelope } from '@/components/operations/ui';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { fetchWithTimeout, requestErrorMessage } from '@/lib/client/request';

type VerificationResponse = {
  verificationTicket: string;
  profile: { name: string; studentCode: string };
};

export default function ResetPasswordPage() {
  const [step, setStep] = useState<'verify' | 'password' | 'done'>('verify');
  const [inviteCode, setInviteCode] = useState('');
  const [ticket, setTicket] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function verifyIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetchWithTimeout('/api/auth/invite/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: inviteCode.trim(), purpose: 'RESET' }),
      });
      const payload = await readApiEnvelope<VerificationResponse>(response);
      if (!response.ok || !payload?.ok) throw new Error(apiErrorMessage(payload, '비밀번호 재설정 코드를 확인하지 못했습니다.'));
      setTicket(payload.data.verificationTicket);
      setStudentCode(payload.data.profile.studentCode);
      setInviteCode('');
      setStep('password');
    } catch (cause) {
      setError(requestErrorMessage(cause, '본인 확인을 진행하지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError('');
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('새 비밀번호는 영문자와 숫자를 포함해 10자 이상으로 설정해 주세요.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetchWithTimeout('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verificationTicket: ticket, newPassword }),
      });
      const payload = await readApiEnvelope<{ reset: boolean; studentCode: string }>(response);
      if (!response.ok || !payload?.ok) throw new Error(apiErrorMessage(payload, '비밀번호를 재설정하지 못했습니다.'));
      setStudentCode(payload.data.studentCode);
      setNewPassword('');
      setConfirmPassword('');
      setStep('done');
    } catch (cause) {
      setError(requestErrorMessage(cause, '비밀번호를 재설정하지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      mode="login"
      title="비밀번호 재설정"
      description="운영자가 본인 확인 후 발급한 일회용 코드로 새 포털 비밀번호를 설정합니다."
    >
      {step !== 'done' ? (
        <div className="mb-7 flex items-center gap-3" aria-label={`재설정 단계: ${step === 'verify' ? '1단계 본인 확인' : '2단계 새 비밀번호'}`}>
          <span className={cn('flex shrink-0 items-center gap-2 text-[11px] font-bold', step === 'password' ? 'text-emerald-700' : 'text-slate-900')}>
            <span
              className={cn(
                'grid h-5 w-5 place-items-center rounded-full text-[10px] transition-all duration-300',
                step === 'password' ? 'bg-emerald-700 text-white' : 'bg-slate-900 text-white',
              )}
            >
              {step === 'password' ? <Check className="h-3 w-3" strokeWidth={3} /> : 1}
            </span>
            본인 확인
          </span>
          <span className="relative h-px flex-1 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-700 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ width: step === 'password' ? '100%' : '0%' }}
            />
          </span>
          <span className={cn('flex shrink-0 items-center gap-2 text-[11px] font-bold transition-colors duration-300', step === 'password' ? 'text-slate-900' : 'text-slate-400')}>
            <span
              className={cn(
                'grid h-5 w-5 place-items-center rounded-full text-[10px] transition-all duration-300',
                step === 'password' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-400',
              )}
            >
              2
            </span>
            새 비밀번호
          </span>
        </div>
      ) : null}

      {step === 'verify' && (
        <form key="verify" onSubmit={verifyIdentity} className="anim-rise space-y-5">
          <div className="flex items-start gap-2.5 rounded-2xl border border-blue-200/70 bg-blue-50/60 px-4 py-3.5 text-xs leading-5 text-blue-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            운영자에게 받은 재설정 코드를 입력하세요.
          </div>
          <Field label="비밀번호 재설정 코드" required error={error || undefined}>
            <Input autoComplete="one-time-code" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="운영자가 발급한 코드" />
          </Field>
          <Button type="submit" variant="green" disabled={loading || !inviteCode.trim()} className="h-12 w-full text-[15px]">
            {loading ? <LoadingLabel>본인 확인 중</LoadingLabel> : <>본인 확인 <ArrowRight className="h-4 w-4" /></>}
          </Button>
        </form>
      )}
      {step === 'password' && (
        <form key="password" onSubmit={resetPassword} className="anim-rise space-y-5">
          <p className="flex items-center gap-2 rounded-2xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-3 text-sm font-semibold text-emerald-900">
            <ShieldCheck className="h-4 w-4 shrink-0" />학번 {studentCode}
          </p>
          <Field label="새 비밀번호" required hint="영문+숫자 10자 이상">
            <div className="relative">
              <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="pr-12" />
              <button
                type="button"
                aria-label="비밀번호 표시 전환"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute inset-y-1 right-1 grid w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-90"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="새 비밀번호 확인" required error={error || undefined}>
            <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => { setStep('verify'); setTicket(''); setError(''); }}><ArrowLeft className="h-4 w-4" />다시 인증</Button>
            <Button type="submit" disabled={loading} className="h-11 flex-1">{loading ? <LoadingLabel>변경 중</LoadingLabel> : '비밀번호 변경'}</Button>
          </div>
        </form>
      )}
      {step === 'done' && (
        <div key="done" className="anim-rise flex flex-col items-center py-4 text-center">
          <span className="anim-pop grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-lg font-bold tracking-[-0.02em] text-slate-950">비밀번호를 변경했습니다.</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">기존 로그인은 모두 종료되었습니다. 새 비밀번호로 다시 로그인해 주세요.</p>
          <Link
            href="/login"
            className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-800/60 bg-emerald-700 text-[15px] font-semibold text-white shadow-[var(--shadow-xs)] transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:bg-emerald-800 hover:shadow-[var(--shadow-sm)] active:scale-[0.97]"
          >
            학번 {studentCode}로 로그인
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}
