import prisma from '@/lib/prisma';
import { IGK_LEVELS } from '@/lib/igk-levels';
import { hashPassword, looksLikePlaceholderSecret } from './crypto';

const DEFAULT_BOARDS = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    slug: 'question',
    name: '질문게시판',
    description: '수업, 연구, 학교생활에 관해 묻고 답하는 공간',
    kind: 'QUESTION' as const,
    icon: 'circle-help',
    accentColor: '#167A5A',
    sortOrder: 10,
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    slug: 'contest',
    name: '대회모집',
    description: '대회와 프로젝트의 팀원을 찾는 공간',
    kind: 'RECRUITMENT' as const,
    icon: 'users',
    accentColor: '#1666A8',
    sortOrder: 20,
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    slug: 'resources',
    name: '자료공유',
    description: '학습 및 연구 자료를 안전하게 나누는 공간',
    kind: 'RESOURCE' as const,
    icon: 'folder-open',
    accentColor: '#2B7A9B',
    sortOrder: 30,
  },
  {
    id: '00000000-0000-4000-8000-000000000105',
    slug: 'equipment',
    name: '심화기기',
    description: '교내 심화기기의 보유 현황과 사용 방법을 묻고 답하는 공간',
    kind: 'QUESTION' as const,
    icon: 'microscope',
    accentColor: '#3157A4',
    sortOrder: 35,
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    slug: 'free',
    name: '자유게시판',
    description: '학교 구성원들이 자유롭게 이야기하는 공간',
    kind: 'STANDARD' as const,
    icon: 'messages-square',
    accentColor: '#24806A',
    sortOrder: 40,
  },
  {
    id: '00000000-0000-4000-8000-000000000106',
    slug: 'photos',
    name: '사진게시판',
    description: '학교생활의 순간을 여러 장의 사진으로 나누는 공간',
    kind: 'STANDARD' as const,
    icon: 'images',
    accentColor: '#7C3AED',
    sortOrder: 50,
  },
];

let initialization: Promise<void> | null = null;

async function initialize() {
  await prisma.board.createMany({ data: DEFAULT_BOARDS, skipDuplicates: true });
  await prisma.levelRule.createMany({
    data: IGK_LEVELS.map((rule) => ({ ...rule })),
    skipDuplicates: true,
  });

  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!initialPassword) return;
  if (
    process.env.NODE_ENV === 'production' &&
    (initialPassword.length < 16 || looksLikePlaceholderSecret(initialPassword))
  ) {
    throw new Error('ADMIN_INITIAL_PASSWORD must be a strong, non-placeholder value in production.');
  }
  const loginId = (process.env.ADMIN_INITIAL_ID || 'admin').trim();
  const adminName = process.env.ADMIN_INITIAL_NICKNAME?.trim() || '하태욱';
  const existing = await prisma.user.findUnique({ where: { loginId }, select: { id: true } });
  if (existing) return;

  const passwordHash = await hashPassword(initialPassword);
  await prisma.user.create({
    data: {
      loginId,
      nickname: adminName,
      realName: adminName,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      mustChangePassword: true,
    },
  });
}

export async function ensureSystemDefaults() {
  if (!initialization) {
    initialization = initialize().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
}
