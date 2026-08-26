'use client';

import AuthFrame from '@/components/operations/AuthFrame';
import {
  apiErrorMessage,
  Button,
  cn,
  Field,
  Input,
  LoadingLabel,
  readApiEnvelope,
  Tabs,
} from '@/components/operations/ui';
import { fetchWithTimeout, requestErrorMessage } from '@/lib/client/request';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useState } from 'react';

type VerificationResponse = {
  verificationTicket: string;
  expiresAt: string;
  profile: { name: string; studentCode: string };
};

type ResetState =
  | { step: 'verify'; method: 'riro'; id: string; password: string; error: string }
  | { step: 'verify'; method: 'admin'; code: string; error: string }
  | {
      step: 'password';
      ticket: string;
      studentCode: string;
      newPassword: string;
      confirmPassword: string;
      showPassword: boolean;
      error: string;
    }
  | { step: 'done'; studentCode: string };

const initialState = (): ResetState => ({
  step: 'verify',
  method: 'riro',
  id: '',
  password: '',
  error: '',
});

export default function ResetPasswordPage() {
  const [state, setState] = useState<ResetState>(initialState);
  const [loading, setLoading] = useState(false);

  function selectMethod(method: 'riro' | 'admin') {
    if (loading) return;
    setState(method === 'riro'
      ? { step: 'verify', method, id: '', password: '', error: '' }
      : { step: 'verify', method, code: '', error: '' });
  }

  async function verifyIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || state.step !== 'verify') return;

    const submitted = state;
    setLoading(true);
    setState((current) => current.step === 'verify' ? { ...current, error: '' } : current);
    try {
      let response: Response;
      if (submitted.method === 'riro') {
        if (submitted.id.trim().length < 2 || !submitted.password) {
          throw new Error('리로스쿨 아이디와 비밀번호를 입력해 주세요.');
        }
        response = await fetchWithTimeout('/api/auth/riro/reset-verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: submitted.id.trim(), password: submitted.password }),
        }, 30_000);
      } else {
        if (!submitted.code.trim()) throw new Error('관리자 비밀번호 재설정 코드를 입력해 주세요.');
        response = await fetchWithTimeout('/api/auth/invite/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: submitted.code.trim(), purpose: 'RESET' }),
        }, 12_000);
      }

      const payload = await readApiEnvelope<VerificationResponse>(response);
      if (!response.ok || !payload?.ok) {
        const fallback = submitted.method === 'riro'
          ? '리로스쿨 본인 확인에 실패했습니다.'
          : '관리자 비밀번호 재설정 코드를 확인하지 못했습니다.';
        throw new Error(apiErrorMessage(payload, fallback));
      }
      setState({
        step: 'password',
        ticket: payload.data.verificationTicket,
        studentCode: payload.data.profile.studentCode,
        newPassword: '',
        confirmPassword: '',
        showPassword: false,
        error: '',
      });
    } catch (cause) {
      const message = requestErrorMessage(cause, '본인 확인을 진행하지 못했습니다.');
      setState((current) => {
        if (current.step !== 'verify' || current.method !== submitted.method) return current;
        return current.method === 'riro'
          ? { ...current, password: '', error: message }
          : { ...current, code: '', error: message };
      });
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || state.step !== 'password') return;
    if (state.newPassword.length < 10 || !/[A-Za-z]/.test(state.newPassword) || !/\d/.test(state.newPassword)) {
      setState({ ...state, error: '새 비밀번호는 영문자와 숫자를 포함해 10자 이상으로 설정해 주세요.' });
      return;
    }
    if (state.newPassword !== state.confirmPassword) {
      setState({ ...state, error: '새 비밀번호 확인이 일치하지 않습니다.' });
      return;
    }

    const submitted = state;
    setLoading(true);
    setState({ ...state, error: '' });
    try {
      const response = await fetchWithTimeout('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          verificationTicket: submitted.ticket,
          newPassword: submitted.newPassword,
        }),
      }, 12_000);
      const payload = await readApiEnvelope<{ reset: boolean; studentCode: string }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, '비밀번호를 재설정하지 못했습니다.'));
      }
      setState({ step: 'done', studentCode: payload.data.studentCode });
    } catch (cause) {
      setState((current) => current.step === 'password'
        ? { ...current, newPassword: '', confirmPassword: '', error: requestErrorMessage(cause, '비밀번호를 재설정하지 못했습니다.') }
        : current);
    } finally {
      setLoading(false);
    }
  }

  const activeStep = state.step === 'password' ? 'password' : 'verify';

  return (
    <AuthFrame
      mode="login"
      eyebrow="계정 복구"
      title="비밀번호 재설정"
      description="리로스쿨 계정으로 본인을 확인한 뒤 새 포털 비밀번호를 설정합니다."
    >
      {state.step !== 'done' ? (
        <div className="mb-7 flex items-center gap-3" aria-label={`재설정 단계: ${activeStep === 'verify' ? '1단계 본인 확인' : '2단계 새 비밀번호'}`}>
          <span className={cn('flex shrink-0 items-center gap-2 text-[11px] font-bold', activeStep === 'password' ? 'text-emerald-700' : 'text-slate-900')}>
            <span
              className={cn(
                'grid h-5 w-5 place-items-center rounded-full text-[10px] transition-all duration-300',
                activeStep === 'password' ? 'bg-emerald-700 text-white' : 'bg-slate-900 text-white',
              )}
            >
              {activeStep === 'password' ? <Check className="h-3 w-3" strokeWidth={3} /> : 1}
            </span>
            본인 확인
          </span>
          <span className="relative h-px flex-1 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-700 transition-[width] duration-500"
              style={{ width: activeStep === 'password' ? '100%' : '0%' }}
            />
          </span>
          <span className={cn('flex shrink-0 items-center gap-2 text-[11px] font-bold transition-colors duration-300', activeStep === 'password' ? 'text-slate-900' : 'text-slate-400')}>
            <span
              className={cn(
                'grid h-5 w-5 place-items-center rounded-full text-[10px] transition-all duration-300',
                activeStep === 'password' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-400',
              )}
            >
              2
            </span>
            새 비밀번호
          </span>
        </div>
      ) : null}

      {state.step === 'verify' && (
        <div key="verify" className="anim-rise space-y-5">
          <Tabs
            items={[
              { value: 'riro', label: '리로스쿨 인증' },
              { value: 'admin', label: '긴급 관리자 코드' },
            ]}
            value={state.method}
            onChange={selectMethod}
            className="w-full"
          />
          <form onSubmit={verifyIdentity} className="space-y-5" aria-busy={loading}>
            {state.method === 'riro' ? (
              <>
                <div className="flex items-start gap-2.5 rounded-2xl border border-blue-200/70 bg-blue-50/60 px-4 py-3.5 text-xs leading-5 text-blue-900">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  리로스쿨 계정은 본인 확인에만 사용하며 아이디와 비밀번호를 저장하지 않습니다.
                </div>
                <Field label="리로스쿨 아이디" required>
                  <Input
                    value={state.id}
                    onChange={(event) => setState((current) => current.step === 'verify' && current.method === 'riro'
                      ? { ...current, id: event.target.value }
                      : current)}
                    autoComplete="username"
                    maxLength={32}
                    required
                  />
                </Field>
                <Field label="리로스쿨 비밀번호" required>
                  <Input
                    type="password"
                    value={state.password}
                    onChange={(event) => setState((current) => current.step === 'verify' && current.method === 'riro'
                      ? { ...current, password: event.target.value }
                      : current)}
                    autoComplete="current-password"
                    maxLength={128}
                    required
                  />
                </Field>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/60 px-4 py-3.5 text-xs leading-5 text-amber-950">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  리로스쿨 인증을 이용할 수 없는 긴급 상황에만 운영자에게 일회용 코드를 요청하세요.
                </div>
                <Field label="관리자 비밀번호 재설정 코드" required>
                  <Input
                    value={state.code}
                    onChange={(event) => setState((current) => current.step === 'verify' && current.method === 'admin'
                      ? { ...current, code: event.target.value }
                      : current)}
                    autoComplete="one-time-code"
                    placeholder="운영자가 발급한 일회용 코드"
                    required
                  />
                </Field>
              </>
            )}
            {state.error ? (
              <p role="alert" className="anim-rise rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">{state.error}</p>
            ) : null}
            <Button type="submit" variant="green" disabled={loading} className="h-12 w-full text-[15px]">
              {loading ? <LoadingLabel>본인 확인 중</LoadingLabel> : <>본인 확인 <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>
        </div>
      )}

      {state.step === 'password' && (
        <form key="password" onSubmit={resetPassword} className="anim-rise space-y-5" aria-busy={loading}>
          <p className="flex items-center gap-2 rounded-2xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-3 text-sm font-semibold text-emerald-900">
            <ShieldCheck className="h-4 w-4 shrink-0" />학번 {state.studentCode}
          </p>
          <Field label="새 비밀번호" required hint="영문+숫자 10자 이상">
            <div className="relative">
              <Input
                type={state.showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={state.newPassword}
                onChange={(event) => setState((current) => current.step === 'password'
                  ? { ...current, newPassword: event.target.value }
                  : current)}
                className="pr-12"
                required
              />
              <button
                type="button"
                aria-label="비밀번호 표시 전환"
                onClick={() => setState((current) => current.step === 'password'
                  ? { ...current, showPassword: !current.showPassword }
                  : current)}
                className="absolute inset-y-1 right-1 grid w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                {state.showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="새 비밀번호 확인" required>
            <Input
              type={state.showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={state.confirmPassword}
              onChange={(event) => setState((current) => current.step === 'password'
                ? { ...current, confirmPassword: event.target.value }
                : current)}
              required
            />
          </Field>
          {state.error ? (
            <p role="alert" className="anim-rise rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">{state.error}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" disabled={loading} onClick={() => setState(initialState())}>
              <ArrowLeft className="h-4 w-4" />다시 인증
            </Button>
            <Button type="submit" disabled={loading} className="h-11 flex-1">
              {loading ? <LoadingLabel>변경 중</LoadingLabel> : '비밀번호 변경'}
            </Button>
          </div>
        </form>
      )}

      {state.step === 'done' && (
        <div key="done" className="anim-rise flex flex-col items-center py-4 text-center">
          <span className="anim-pop grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-lg font-bold tracking-[-0.02em] text-slate-950">비밀번호를 변경했습니다.</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">기존 로그인은 모두 종료되었습니다. 새 비밀번호로 다시 로그인해 주세요.</p>
          <Link
            href="/login"
            className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-800/60 bg-emerald-700 text-[15px] font-semibold text-white shadow-[var(--shadow-xs)] transition-colors duration-150 hover:bg-emerald-800 hover:shadow-[var(--shadow-sm)]"
          >
            학번 {state.studentCode}로 로그인
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}
