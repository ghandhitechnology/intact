export type ShopSlot =
  | 'nicknameColor'
  | 'avatarRing'
  | 'title'
  | 'profileTheme'
  | 'postAccent'
  | 'consumable';

export type ShopCollection = 'core' | 'spring' | 'summer' | 'autumn' | 'winter';
export type ShopRarity = 'standard' | 'crafted' | 'signature';

export type ShopItem = {
  id: string;
  slot: ShopSlot;
  name: string;
  description: string;
  price: number;
  consumable: boolean;
  collection: ShopCollection;
  rarity: ShopRarity;
  maxQuantity?: number;
  color?: string;
  ringClass?: string;
  profileThemeClass?: string;
  postAccentClass?: string;
};

export const STREAK_FREEZE_ITEM_ID = 'streak-freeze';
export const STREAK_FREEZE_MAX_QUANTITY = 3;

export const SHOP_SLOT_LABELS: Record<ShopSlot, string> = {
  nicknameColor: '닉네임 팔레트',
  avatarRing: '아바타 궤도',
  title: '프로필 칭호',
  profileTheme: '프로필 배경',
  postAccent: '게시글 서명선',
  consumable: '소모품',
};

const core = (item: Omit<ShopItem, 'collection'>): ShopItem => ({ ...item, collection: 'core' });
const seasonal = (
  collection: Exclude<ShopCollection, 'core'>,
  item: Omit<ShopItem, 'collection'>,
): ShopItem => ({ ...item, collection });

export const SHOP_ITEMS: ShopItem[] = [
  core({ id: 'nickname-blue', slot: 'nicknameColor', name: '코발트 파장', description: '짙은 코발트색으로 이름을 또렷하게 표시합니다.', price: 150, consumable: false, rarity: 'standard', color: '#2563eb' }),
  core({ id: 'nickname-purple', slot: 'nicknameColor', name: '이온 바이올렛', description: '분광기의 보랏빛 파장처럼 이름을 표시합니다.', price: 200, consumable: false, rarity: 'standard', color: '#7c3aed' }),
  core({ id: 'nickname-amber', slot: 'nicknameColor', name: '나트륨 불꽃', description: '불꽃 반응의 선명한 주황빛을 적용합니다.', price: 200, consumable: false, rarity: 'standard', color: '#d97706' }),
  core({ id: 'nickname-rose', slot: 'nicknameColor', name: '스펙트럼 마젠타', description: '따뜻하고 선명한 마젠타 포인트를 적용합니다.', price: 250, consumable: false, rarity: 'crafted', color: '#e11d48' }),
  core({ id: 'nickname-emerald', slot: 'nicknameColor', name: '레이저 그린', description: '실험실 레이저 같은 에메랄드색을 적용합니다.', price: 300, consumable: false, rarity: 'crafted', color: '#059669' }),

  core({ id: 'ring-gold', slot: 'avatarRing', name: '황동 렌즈', description: '광학 장비의 황동 테두리를 닮은 단정한 링입니다.', price: 400, consumable: false, rarity: 'standard', ringClass: 'shop-ring-gold' }),
  core({ id: 'ring-gradient', slot: 'avatarRing', name: '프리즘 굴절', description: '빛이 갈라지는 프리즘 이중 링입니다.', price: 650, consumable: false, rarity: 'crafted', ringClass: 'shop-ring-gradient' }),
  core({ id: 'ring-orbit', slot: 'avatarRing', name: '원자 궤도', description: '전자 궤도를 얇은 청록 선으로 표현한 링입니다.', price: 700, consumable: false, rarity: 'crafted', ringClass: 'shop-ring-orbit' }),
  core({ id: 'ring-circuit', slot: 'avatarRing', name: '회로 기판', description: '작은 접점이 이어지는 회로형 링입니다.', price: 800, consumable: false, rarity: 'crafted', ringClass: 'shop-ring-circuit' }),
  core({ id: 'ring-observatory', slot: 'avatarRing', name: '관측 돔', description: '밤하늘과 관측 돔의 대비를 담은 시그니처 링입니다.', price: 900, consumable: false, rarity: 'signature', ringClass: 'shop-ring-observatory' }),

  core({ id: 'title-legend', slot: 'title', name: '인곽 기록 보관자', description: '좋은 질문과 기록을 오래 남기는 학생을 위한 칭호입니다.', price: 700, consumable: false, rarity: 'signature' }),
  core({ id: 'title-nightowl', slot: 'title', name: '심야 관측조', description: '늦은 시간에도 탐구를 이어가는 관측조 칭호입니다.', price: 350, consumable: false, rarity: 'standard' }),
  core({ id: 'title-question-hunter', slot: 'title', name: '질문 설계자', description: '문제를 정확히 정의하는 학생을 위한 칭호입니다.', price: 400, consumable: false, rarity: 'crafted' }),
  core({ id: 'title-answer-fairy', slot: 'title', name: '해설 검증자', description: '근거 있는 답변을 다듬는 학생을 위한 칭호입니다.', price: 400, consumable: false, rarity: 'crafted' }),
  core({ id: 'title-lab-keeper', slot: 'title', name: '실험대 정리반', description: '재현 가능한 실험은 정돈에서 시작된다는 칭호입니다.', price: 250, consumable: false, rarity: 'standard' }),
  core({ id: 'title-cafeteria-gourmet', slot: 'title', name: '급식 데이터 분석가', description: '매일의 식단에도 관찰과 기록을 놓치지 않는 칭호입니다.', price: 300, consumable: false, rarity: 'standard' }),

  core({ id: 'theme-observatory', slot: 'profileTheme', name: '천문대 야간표', description: '별자리 격자와 짙은 남색으로 구성한 프로필 배경입니다.', price: 1_500, consumable: false, rarity: 'signature', profileThemeClass: 'shop-theme-observatory' }),
  core({ id: 'theme-lab-grid', slot: 'profileTheme', name: '실험 노트', description: '연한 모눈과 측정 표시를 담은 밝은 프로필 배경입니다.', price: 700, consumable: false, rarity: 'standard', profileThemeClass: 'shop-theme-lab-grid' }),
  core({ id: 'theme-circuit', slot: 'profileTheme', name: '회로 설계도', description: '청록 회로 패턴을 절제된 선으로 구성한 배경입니다.', price: 1_100, consumable: false, rarity: 'crafted', profileThemeClass: 'shop-theme-circuit' }),
  core({ id: 'theme-campus', slot: 'profileTheme', name: '캠퍼스 석양', description: '교정의 저녁빛을 기하학적 색면으로 표현한 배경입니다.', price: 900, consumable: false, rarity: 'crafted', profileThemeClass: 'shop-theme-campus' }),

  core({ id: 'accent-formula', slot: 'postAccent', name: '수식 밑줄', description: '작성자 카드에 얇은 수식 격자 서명선을 더합니다.', price: 500, consumable: false, rarity: 'standard', postAccentClass: 'shop-accent-formula' }),
  core({ id: 'accent-spectrum', slot: 'postAccent', name: '분광 서명선', description: '게시글 작성자 영역에 절제된 스펙트럼 선을 더합니다.', price: 750, consumable: false, rarity: 'crafted', postAccentClass: 'shop-accent-spectrum' }),
  core({ id: 'accent-orbit', slot: 'postAccent', name: '궤도 서명선', description: '게시글 작성자 영역에 청록 궤도선을 더합니다.', price: 1_000, consumable: false, rarity: 'signature', postAccentClass: 'shop-accent-orbit' }),

  core({ id: STREAK_FREEZE_ITEM_ID, slot: 'consumable', name: '스트릭 프리즈', description: '출석을 하루 놓쳐도 다음 출석에서 자동으로 사용해 연속 기록을 지킵니다.', price: 200, consumable: true, rarity: 'standard', maxQuantity: STREAK_FREEZE_MAX_QUANTITY }),

  seasonal('spring', { id: 'spring-ring-bloom', slot: 'avatarRing', name: '봄빛 회절', description: '연분홍 회절 무늬를 담은 봄 한정 링입니다.', price: 650, consumable: false, rarity: 'crafted', ringClass: 'shop-ring-spring' }),
  seasonal('spring', { id: 'spring-theme-field', slot: 'profileTheme', name: '봄 관측일지', description: '연두 모눈과 분홍 관측점으로 구성한 봄 배경입니다.', price: 1_000, consumable: false, rarity: 'crafted', profileThemeClass: 'shop-theme-spring' }),
  seasonal('spring', { id: 'spring-accent-wave', slot: 'postAccent', name: '새싹 파형', description: '연두 파형 서명선을 게시글에 적용합니다.', price: 600, consumable: false, rarity: 'standard', postAccentClass: 'shop-accent-spring' }),
  seasonal('spring', { id: 'spring-title', slot: 'title', name: '봄 학기 첫 관측', description: '새 학기의 첫 기록을 기념하는 칭호입니다.', price: 600, consumable: false, rarity: 'standard' }),

  seasonal('summer', { id: 'summer-ring-solar', slot: 'avatarRing', name: '태양 플레어', description: '태양 활동의 황금빛을 담은 여름 한정 링입니다.', price: 800, consumable: false, rarity: 'crafted', ringClass: 'shop-ring-summer' }),
  seasonal('summer', { id: 'summer-theme-deepsea', slot: 'profileTheme', name: '심해 스펙트럼', description: '짙은 청색과 형광 관측선을 조합한 여름 배경입니다.', price: 1_200, consumable: false, rarity: 'signature', profileThemeClass: 'shop-theme-summer' }),
  seasonal('summer', { id: 'summer-accent-signal', slot: 'postAccent', name: '여름 신호', description: '청색 신호 파형을 게시글 서명선으로 적용합니다.', price: 700, consumable: false, rarity: 'crafted', postAccentClass: 'shop-accent-summer' }),
  seasonal('summer', { id: 'summer-title', slot: 'title', name: '하계 연구조', description: '방학에도 탐구를 계속하는 학생을 위한 칭호입니다.', price: 650, consumable: false, rarity: 'standard' }),

  seasonal('autumn', { id: 'autumn-ring-copper', slot: 'avatarRing', name: '구리 산화환', description: '구리와 적갈색이 겹치는 가을 한정 링입니다.', price: 700, consumable: false, rarity: 'crafted', ringClass: 'shop-ring-autumn' }),
  seasonal('autumn', { id: 'autumn-theme-archive', slot: 'profileTheme', name: '연구 기록실', description: '종이색 격자와 붉은 색인을 담은 가을 배경입니다.', price: 900, consumable: false, rarity: 'crafted', profileThemeClass: 'shop-theme-autumn' }),
  seasonal('autumn', { id: 'autumn-accent-data', slot: 'postAccent', name: '수확 데이터', description: '적갈색 데이터 점을 게시글 서명선으로 적용합니다.', price: 650, consumable: false, rarity: 'standard', postAccentClass: 'shop-accent-autumn' }),
  seasonal('autumn', { id: 'autumn-title', slot: 'title', name: '결과 정리 중', description: '한 학기의 데이터를 차분히 정리하는 칭호입니다.', price: 600, consumable: false, rarity: 'standard' }),

  seasonal('winter', { id: 'winter-ring-aurora', slot: 'avatarRing', name: '오로라 자기장', description: '청록 오로라를 담은 겨울 한정 링입니다.', price: 900, consumable: false, rarity: 'signature', ringClass: 'shop-ring-winter' }),
  seasonal('winter', { id: 'winter-theme-polar', slot: 'profileTheme', name: '극지 관측소', description: '빙정 격자와 오로라 선으로 구성한 겨울 배경입니다.', price: 1_400, consumable: false, rarity: 'signature', profileThemeClass: 'shop-theme-winter' }),
  seasonal('winter', { id: 'winter-accent-crystal', slot: 'postAccent', name: '결정 구조', description: '육각 결정선을 게시글 서명선으로 적용합니다.', price: 800, consumable: false, rarity: 'crafted', postAccentClass: 'shop-accent-winter' }),
  seasonal('winter', { id: 'winter-title', slot: 'title', name: '동계 관측 당번', description: '차가운 밤의 관측 기록을 지키는 칭호입니다.', price: 700, consumable: false, rarity: 'crafted' }),
];

export function seoulShopSeason(date = new Date()): Exclude<ShopCollection, 'core'> {
  const month = Number(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
  }).format(date));
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export function isShopItemAvailable(item: ShopItem, date = new Date()) {
  return item.collection === 'core' || item.collection === seoulShopSeason(date);
}

export function shopItemById(id: string) {
  return SHOP_ITEMS.find((item) => item.id === id) ?? null;
}

export type EquippedCosmetics = {
  nicknameColor?: string;
  avatarRing?: string;
  title?: string;
  profileTheme?: string;
  postAccent?: string;
};

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
    if (item.slot === 'profileTheme' && item.profileThemeClass) cosmetics.profileTheme = item.profileThemeClass;
    if (item.slot === 'postAccent' && item.postAccentClass) cosmetics.postAccent = item.postAccentClass;
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
