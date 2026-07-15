'use client';

import AuthFrame from '@/components/operations/AuthFrame';
import { apiErrorMessage, Button, Field, Input, LoadingLabel, readApiEnvelope } from '@/components/operations/ui';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useState } from 'react';

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
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/invite/verify', {
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
      setError(cause instanceof Error ? cause.message : '본인 확인을 진행하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      const response = await fetch('/api/auth/reset-password', {
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
      setError(cause instanceof Error ? cause.message : '비밀번호를 재설정하지 못했습니다.');
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
      {step === 'verify' && (
        <form onSubmit={verifyIdentity} className="space-y-5">
          <p className="text-xs leading-5 text-slate-600">
            <ShieldCheck className="mr-2 inline h-4 w-4" />운영자에게 받은 재설정 코드를 입력하세요.
          </p>
          <Field label="비밀번호 재설정 코드" required error={error || undefined}><Input autoComplete="one-time-code" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="운영자가 발급한 코드" /></Field>
          <Button type="submit" variant="green" disabled={loading || !inviteCode.trim()} className="h-12 w-full">{loading ? <LoadingLabel>본인 확인 중</LoadingLabel> : <>본인 확인 <ArrowRight className="h-4 w-4" /></>}</Button>
        </form>
      )}
      {step === 'password' && (
        <form onSubmit={resetPassword} className="space-y-5">
          <p className="text-sm font-bold text-slate-700">학번 {studentCode}</p>
          <Field label="새 비밀번호" required hint="영문+숫자 10자 이상">
            <div className="relative"><Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="pr-11" /><button type="button" aria-label="비밀번호 표시 전환" onClick={() => setShowPassword((value) => !value)} className="absolute right-0 top-0 grid h-11 w-11 place-items-center text-slate-400">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
          </Field>
          <Field label="새 비밀번호 확인" required error={error || undefined}><Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field>
          <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => { setStep('verify'); setTicket(''); setError(''); }}><ArrowLeft className="h-4 w-4" />다시 인증</Button><Button type="submit" disabled={loading} className="flex-1">{loading ? <LoadingLabel>변경 중</LoadingLabel> : '비밀번호 변경'}</Button></div>
        </form>
      )}
      {step === 'done' && (
        <div className="py-4 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" /><h2 className="mt-4 text-lg font-black">비밀번호를 변경했습니다.</h2><p className="mt-2 text-sm text-slate-500">기존의 모든 로그인 세션은 종료되었습니다.</p><Link href="/login" className="mt-6 inline-flex h-11 items-center bg-blue-700 px-5 text-sm font-bold text-white">학번 {studentCode}로 로그인</Link></div>
      )}
    </AuthFrame>
  );
}
