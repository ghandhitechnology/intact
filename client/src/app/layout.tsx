import './globals.css';
import type { Metadata } from 'next';
import Wrapper from '@/components/Wrapper';
import PortalShell from '@/components/portal/PortalShell';
import PwaRegistration from '@/components/portal/PwaRegistration';
import NetworkStatus from '@/components/portal/NetworkStatus';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: {
    default: '인텍트 · 인천과학고 생활 포털',
    template: '%s · 인텍트',
  },
  description:
    '인천과학고 재학생을 위한 질문, 대회 모집, 자료 공유, 자유 커뮤니티',
  applicationName: '인텍트',
  keywords: ['인천과학고', '인곽', '커뮤니티', '학생 포털'],
  authors: [{ name: '하태욱' }],
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    siteName: '인텍트',
    title: '인텍트 · 인천과학고 생활 포털',
    description: '질문에 답하고, 팀을 만들고, 지식을 이어주는 우리 학교 커뮤니티',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '인텍트' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '인텍트 · 인천과학고 생활 포털',
    description: '인천과학고 재학생 전용 커뮤니티',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main-content">
          본문으로 바로가기
        </a>
        <Wrapper>
          <PortalShell>{children}</PortalShell>
          <PwaRegistration />
          <NetworkStatus />
        </Wrapper>
      </body>
    </html>
  );
}
