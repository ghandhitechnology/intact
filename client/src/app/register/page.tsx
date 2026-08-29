'use client';

import AuthFrame from '@/components/operations/AuthFrame';
import { apiErrorMessage, Button, cn, Field, Input, LoadingLabel, readApiEnvelope } from '@/components/operations/ui';
import { fetchWithTimeout, requestErrorMessage } from '@/lib/client/request';
import { isValidStudentCode, normalizeStudentCode, STUDENT_CODE_REQUIREMENTS } from '@/lib/student-code';
import { ArrowRight, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { usePortalSession } from '@/components/portal/SessionProvider';

interface RiroVerification {
  verificationTicket: string;
  expiresAt: string;
  profile: {
    name: string;
    studentCode: string;
  };
}

export default function RegisterPage() {
  const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === 'true';
  const { refresh: refreshSession } = usePortalSession();
  const [riroId, setRiroId] = useState('');
  const [riroPassword, setRiroPassword] = useState('');
  const [verification, setVerification] = useState<RiroVerification | null>(null);
  const [studentCode, setStudentCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState({ service: false, privacy: false, conduct: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const allTerms = terms.service && terms.privacy && terms.conduct;

  async function verifyRiro(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    if (riroId.trim().length < 2 || !riroPassword) {
      setError('리로스쿨 아이디와 비밀번호를 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetchWithTimeout('/api/auth/riro/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: riroId.trim(), password: riroPassword }),
      }, 30_000);
      const payload = await readApiEnvelope<RiroVerification>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, '리로스쿨 인증에 실패했습니다.'));
      }
      setVerification(payload.data);
      setRiroPassword('');
    } catch (cause) {
      setError(requestErrorMessage(cause, '리로스쿨 인증에 실패했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !verification) return;
    setError(null);
    const normalizedStudentCode = normalizeStudentCode(studentCode);
    if (!isValidStudentCode(normalizedStudentCode)) {
      setError(STUDENT_CODE_REQUIREMENTS);
      return;
    }
    if (normalizedStudentCode !== verification.profile.studentCode) {
      setError('입력한 학번이 리로스쿨 학적 정보와 일치하지 않습니다.');
      return;
    }
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('비밀번호는 영문과 숫자를 포함해 10자 이상이어야 합니다.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    if (!allTerms) {
      setError('필수 약관에 모두 동의해 주세요.');
      return;
    }

    setLoading(true);
    try {
      if (!demoMode) {
        const response = await fetchWithTimeout('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            verificationTicket: verification.verificationTicket,
            studentCode: normalizedStudentCode,
            password,
          }),
        });
        const payload = await readApiEnvelope<{ user: { id: string } }>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(apiErrorMessage(payload, '계정을 만들지 못했습니다.'));
        }
        // Registration signs the user in via Set-Cookie; refresh the session
        // context so the home link on the done screen lands in the portal.
        await refreshSession();
      }
      setStudentCode(normalizedStudentCode);
      setPassword('');
      setPasswordConfirm('');
      setDone(true);
    } catch (cause) {
      setError(requestErrorMessage(cause, '계정을 만들지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  const step = done ? 'done' : verification ? 'account' : 'verify';

  return (
    <AuthFrame mode="register" title={done ? '가입이 완료되었습니다' : '회원가입'}>
      {!done ? (
        <div className="mb-7 flex items-center gap-3" aria-label={`가입 단계: ${step === 'verify' ? '1단계 재학생 인증' : '2단계 계정 설정'}`}>
          <span className={cn('flex shrink-0 items-center gap-2 text-[11px] font-bold', verification ? 'text-emerald-700' : 'text-slate-900')}>
            <span
              className={cn(
                'grid h-5 w-5 place-items-center rounded-full text-[10px] transition-all duration-300',
                verification ? 'bg-emerald-700 text-white' : 'bg-slate-900 text-white',
              )}
            >
              {verification ? <Check className="h-3 w-3" strokeWidth={3} /> : 1}
            </span>
            재학생 인증
          </span>
          <span className="relative h-px flex-1 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-700 transition-[width] duration-500"
              style={{ width: verification ? '100%' : '0%' }}
            />
          </span>
          <span className={cn('flex shrink-0 items-center gap-2 text-[11px] font-bold transition-colors duration-300', verification ? 'text-slate-900' : 'text-slate-400')}>
            <span
              className={cn(
                'grid h-5 w-5 place-items-center rounded-full text-[10px] transition-all duration-300',
                verification ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-400',
              )}
            >
              2
            </span>
            계정 설정
          </span>
        </div>
      ) : null}

      {done ? (
        <div key="done" className="anim-rise flex flex-col items-center py-4 text-center">
          <span className="anim-pop grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-lg font-bold tracking-[-0.02em] text-slate-950">{verification?.profile.name}님, 가입을 마쳤습니다.</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">로그인할 때 사용할 학번은 <strong className="font-bold text-slate-900">{studentCode}</strong>입니다.</p>
          <Link href="/" className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-800/60 bg-emerald-700 text-[15px] font-semibold text-white shadow-[var(--shadow-xs)] transition-colors duration-150 hover:bg-emerald-800 hover:shadow-[var(--shadow-sm)]">
            인텍트 시작하기 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : !verification ? (
        <form key="verify" onSubmit={verifyRiro} className="anim-rise space-y-5" aria-busy={loading}>
          <div className="rounded-2xl border border-blue-200/70 bg-blue-50/60 px-4 py-3.5 text-sm leading-6 text-blue-950">
            <p className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-4 w-4 shrink-0" />1단계 · 인천과학고등학교 리로스쿨 재학생 인증</p>
            <p className="mt-1 text-xs leading-5 text-blue-800">인천과학고등학교 리로스쿨(iscience.riroschool.kr) 계정은 본인 확인에만 사용하며 아이디, 비밀번호, 로그인 토큰을 저장하지 않습니다.</p>
          </div>
          <Field label="리로스쿨 아이디" required>
            <Input value={riroId} onChange={(event) => setRiroId(event.target.value)} autoComplete="username" maxLength={32} placeholder="리로스쿨 아이디" />
          </Field>
          <Field label="리로스쿨 비밀번호" required>
            <Input type="password" value={riroPassword} onChange={(event) => setRiroPassword(event.target.value)} autoComplete="current-password" maxLength={128} placeholder="리로스쿨 비밀번호" />
          </Field>
          {error ? (
            <p role="alert" className="anim-rise rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">{error}</p>
          ) : null}
          <Button type="submit" disabled={loading} className="h-12 w-full text-[15px]">{loading ? <LoadingLabel>리로스쿨 확인 중</LoadingLabel> : <><ShieldCheck className="h-4 w-4" />리로스쿨 인증</>}</Button>
          <div className="flex items-center justify-between border-t border-slate-100 pt-5 text-[13px]">
            <span className="text-slate-500">이미 계정이 있나요?</span>
            <Link href="/login" className="font-semibold text-emerald-800 underline decoration-emerald-300 underline-offset-4 transition-colors hover:decoration-emerald-700">로그인</Link>
          </div>
        </form>
      ) : (
        <form key="account" onSubmit={createAccount} className="anim-rise space-y-5" aria-busy={loading}>
          <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-3.5 text-sm leading-6 text-emerald-950">
            <p className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-4 w-4 shrink-0" />인천과학고등학교 리로스쿨 인증 완료</p>
            <p className="mt-1 text-xs leading-5 text-emerald-800">{verification.profile.name} 학생으로 확인했습니다. 포털에서 사용할 학번과 별도 비밀번호를 설정하세요.</p>
          </div>
          <Field label="6자리 학번" required hint="리로스쿨에 등록된 현재 학번을 입력하세요.">
            <Input inputMode="numeric" value={studentCode} onChange={(event) => setStudentCode(normalizeStudentCode(event.target.value))} autoComplete="username" maxLength={6} placeholder="예: 331101" />
          </Field>
          <Field label="포털 비밀번호" required hint="리로스쿨 비밀번호와 다른 비밀번호 사용 권장 · 영문+숫자 10자 이상">
            <div className="relative">
              <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="pr-12" placeholder="새 포털 비밀번호" />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label="비밀번호 표시 전환"
                className="absolute inset-y-1 right-1 grid w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="포털 비밀번호 확인" required>
            <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="비밀번호 확인" />
          </Field>
          <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-[var(--shadow-xs)]">
            <label className="flex cursor-pointer items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100/70">
              <input type="checkbox" className="h-4 w-4 rounded accent-emerald-700" checked={allTerms} onChange={(event) => setTerms({ service: event.target.checked, privacy: event.target.checked, conduct: event.target.checked })} />
              필수 약관 전체 동의
            </label>
            {[
              ['service', '서비스 이용약관 동의', '/terms'],
              ['privacy', '개인정보 수집·이용 동의', '/privacy'],
              ['conduct', '커뮤니티 운영규칙 준수', '/rules'],
            ].map(([key, label, href]) => (
              <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-slate-600">
                <label className="flex cursor-pointer items-center gap-3">
                  <input type="checkbox" className="h-4 w-4 rounded accent-emerald-700" checked={terms[key as keyof typeof terms]} onChange={(event) => setTerms((current) => ({ ...current, [key]: event.target.checked }))} />
                  [필수] {label}
                </label>
                <Link href={href} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-slate-400 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-slate-700">보기</Link>
              </div>
            ))}
          </div>
          {error ? (
            <p role="alert" className="anim-rise rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">{error}</p>
          ) : null}
          <Button type="submit" disabled={loading} className="h-12 w-full text-[15px]">{loading ? <LoadingLabel>계정 생성 중</LoadingLabel> : <>회원가입 <ArrowRight className="h-4 w-4" /></>}</Button>
          <button type="button" onClick={() => { setVerification(null); setStudentCode(''); setError(null); }} className="w-full text-xs font-semibold text-slate-400 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-slate-600">다른 리로스쿨 계정으로 다시 인증</button>
        </form>
      )}
    </AuthFrame>
  );
}
