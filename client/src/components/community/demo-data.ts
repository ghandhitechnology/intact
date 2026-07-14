export type BoardSlug = 'question' | 'contest' | 'resources' | 'equipment' | 'free';

export type Member = {
  nickname: string;
  studentId: string;
  level: number;
  initials: string;
  profileImage?: string | null;
  accent: 'emerald' | 'blue' | 'slate' | 'violet' | 'amber';
};

export type BoardDefinition = {
  slug: BoardSlug;
  title: string;
  shortTitle: string;
  description: string;
  prompt: string;
  icon: 'question' | 'contest' | 'resources' | 'equipment' | 'free';
  accent: 'emerald' | 'blue' | 'teal' | 'indigo';
  postCount: number;
  todayCount: number;
  todayCommentCount?: number;
  weeklyPostCount?: number;
  weeklyCommentCount?: number;
  tags: string[];
};

export type PostSummary = {
  id: string;
  board: BoardSlug;
  title: string;
  excerpt: string;
  content?: string;
  author: Member;
  createdAt: string;
  updatedAt?: string;
  sortAt?: number;
  comments: number;
  views: number;
  likes: number;
  tags: string[];
  hot?: boolean;
  solved?: boolean;
  notice?: boolean;
  attachmentCount?: number;
  attachments?: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  deadline?: string;
  commentItems?: Array<{
    id: string;
    parentId?: string | null;
    author: Member;
    createdAt: string;
    createdAtRaw?: number;
    likes: number;
    viewerRecommended?: boolean;
    accepted: boolean;
    content: string;
  }>;
  viewer?: Member;
  viewerRecommended?: boolean;
  viewerBookmarked?: boolean;
};

export type Notice = {
  id: string;
  title: string;
  date: string;
  label: '필독' | '업데이트' | '안내';
  important?: boolean;
};

export type RankingMember = Member & {
  rank: number;
  igk: number;
  change: number;
};

export const boards: BoardDefinition[] = [
  {
    slug: 'question',
    title: '질문게시판',
    shortTitle: '질문',
    description: '수업부터 연구까지, 막힌 지점을 함께 해결해요.',
    prompt: '궁금한 것을 구체적으로 적으면 더 좋은 답변을 받을 수 있어요.',
    icon: 'question',
    accent: 'emerald',
    postCount: 1284,
    todayCount: 18,
    tags: ['수학', '물리', '화학', '생명과학', '정보', '연구'],
  },
  {
    slug: 'contest',
    title: '대회모집',
    shortTitle: '대회모집',
    description: '같이 도전할 팀원과 교내외 기회를 찾아보세요.',
    prompt: '대회명, 모집 분야, 마감일과 필요한 역할을 적어 주세요.',
    icon: 'contest',
    accent: 'blue',
    postCount: 347,
    todayCount: 6,
    tags: ['해커톤', '올림피아드', '연구대회', '공모전', '팀원모집'],
  },
  {
    slug: 'resources',
    title: '자료공유',
    shortTitle: '자료공유',
    description: '검증된 학습 자료와 실험 노하우를 차곡차곡.',
    prompt: '출처와 활용 방법을 함께 남기고 저작권을 꼭 확인해 주세요.',
    icon: 'resources',
    accent: 'teal',
    postCount: 896,
    todayCount: 9,
    tags: ['내신', '기출', '실험', '보고서', '코딩', '진로'],
  },
  {
    slug: 'equipment',
    title: '심화기기',
    shortTitle: '심화기기',
    description: '교내 심화기기 보유 현황과 사용 방법을 묻고 답해요.',
    prompt: '기기명, 사용 목적, 필요한 측정 범위를 함께 적어 주세요.',
    icon: 'equipment',
    accent: 'blue',
    postCount: 126,
    todayCount: 4,
    tags: ['보유기기', '사용법', '예약', '분석', '안전', '실험실'],
  },
  {
    slug: 'free',
    title: '자유게시판',
    shortTitle: '자유',
    description: '학교생활의 크고 작은 이야기를 편하게 나눠요.',
    prompt: '친절한 말투와 서로의 경계를 지키는 대화를 부탁해요.',
    icon: 'free',
    accent: 'indigo',
    postCount: 4221,
    todayCount: 41,
    tags: ['일상', '급식', '기숙사', '동아리', '추천', '잡담'],
  },
];

export const members: Member[] = [
  {
    nickname: '김민준',
    studentId: '251103',
    level: 12,
    initials: '김',
    profileImage: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=128&q=80',
    accent: 'emerald',
  },
  {
    nickname: '이서연',
    studentId: '240207',
    level: 9,
    initials: '이',
    accent: 'blue',
  },
  {
    nickname: '박지우',
    studentId: '251016',
    level: 7,
    initials: '박',
    accent: 'violet',
  },
  {
    nickname: '최도윤',
    studentId: '230412',
    level: 18,
    initials: '최',
    accent: 'amber',
  },
  {
    nickname: '정하린',
    studentId: '240311',
    level: 11,
    initials: '정',
    accent: 'slate',
  },
  {
    nickname: '한예준',
    studentId: '250204',
    level: 5,
    initials: '한',
    accent: 'blue',
  },
];

export const adminMember: Member = {
  nickname: '인텍트 운영팀',
  studentId: 'ADMIN',
  level: 99,
  initials: '관',
  accent: 'emerald',
};

export const posts: PostSummary[] = [
  {
    id: 'q-1042',
    board: 'question',
    title: '라그랑주 승수법에서 제약식의 기하학적 의미가 궁금합니다',
    excerpt:
      'gradient가 평행해야 한다는 설명은 이해했는데, 제약 곡면 위 최적점에서 왜 반드시 그런지 직관적으로 설명해 주실 수 있나요?',
    author: members[0],
    createdAt: '12분 전',
    comments: 8,
    views: 143,
    likes: 17,
    tags: ['수학', '미적분'],
    hot: true,
    solved: true,
  },
  {
    id: 'q-1039',
    board: 'question',
    title: '아두이노 센서값이 일정 주기로 튀는 현상',
    excerpt: 'DHT22와 조도센서를 같이 연결했을 때만 약 2초마다 이상치가 생깁니다.',
    author: members[2],
    createdAt: '38분 전',
    comments: 5,
    views: 92,
    likes: 9,
    tags: ['정보', '아두이노'],
    attachmentCount: 2,
  },
  {
    id: 'q-1035',
    board: 'question',
    title: '생명과학 R&E 주제 범위를 어디까지 좁혀야 할까요?',
    excerpt: '미세조류 성장 조건을 생각하고 있는데 한 학기 안에 가능한 실험 범위를 잡고 싶습니다.',
    author: members[5],
    createdAt: '1시간 전',
    comments: 12,
    views: 201,
    likes: 21,
    tags: ['생명과학', 'R&E'],
    hot: true,
  },
  {
    id: 'q-1028',
    board: 'question',
    title: '물리 실험 오차 전파 계산 확인 부탁드립니다',
    excerpt: '독립 변수의 불확도를 합성할 때 편미분 항을 적용한 계산이 맞는지 궁금합니다.',
    author: members[4],
    createdAt: '어제',
    comments: 4,
    views: 88,
    likes: 6,
    tags: ['물리', '실험'],
    solved: true,
    attachmentCount: 1,
  },
  {
    id: 'c-0321',
    board: 'contest',
    title: '2026 청소년 과학페어 데이터 분석 파트 1명 모집',
    excerpt: '환경 센서 데이터로 도시 열섬을 분석하는 팀입니다. Python 경험이 있으면 좋아요.',
    author: members[3],
    createdAt: '24분 전',
    comments: 6,
    views: 118,
    likes: 12,
    tags: ['연구대회', 'Python', '팀원모집'],
    hot: true,
    deadline: 'D-5',
  },
  {
    id: 'c-0318',
    board: 'contest',
    title: '교내 창의 아이디어톤: 하드웨어 제작 가능 팀원 구해요',
    excerpt: '소프트웨어 2명은 모였고 3D 프린팅이나 회로 설계 경험자를 찾습니다.',
    author: members[1],
    createdAt: '2시간 전',
    comments: 9,
    views: 166,
    likes: 14,
    tags: ['해커톤', '하드웨어'],
    deadline: 'D-2',
  },
  {
    id: 'c-0314',
    board: 'contest',
    title: '한국코드페어 함께 준비할 스터디원을 모집합니다',
    excerpt: '주 2회 저녁 온라인 풀이 공유, 교내에서는 토요일 오전에 모일 예정입니다.',
    author: members[0],
    createdAt: '어제',
    comments: 3,
    views: 105,
    likes: 8,
    tags: ['코드페어', '스터디'],
    deadline: 'D-12',
  },
  {
    id: 'c-0308',
    board: 'contest',
    title: '수학 모델링 대회 참가 경험자 조언 부탁드립니다',
    excerpt: '팀 구성과 24시간 동안의 역할 분배를 어떻게 했는지 경험을 듣고 싶어요.',
    author: members[5],
    createdAt: '3일 전',
    comments: 11,
    views: 212,
    likes: 19,
    tags: ['수학', '모델링'],
  },
  {
    id: 'r-0814',
    board: 'resources',
    title: '1학기 일반화학 개념 지도 + 자주 틀리는 유형 정리',
    excerpt: '중간·기말 범위를 단원별로 연결한 개념 지도와 직접 만든 오답 체크리스트입니다.',
    author: members[1],
    createdAt: '51분 전',
    comments: 7,
    views: 341,
    likes: 48,
    tags: ['화학', '내신'],
    hot: true,
    attachmentCount: 3,
  },
  {
    id: 'r-0811',
    board: 'resources',
    title: '탐구보고서 그래프를 깔끔하게 그리는 Python 템플릿',
    excerpt: 'matplotlib 기본 설정과 오차막대, 회귀선, 한글 폰트 처리를 한 파일에 정리했습니다.',
    author: members[4],
    createdAt: '3시간 전',
    comments: 15,
    views: 487,
    likes: 63,
    tags: ['Python', '보고서'],
    hot: true,
    attachmentCount: 1,
  },
  {
    id: 'r-0807',
    board: 'resources',
    title: '물리학실험 예비보고서 체크리스트 공유',
    excerpt: '제출 전 단위, 유효숫자, 장비 불확도와 참고문헌 형식을 빠르게 확인할 수 있습니다.',
    author: members[2],
    createdAt: '어제',
    comments: 2,
    views: 226,
    likes: 31,
    tags: ['물리', '실험'],
    attachmentCount: 1,
  },
  {
    id: 'r-0798',
    board: 'resources',
    title: '기숙사에서 쓰기 좋은 무료 집중 타이머 모음',
    excerpt: '광고가 적고 여러 기기에서 동기화되는 도구 위주로 비교했습니다.',
    author: members[5],
    createdAt: '4일 전',
    comments: 8,
    views: 302,
    likes: 26,
    tags: ['공부법', '추천'],
  },
  {
    id: 'e-0126',
    board: 'equipment',
    title: '학교에 주사전자현미경(SEM)이 있나요?',
    excerpt: '표면 형상 관찰이 필요한데 교내 보유 여부와 사용 가능한 배율을 알고 싶습니다.',
    author: members[0],
    createdAt: '18분 전',
    comments: 6,
    views: 94,
    likes: 11,
    tags: ['보유기기', 'SEM'],
    hot: true,
  },
  {
    id: 'e-0123',
    board: 'equipment',
    title: 'UV-Vis 분광광도계 측정 순서와 큐벳 사용법',
    excerpt: '블랭크 측정부터 시료 분석까지 기본 순서와 큐벳 취급 시 주의할 점이 궁금합니다.',
    author: members[4],
    createdAt: '2시간 전',
    comments: 9,
    views: 137,
    likes: 18,
    tags: ['사용법', 'UV-Vis', '안전'],
  },
  {
    id: 'e-0119',
    board: 'equipment',
    title: '원심분리기 로터 예약은 어디서 하나요?',
    excerpt: '고속 원심분리기를 사용하려고 합니다. 예약 절차와 사전 교육 일정을 알려 주세요.',
    author: members[2],
    createdAt: '어제',
    comments: 4,
    views: 82,
    likes: 7,
    tags: ['예약', '원심분리기'],
  },
  {
    id: 'f-3974',
    board: 'free',
    title: '오늘 저녁 운동장 노을 진짜 예뻤다',
    excerpt: '급식 먹고 나오다가 다들 잠깐 하늘 봤으면 좋겠어서 올려요.',
    author: members[2],
    createdAt: '7분 전',
    comments: 13,
    views: 236,
    likes: 36,
    tags: ['일상', '사진'],
    hot: true,
    attachmentCount: 2,
  },
  {
    id: 'f-3970',
    board: 'free',
    title: '축제 부스 아이디어, 작년엔 뭐가 제일 인기였나요?',
    excerpt: '동아리 부스를 준비 중인데 회전이 빠르면서도 기억에 남는 아이디어가 필요합니다.',
    author: members[5],
    createdAt: '29분 전',
    comments: 22,
    views: 318,
    likes: 27,
    tags: ['축제', '동아리'],
    hot: true,
  },
  {
    id: 'f-3964',
    board: 'free',
    title: '매점 신상 샌드위치 먹어본 사람?',
    excerpt: '점심시간 전에 다 나가던데 내일 도전할 가치가 있는지 궁금합니다.',
    author: members[0],
    createdAt: '1시간 전',
    comments: 18,
    views: 274,
    likes: 15,
    tags: ['매점', '급식'],
  },
  {
    id: 'f-3959',
    board: 'free',
    title: '이번 주말 청라에서 같이 러닝할 사람 구합니다',
    excerpt: '토요일 오전 8시, 호수공원 5km 천천히 달릴 예정이에요. 초보 환영!',
    author: members[3],
    createdAt: '어제',
    comments: 10,
    views: 191,
    likes: 24,
    tags: ['운동', '번개'],
  },
];

export const notices: Notice[] = [
  {
    id: 'n-18',
    title: '인텍트 커뮤니티 이용 원칙을 꼭 확인해 주세요',
    date: '07.12',
    label: '필독',
    important: true,
  },
  {
    id: 'n-17',
    title: '자료실 파일 검사 및 미리보기 기능이 추가됐어요',
    date: '07.11',
    label: '업데이트',
  },
  {
    id: 'n-16',
    title: '이번 주 일요일 새벽 서비스 점검 안내',
    date: '07.09',
    label: '안내',
  },
  {
    id: 'n-15',
    title: '첫 게시글 작성 시 10 IGK가 지급됩니다',
    date: '07.07',
    label: '안내',
  },
];

export const ranking: RankingMember[] = [
  { ...members[3], rank: 1, igk: 3280, change: 0 },
  { ...members[0], rank: 2, igk: 2915, change: 1 },
  { ...members[4], rank: 3, igk: 2740, change: -1 },
  { ...members[1], rank: 4, igk: 2310, change: 2 },
  { ...members[2], rank: 5, igk: 1985, change: 0 },
];

export const comments = [
  {
    id: 'comment-1',
    author: members[3],
    createdAt: '9분 전',
    likes: 12,
    accepted: true,
    content:
      '제약 곡면 위에서는 곡면의 접선 방향으로만 움직일 수 있습니다. 최적점에서 목적함수의 gradient에 접선 방향 성분이 남아 있다면 그 방향으로 조금 움직여 값을 더 키우거나 줄일 수 있겠죠. 따라서 최적점에서는 그 접선 성분이 0이어야 하고, gradient는 접선에 수직인 법선 방향만 남습니다. 제약식의 gradient도 바로 그 법선이어서 두 벡터가 평행해집니다.',
  },
  {
    id: 'comment-2',
    author: members[4],
    createdAt: '6분 전',
    likes: 5,
    accepted: false,
    content:
      '등고선 그림을 같이 보면 더 직관적이에요. 목적함수의 등고선을 밀어 가다가 제약 곡선과 마지막으로 맞닿는 순간, 두 곡선의 접선이 같아지고 따라서 법선도 같은 방향이 됩니다.',
  },
  {
    id: 'comment-3',
    author: members[0],
    createdAt: '방금',
    likes: 1,
    accepted: false,
    content: '두 설명을 같이 보니 이해됐습니다. 특히 접선 방향 성분이 0이어야 한다는 부분이 핵심이었네요. 감사합니다!',
  },
];

export function getBoard(slug: string) {
  return boards.find((board) => board.slug === slug);
}

export function getPostsForBoard(slug: string) {
  return posts.filter((post) => post.board === slug);
}

export function getPost(id: string) {
  return posts.find((post) => post.id === id);
}

export function getNotice(id: string) {
  return notices.find((notice) => notice.id === id);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('ko-KR').format(value);
}
