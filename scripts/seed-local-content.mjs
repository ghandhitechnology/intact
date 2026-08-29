// Seeds dummy content into the local Intact stack through its real HTTP APIs.
// Run with: node seed-content.mjs
const BASE = 'http://localhost:3000';
const ORIGIN = 'http://localhost:3000';

const STUDENT_PASSWORD = 'intact-dev-2026';
const ADMIN_INITIAL = { identifier: 'admin', password: 'intact-local-admin-2026' };
const ADMIN_NEW_PASSWORD = 'Intact-Admin-2026!';

const STUDENTS = ['311101', '311202', '311303', '321104', '321205', '331106', '331207', '331308'];

function cookieFrom(res, name) {
  const all = res.headers.getSetCookie?.() ?? [];
  for (const c of all) {
    if (c.startsWith(name + '=')) return c.split(';')[0];
  }
  return null;
}

async function api(method, path, { body, cookie } = {}) {
  const headers = { Origin: ORIGIN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { res, data };
}

async function loginStudent(code) {
  const { res, data } = await api('POST', '/api/auth/login', {
    body: { studentId: code, password: STUDENT_PASSWORD },
  });
  if (res.status !== 200) throw new Error(`login ${code} failed: ${res.status} ${JSON.stringify(data)}`);
  const cookie = cookieFrom(res, 'igwak_session');
  if (!cookie) throw new Error(`login ${code}: no session cookie`);
  return { code, cookie, user: data?.data?.user ?? data?.user };
}

async function main() {
  // --- Admin: first login + mandatory password change ---
  let adminCookie = null;
  {
    const first = await api('POST', '/api/admin/auth/login', { body: ADMIN_INITIAL });
    if (first.res.status === 200) {
      adminCookie = cookieFrom(first.res, 'igwak_admin_session');
      const change = await api('PATCH', '/api/admin/auth/password', {
        cookie: adminCookie,
        body: { currentPassword: ADMIN_INITIAL.password, newPassword: ADMIN_NEW_PASSWORD },
      });
      console.log('admin password change:', change.res.status);
    } else {
      // initial password already rotated in a previous run
      const second = await api('POST', '/api/admin/auth/login', {
        body: { identifier: 'admin', password: ADMIN_NEW_PASSWORD },
      });
      if (second.res.status !== 200) {
        throw new Error(`admin login failed with both passwords: ${first.res.status}/${second.res.status}`);
      }
      adminCookie = cookieFrom(second.res, 'igwak_admin_session');
    }
    console.log('admin session ready');
  }

  // --- Student sessions ---
  const sessions = {};
  for (const code of STUDENTS) {
    sessions[code] = await loginStudent(code);
    console.log('logged in', code);
  }
  const anyCookie = sessions[STUDENTS[0]].cookie;

  // --- Boards (also triggers ensureSystemDefaults) ---
  const boardsRes = await api('GET', '/api/boards', { cookie: anyCookie });
  const boards = boardsRes.data?.data?.boards ?? boardsRes.data?.boards ?? [];
  console.log('boards:', boards.map?.((b) => b.slug).join(', ') || JSON.stringify(boardsRes.data).slice(0, 300));

  // --- Posts ---
  const POSTS = [
    ['311101', 'free', '인텍트 로컬 테스트 서버 개설 안내', '이 게시글은 로컬 테스트 환경 시드 데이터입니다. 자유게시판이 정상 동작하는지 확인하기 위한 더미 글입니다. 편하게 댓글을 달아 보세요.', ['공지', 'seed']],
    ['311202', 'free', '오늘 급식 어땠나요? 로컬 더미 토론', '로컬 테스트용 더미 글입니다. 급식 메뉴 평가 스레드가 잘 렌더링되는지 확인합니다. 댓글과 추천 기능도 함께 테스트해 보세요.', ['일상']],
    ['311303', 'free', '기숙사 세탁기 사용 꿀팁 공유 (더미)', '세탁기 예약 시간대를 잘 고르면 기다리지 않아도 됩니다. 이 글은 목록 페이지네이션 확인용 더미 데이터입니다.', ['꿀팁']],
    ['321205', 'free', '동아리 홍보 글 테스트입니다', '프로그래밍 동아리에서 신입 부원을 모집한다는 가정의 더미 홍보 글입니다. 태그와 본문 표시가 정상인지 확인합니다.', ['동아리', '홍보']],
    ['331308', 'free', '주말 자습실 개방 시간 질문 아님 잡담', '주말 자습실 이용 후기를 가장한 시드 데이터입니다. 글 상세 페이지와 작성자 닉네임 표기를 확인해 주세요.', []],
    ['321104', 'question', '수학 미적분 문제 질문드립니다 (더미)', '테스트용 질문 게시글입니다. 정적분 치환 문제를 물어보는 상황을 가정했습니다. 답변 댓글이 정상 등록되는지 확인합니다.', ['수학']],
    ['331106', 'question', '물리 역학 실험 보고서 형식 질문', '실험 보고서 양식이 따로 있는지 묻는 더미 질문입니다. 질문 게시판의 목록과 상세 화면을 검증하기 위한 데이터입니다.', ['물리', '보고서']],
    ['331207', 'question', '화학 세특 주제 추천 부탁드려요 (테스트)', '화학 과목 세특 주제를 추천받고 싶다는 가정의 더미 질문입니다. 댓글 알림이 작성자에게 가는지도 확인해 보세요.', ['화학']],
    ['311101', 'contest', '전국 과학전람회 참가자 모집 (더미 공고)', '전국 과학전람회에 함께 나갈 팀원을 찾는다는 가정의 더미 공고입니다. 대회 게시판 렌더링 확인용 시드 데이터입니다.', ['대회', '팀원모집']],
    ['321205', 'contest', '정보올림피아드 스터디 후기 (테스트)', '정보올림피아드 준비 스터디 후기를 가장한 더미 글입니다. 대회 게시판의 정렬과 태그 필터를 확인합니다.', ['정보', '후기']],
    ['311202', 'resources', '수학 기출 정리 노트 공유 (더미, 첨부 없음)', '기출 정리 노트를 공유한다는 가정의 더미 자료 글입니다. 실제 첨부 파일 업로드는 브라우저에서 직접 테스트해 주세요.', ['수학', '자료']],
    ['331106', 'resources', '영어 단어장 정리본 안내 (테스트)', '영어 단어장 정리본을 소개하는 더미 자료 게시글입니다. 자료공유 게시판 목록이 정상 표시되는지 확인합니다.', ['영어']],
    ['311303', 'equipment', '3D 프린터 사용 예약 문의 (더미)', '3D 프린터 예약 절차를 묻는 더미 게시글입니다. 기자재 게시판 동작 확인용 시드 데이터입니다.', ['3D프린터']],
    ['331308', 'equipment', '오실로스코프 대여 후기 (테스트)', '오실로스코프를 대여해 사용한 후기를 가장한 더미 글입니다. 기자재 게시판 상세 페이지를 확인해 주세요.', ['실험장비']],
  ];

  const createdPosts = [];
  for (const [author, board, title, content, tags] of POSTS) {
    const { res, data } = await api('POST', '/api/posts', {
      cookie: sessions[author].cookie,
      body: { board, title, content, tags, status: 'PUBLISHED' },
    });
    const post = data?.data?.post ?? data?.post ?? data?.data;
    if (res.status === 201 || res.status === 202) {
      createdPosts.push({ id: post?.id, board, title, author });
      console.log(`post ok [${board}] ${title} (${res.status})`);
    } else {
      console.error(`post FAILED [${board}] ${title}: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
  }

  // --- Comments ---
  const COMMENTS = [
    [1, '311101', '더미 댓글입니다. 잘 보이네요!'],
    [0, '311202', '시드 댓글 테스트, 확인했습니다.'],
    [0, '321104', '두 번째 댓글도 정상 등록되는지 확인합니다.'],
    [5, '311303', '치환적분으로 풀면 됩니다. (더미 답변)'],
    [5, '331207', '저도 같은 문제 궁금했어요. 테스트 댓글입니다.'],
    [8, '331106', '참가하고 싶습니다! 더미 신청 댓글.'],
    [10, '321205', '자료 감사합니다. 시드 댓글입니다.'],
    [12, '321104', '예약은 과학실 담당 선생님께 문의하면 됩니다. (더미)'],
  ];
  for (const [postIndex, author, content] of COMMENTS) {
    const target = createdPosts[postIndex];
    if (!target?.id) continue;
    const { res, data } = await api('POST', '/api/comments', {
      cookie: sessions[author].cookie,
      body: { postId: target.id, content },
    });
    if (res.status >= 300) {
      console.error(`comment FAILED on ${target.title}: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    } else {
      console.log(`comment ok on "${target.title}" by ${author}`);
    }
  }

  // --- Chat rooms + messages ---
  const CHATS = [
    ['311101', '311202', ['안녕하세요! 로컬 테스트 메시지입니다.', '네 반갑습니다. 채팅도 잘 되네요.', '실시간 게이트웨이 연결 확인 완료!']],
    ['321104', '331106', ['보고서 양식 파일 있으신가요? (더미)', '네, 내일 자료게시판에 올릴게요. (더미)']],
  ];
  for (const [a, b, messages] of CHATS) {
    const other = sessions[b].user;
    const otherId = other?.id;
    if (!otherId) { console.error(`no user id for ${b}, skipping chat`); continue; }
    const roomRes = await api('POST', '/api/chat/rooms', {
      cookie: sessions[a].cookie,
      body: { memberIds: [otherId] },
    });
    const room = roomRes.data?.data?.room ?? roomRes.data?.room ?? roomRes.data?.data;
    const roomId = room?.id;
    if (!roomId) {
      console.error(`chat room FAILED ${a}-${b}: ${roomRes.res.status} ${JSON.stringify(roomRes.data).slice(0, 300)}`);
      continue;
    }
    let turn = 0;
    for (const content of messages) {
      const sender = turn % 2 === 0 ? a : b;
      const { res, data } = await api('POST', '/api/messages', {
        cookie: sessions[sender].cookie,
        body: { roomId, content },
      });
      if (res.status >= 300) console.error(`message FAILED: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
      turn += 1;
    }
    console.log(`chat ok ${a} <-> ${b} (${messages.length} messages)`);
  }

  // --- Verify listing ---
  const list = await api('GET', '/api/posts?board=free&page=1&pageSize=20&sort=latest', { cookie: anyCookie });
  const posts = list.data?.data?.posts ?? list.data?.posts ?? [];
  console.log(`\nfree board now lists ${posts.length ?? '?'} posts`);
  console.log(`seeded ${createdPosts.length}/${POSTS.length} posts total`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
