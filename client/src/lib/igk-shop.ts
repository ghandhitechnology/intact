export type ShopSlot = 'nicknameColor' | 'avatarRing' | 'title' | 'consumable';

export type ShopItem = {
  id: string;
  slot: ShopSlot;
  name: string;
  description: string;
  price: number;
  consumable: boolean;
  maxQuantity?: number;
  /** hex color applied to the nickname text (nicknameColor slot) */
  color?: string;
  /** css class applied to the avatar (avatarRing slot) */
  ringClass?: string;
};

export const STREAK_FREEZE_ITEM_ID = 'streak-freeze';
export const STREAK_FREEZE_MAX_QUANTITY = 3;

export const SHOP_SLOT_LABELS: Record<ShopSlot, string> = {
  nicknameColor: '닉네임 색상',
  avatarRing: '아바타 테두리',
  title: '칭호',
  consumable: '소모품',
};

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'nickname-blue',
    slot: 'nicknameColor',
    name: '바다 파랑',
    description: '닉네임을 파란색으로 표시합니다.',
    price: 300,
    consumable: false,
    color: '#2563eb',
  },
  {
    id: 'nickname-purple',
    slot: 'nicknameColor',
    name: '오로라 보라',
    description: '닉네임을 보라색으로 표시합니다.',
    price: 300,
    consumable: false,
    color: '#7c3aed',
  },
  {
    id: 'nickname-amber',
    slot: 'nicknameColor',
    name: '노을 주황',
    description: '닉네임을 주황색으로 표시합니다.',
    price: 300,
    consumable: false,
    color: '#d97706',
  },
  {
    id: 'nickname-rose',
    slot: 'nicknameColor',
    name: '벚꽃 분홍',
    description: '닉네임을 분홍색으로 표시합니다.',
    price: 300,
    consumable: false,
    color: '#e11d48',
  },
  {
    id: 'nickname-emerald',
    slot: 'nicknameColor',
    name: '숲 초록',
    description: '닉네임을 초록색으로 표시합니다.',
    price: 300,
    consumable: false,
    color: '#059669',
  },
  {
    id: 'ring-gold',
    slot: 'avatarRing',
    name: '골드 테두리',
    description: '아바타에 금빛 테두리를 두릅니다.',
    price: 500,
    consumable: false,
    ringClass: 'shop-ring-gold',
  },
  {
    id: 'ring-gradient',
    slot: 'avatarRing',
    name: '그라데이션 테두리',
    description: '아바타에 그라데이션 느낌의 이중 테두리를 두릅니다.',
    price: 800,
    consumable: false,
    ringClass: 'shop-ring-gradient',
  },
  {
    id: 'title-legend',
    slot: 'title',
    name: '전설의 인곽인',
    description: '닉네임 옆에 칭호를 표시합니다.',
    price: 400,
    consumable: false,
  },
  {
    id: 'title-nightowl',
    slot: 'title',
    name: '밤샘 장인',
    description: '닉네임 옆에 칭호를 표시합니다.',
    price: 400,
    consumable: false,
  },
  {
    id: 'title-question-hunter',
    slot: 'title',
    name: '질문 헌터',
    description: '닉네임 옆에 칭호를 표시합니다.',
    price: 400,
    consumable: false,
  },
  {
    id: 'title-answer-fairy',
    slot: 'title',
    name: '답변 요정',
    description: '닉네임 옆에 칭호를 표시합니다.',
    price: 400,
    consumable: false,
  },
  {
    id: 'title-lab-keeper',
    slot: 'title',
    name: '실험실 지킴이',
    description: '닉네임 옆에 칭호를 표시합니다.',
    price: 400,
    consumable: false,
  },
  {
    id: 'title-cafeteria-gourmet',
    slot: 'title',
    name: '급식 미식가',
    description: '닉네임 옆에 칭호를 표시합니다.',
    price: 400,
    consumable: false,
  },
  {
    id: STREAK_FREEZE_ITEM_ID,
    slot: 'consumable',
    name: '스트릭 프리즈',
    description: '출석을 하루 놓쳐도 다음 출석 때 자동으로 사용되어 연속 기록을 지켜 줍니다.',
    price: 200,
    consumable: true,
    maxQuantity: STREAK_FREEZE_MAX_QUANTITY,
  },
];

export function shopItemById(id: string) {
  return SHOP_ITEMS.find((item) => item.id === id) ?? null;
}

export type EquippedCosmetics = {
  nicknameColor?: string;
  avatarRing?: string;
  title?: string;
};

/**
 * Resolves equipped catalog item ids into display values
 * (hex color, ring css class, title text).
 */
export function cosmeticsFromItems(
  items?: Array<{ itemId: string }> | null,
): EquippedCosmetics | undefined {
  if (!items || items.length === 0) return undefined;
  const cosmetics: EquippedCosmetics = {};
  for (const owned of items) {
    const item = shopItemById(owned.itemId);
    if (!item) continue;
    if (item.slot === 'nicknameColor' && item.color) cosmetics.nicknameColor = item.color;
    if (item.slot === 'avatarRing' && item.ringClass) cosmetics.avatarRing = item.ringClass;
    if (item.slot === 'title') cosmetics.title = item.name;
  }
  return Object.keys(cosmetics).length > 0 ? cosmetics : undefined;
}

/** streak 1–2일 → 5, 3–6일 → 8, 7–29일 → 12, 30일 이상 → 20 */
export function attendanceRewardForStreak(streak: number) {
  const normalized = Math.max(1, Math.trunc(streak) || 1);
  if (normalized >= 30) return 20;
  if (normalized >= 7) return 12;
  if (normalized >= 3) return 8;
  return 5;
}
