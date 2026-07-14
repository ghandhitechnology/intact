import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '인텍트 · 인천과학고 생활 포털',
    short_name: '인텍트',
    description: '인천과학고 재학생 전용 커뮤니티',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f7f6',
    theme_color: '#087a55',
    lang: 'ko',
    categories: ['education', 'social'],
  };
}
