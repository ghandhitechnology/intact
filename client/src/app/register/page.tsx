'use client';

import AuthFrame from '@/components/operations/AuthFrame';
import { apiErrorMessage, Button, Field, Input, LoadingLabel, readApiEnvelope } from '@/components/operations/ui';
import { ArrowRight, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import {
  isValidStudentCode,
  normalizeStudentCode,
  STUDENT_CODE_REQUIREMENTS,
} from '@/lib/student-code';

export default function RegisterPage() {
  const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === 'true';
  const [realName, setRealName] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState({ service: false, privacy: false, conduct: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const allTerms = terms.service && terms.privacy && terms.conduct;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedName = realName.normalize('NFKC').trim();
    const normalizedStudentCode = normalizeStudentCode(studentCode);
    if (!/^[\p{L} .'-]{2,40}$/u.test(normalizedName)) {
      setError('실명을 2~40자로 입력해 주세요.');
      return;
    }
    if (!isValidStudentCode(normalizedStudentCode)) {
      setError(STUDENT_CODE_REQUIREMENTS);
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
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            realName: normalizedName,
            studentCode: normalizedStudentCode,
            password,
          }),
        });
        const payload = await readApiEnvelope<{ user: { id: string } }>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(apiErrorMessage(payload, '계정을 만들지 못했습니다.'));
        }
      }
      setStudentCode(normalizedStudentCode);
      setPassword('');
      setPasswordConfirm('');
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '계정을 만들지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      mode="register"
      title={done ? '가입이 완료되었습니다' : '회원가입'}
    >
      {done ? (
        <div className="py-4 text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
          <h2 className="mt-5 text-xl font-black text-slate-950">{realName}님, 가입을 완료했습니다.</h2>
          <p className="mt-2 text-sm text-slate-600">로그인 학번 <strong className="text-blue-700">{studentCode}</strong></p>
          <Link href="/" className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 border border-blue-700 bg-blue-700 text-sm font-extrabold text-white hover:bg-blue-800">인텍트 시작하기 <ArrowRight className="h-4 w-4" /></Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <Field label="실명" required>
            <Input value={realName} onChange={(event) => setRealName(event.target.value)} autoComplete="name" maxLength={40} placeholder="이름" />
          </Field>
          <Field label="6자리 학번" required hint="31~33기 · 1학년 1~4반 · 01~20번">
            <Input inputMode="numeric" value={studentCode} onChange={(event) => setStudentCode(normalizeStudentCode(event.target.value))} autoComplete="username" maxLength={6} placeholder="예: 331101" />
          </Field>
          <Field label="비밀번호" required hint="영문+숫자 10자 이상">
            <div className="relative">
              <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="pr-12" placeholder="새 비밀번호" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="비밀번호 표시 전환" className="absolute right-0 top-0 grid h-11 w-11 place-items-center text-slate-400">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </div>
          </Field>
          <Field label="비밀번호 확인" required>
            <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="비밀번호 확인" />
          </Field>

          <div className="border border-slate-200">
            <label className="flex cursor-pointer items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-extrabold text-slate-900"><input type="checkbox" className="h-4 w-4 accent-blue-700" checked={allTerms} onChange={(event) => setTerms({ service: event.target.checked, privacy: event.target.checked, conduct: event.target.checked })} />필수 약관 전체 동의</label>
            {[
              ['service', '서비스 이용약관 동의', '/terms'],
              ['privacy', '개인정보 수집·이용 동의', '/privacy'],
              ['conduct', '커뮤니티 운영규칙 준수', '/rules'],
            ].map(([key, label, href]) => (
              <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-slate-600">
                <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" className="h-4 w-4 accent-blue-700" checked={terms[key as keyof typeof terms]} onChange={(event) => setTerms((current) => ({ ...current, [key]: event.target.checked }))} />[필수] {label}</label>
                <Link href={href} target="_blank" rel="noreferrer" className="shrink-0 font-bold text-slate-500 underline">보기</Link>
              </div>
            ))}
          </div>

          {error ? <p role="alert" className="text-xs font-medium text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading} className="h-12 w-full">{loading ? <LoadingLabel>계정 생성 중</LoadingLabel> : <>회원가입 <ArrowRight className="h-4 w-4" /></>}</Button>
          <div className="flex items-center justify-between border-t border-slate-200 pt-5 text-sm"><span className="text-slate-500">이미 계정이 있나요?</span><Link href="/login" className="font-extrabold text-blue-700 hover:underline">로그인</Link></div>
        </form>
      )}
    </AuthFrame>
  );
}
