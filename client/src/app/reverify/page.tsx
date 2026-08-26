'use client';

import AuthFrame from '@/components/operations/AuthFrame';
import {
  apiErrorMessage,
  Button,
  Field,
  Input,
  LoadingLabel,
  readApiEnvelope,
  Tabs,
} from '@/components/operations/ui';
import { fetchWithTimeout, requestErrorMessage } from '@/lib/client/request';
import { CheckCircle2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useRef, useState } from 'react';

type ReverificationResult = {
  verificationTicket: string;
  expiresAt: string;
  profile: { name: string; studentCode: string };
};

type ReverifyMethod = 'riro' | 'admin';

type ReverifyState =
  | { step: 'verify'; method: 'riro'; id: string; password: string; error: string }
  | { step: 'verify'; method: 'admin'; code: string; error: string }
  | { step: 'completion'; method: ReverifyMethod; verificationTicket: string; error: string }
  | { step: 'done' };

function verificationState(method: ReverifyMethod = 'riro', error = ''): ReverifyState {
  return method === 'riro'
    ? { step: 'verify', method, id: '', password: '', error }
    : { step: 'verify', method, code: '', error };
}

export default function ReverifyPage() {
  const router = useRouter();
  const [state, setState] = useState<ReverifyState>(() => verificationState());
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const requestInFlightRef = useRef(false);

  function selectMethod(method: ReverifyMethod) {
    if (requestInFlightRef.current || loading || loggingOut) return;
    setState(verificationState(method));
  }

  function beginRequest() {
    if (requestInFlightRef.current) return false;
    requestInFlightRef.current = true;
    setLoading(true);
    return true;
  }

  function endRequest() {
    requestInFlightRef.current = false;
    setLoading(false);
  }

  async function completeReverification(verificationTicket: string, method: ReverifyMethod) {
    try {
      const response = await fetchWithTimeout('/api/auth/reverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verificationTicket }),
      }, 12_000);
      const body = await readApiEnvelope<{ reverified: boolean }>(response);
      if (!response.ok || !body?.ok) {
        const message = apiErrorMessage(body, '재인증을 완료하지 못했습니다.');
        if (body && !body.ok && body.error.code === 'INVALID_TICKET') {
          setState(verificationState(method, message));
          return;
        }
        setState({ step: 'completion', method, verificationTicket, error: message });
        return;
      }

      setState({ step: 'done' });
      window.setTimeout(() => {
        router.replace('/');
        router.refresh();
      }, 900);
    } catch (cause) {
      setState({
        step: 'completion',
        method,
        verificationTicket,
        error: requestErrorMessage(cause, '재인증을 완료하지 못했습니다.'),
      });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || loggingOut || state.step !== 'verify' || !beginRequest()) return;

    const submitted = state;
    setState((current) => current.step === 'verify' ? { ...current, error: '' } : current);
    try {
      let verificationTicket: string;
      if (submitted.method === 'riro') {
        if (submitted.id.trim().length < 2 || !submitted.password) {
          throw new Error('리로스쿨 아이디와 비밀번호를 입력해 주세요.');
        }
        const verificationResponse = await fetchWithTimeout('/api/auth/riro/reverify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: submitted.id.trim(), password: submitted.password }),
        }, 30_000);
        const verificationBody = await readApiEnvelope<ReverificationResult>(verificationResponse);
        if (!verificationResponse.ok || !verificationBody?.ok) {
          throw new Error(apiErrorMessage(verificationBody, '리로스쿨 재학생 인증에 실패했습니다.'));
        }
        verificationTicket = verificationBody.data.verificationTicket;
      } else {
        if (!submitted.code.trim()) throw new Error('관리자 재인증 코드를 입력해 주세요.');
        const verificationResponse = await fetchWithTimeout('/api/auth/invite/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: submitted.code.trim(), purpose: 'REVERIFY' }),
        }, 12_000);
        const verificationBody = await readApiEnvelope<ReverificationResult>(verificationResponse);
        if (!verificationResponse.ok || !verificationBody?.ok) {
          throw new Error(apiErrorMessage(verificationBody, '관리자 재인증 코드를 확인하지 못했습니다.'));
        }
        verificationTicket = verificationBody.data.verificationTicket;
      }

      setState({ step: 'completion', method: submitted.method, verificationTicket, error: '' });
      await completeReverification(verificationTicket, submitted.method);
    } catch (cause) {
      const message = requestErrorMessage(cause, '재인증을 완료하지 못했습니다.');
      setState((current) => {
        if (current.step !== 'verify' || current.method !== submitted.method) return current;
        return current.method === 'riro'
          ? { ...current, password: '', error: message }
          : { ...current, code: '', error: message };
      });
    } finally {
      endRequest();
    }
  }

  async function retryCompletion() {
    if (loading || loggingOut || state.step !== 'completion' || !beginRequest()) return;

    const submitted = state;
    setState({ ...submitted, error: '' });
    try {
      await completeReverification(submitted.verificationTicket, submitted.method);
    } finally {
      endRequest();
    }
  }

  function resetVerification() {
    if (requestInFlightRef.current || loading || loggingOut || state.step !== 'completion') return;
    setState(verificationState(state.method));
  }

  async function switchAccount() {
    if (loading || loggingOut || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setLoggingOut(true);
    setState(verificationState());
    try {
      const response = await fetchWithTimeout('/api/auth/logout', { method: 'POST' }, 12_000);
      const body = await readApiEnvelope<{ loggedOut: boolean }>(response);
      if (!response.ok || !body?.ok) {
        throw new Error(apiErrorMessage(body, '로그아웃하지 못했습니다.'));
      }
      router.replace('/login');
      router.refresh();
    } catch (cause) {
      setState({
        step: 'verify',
        method: 'riro',
        id: '',
        password: '',
        error: requestErrorMessage(cause, '로그아웃하지 못했습니다.'),
      });
      requestInFlightRef.current = false;
      setLoggingOut(false);
    }
  }

  return (
    <AuthFrame mode="register" eyebrow="재학생 자격 갱신" title="재학생 재인증" description="리로스쿨 학적으로 재학생 여부를 확인하면 기존 계정과 활동 기록이 그대로 유지됩니다.">
      {state.step === 'done' ? (
        <div className="anim-rise flex flex-col items-center py-6 text-center">
          <span className="anim-pop grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-lg font-bold tracking-[-0.02em] text-slate-950">재인증을 완료했습니다</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">잠시 후 인텍트 홈으로 이동합니다.</p>
        </div>
      ) : (
        <div className="anim-rise space-y-5">
          {state.step === 'verify' ? (
            <>
              <Tabs
                items={[
                  { value: 'riro', label: '리로스쿨 인증' },
                  { value: 'admin', label: '긴급 관리자 코드' },
                ]}
                value={state.method}
                onChange={selectMethod}
                className="w-full"
              />

              <form onSubmit={submit} className="space-y-5" aria-busy={loading || loggingOut}>
                {state.method === 'riro' ? (
                  <>
                    <div className="flex items-start gap-2.5 rounded-2xl border border-blue-200/70 bg-blue-50/60 px-4 py-3.5 text-xs leading-5 text-blue-900">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                      리로스쿨 계정은 재학생 확인에만 사용하며 아이디와 비밀번호를 저장하지 않습니다.
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
                    <Field label="관리자 재인증 코드" required>
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
                <Button type="submit" disabled={loading || loggingOut} className="h-12 w-full text-[15px]">
                  {loading ? <LoadingLabel>재학생 확인 중</LoadingLabel> : <><RefreshCw size={16} />재인증 완료하기</>}
                </Button>
              </form>
            </>
          ) : (
            <div className="space-y-5" aria-busy={loading || loggingOut}>
              <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-3.5 text-xs leading-5 text-emerald-950">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">본인 확인을 마쳤습니다.</p>
                  <p className="mt-1 text-emerald-800">발급된 인증으로 포털 재인증 반영만 다시 시도할 수 있습니다.</p>
                </div>
              </div>
              {state.error ? (
                <p role="alert" className="anim-rise rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">{state.error}</p>
              ) : null}
              <Button
                type="button"
                onClick={() => void retryCompletion()}
                disabled={loading || loggingOut}
                className="h-12 w-full text-[15px]"
              >
                {loading ? <LoadingLabel>재인증 마무리 중</LoadingLabel> : <><RefreshCw size={16} />재인증 완료 다시 시도</>}
              </Button>
              <button
                type="button"
                onClick={resetVerification}
                disabled={loading || loggingOut}
                className="w-full text-xs font-semibold text-slate-500 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                인증 방법 다시 선택
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => void switchAccount()}
            disabled={loading || loggingOut}
            className="flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <LogOut className="h-3.5 w-3.5" />
            {loggingOut ? '로그아웃 중' : '로그아웃하고 다른 계정으로 전환'}
          </button>
        </div>
      )}
    </AuthFrame>
  );
}
