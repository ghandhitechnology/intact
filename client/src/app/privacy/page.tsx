export const metadata = { title: '개인정보 처리방침' };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="anim-rise px-1 pb-5 pt-2">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-slate-950">개인정보 처리방침</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">인텍트는 재학생 확인과 서비스 운영에 필요한 정보만 처리합니다.</p>
      </header>
      <article className="policy-content anim-rise anim-delay-1 rounded-2xl border border-slate-200/90 bg-white px-5 py-7 shadow-[var(--shadow-xs)] md:px-9 md:py-9">
        <h2>수집하는 정보</h2>
        <p>학번, 기수, 실명, 닉네임, 포털 비밀번호 해시, 접속·안전 기록, 커뮤니티 활동 기록을 처리합니다. 실명은 중복 가입 방지와 운영 확인에만 사용하며 일반 회원에게 노출하지 않습니다.</p>
        <h2>계정 가입</h2>
        <p>회원가입, 재학생 재인증, 비밀번호 복구 시 리로스쿨 계정으로 재학생 여부와 본인 계정을 확인합니다. 리로스쿨 아이디·비밀번호·로그인 토큰은 인증 요청 중에만 사용하며 저장하지 않습니다. 인증 결과로 확인한 이름과 학적 정보는 중복 가입 방지와 계정 운영을 위해 처리합니다.</p>
        <h2>보존과 파기</h2>
        <p>탈퇴 처리된 계정은 즉시 로그인을 차단합니다. 작성 콘텐츠와 제재·감사 기록의 삭제 범위·보존 기간은 학교 책임자가 승인한 정책을 따르며, 개별 삭제 요청은 문의·신고 절차로 접수합니다.</p>
        <h2>회원의 권리</h2>
        <p>회원은 내 정보에서 프로필·활동 정보를 확인하고, 닉네임 수정과 다른 기기 세션 종료를 수행할 수 있습니다. 계정 탈퇴·정보 삭제 요청은 문의·신고로 접수합니다.</p>
      </article>
    </div>
  );
}
