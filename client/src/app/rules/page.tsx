import PolicyLayout from '@/components/portal/PolicyLayout';

export const metadata = { title: '커뮤니티 규칙' };

export default function RulesPage() {
  return (
    <PolicyLayout
      title="인텍트 커뮤니티 규칙"
      description="어렵게 쓴 규칙 아닙니다. 사람답게 말하고, 이상한 짓만 안 하면 됩니다."
    >
      <h2>1. 사람을 공격하지 말아요</h2>
      <p>욕설, 조롱, 따돌림, 신상 털기, 성적·외모·가정환경에 대한 비하를 금지합니다. 비판은 행동과 내용에 한정해 주세요.</p>
      <h2>2. 자료의 주인을 존중해요</h2>
      <p>저작권, 개인정보, 대회 보안 규정을 어긴 자료를 올리지 않습니다. 타인의 수행평가 결과물은 반드시 허락을 받습니다.</p>
      <h2>3. 도배와 보상 조작을 하지 말아요</h2>
      <p>IGK를 얻기 위한 도배, 복수 계정, 추천 교환, 허위 모집은 보상 회수와 이용 제한 대상입니다.</p>
      <h2>4. 문제는 신고로 해결해요</h2>
      <p>맞저격하면 일만 커집니다. 신고하면 운영자가 바로 보고, 정말 이상하면 삭제하고 제재합니다.</p>
    </PolicyLayout>
  );
}
