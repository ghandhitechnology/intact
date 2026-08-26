"use client";

import {
  Avatar,
  apiErrorMessage,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  IconButton,
  Input,
  Modal,
  readApiEnvelope,
  Select,
  Stat,
  Tabs,
  Textarea,
  Toast,
  cn,
} from "@/components/operations/ui";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bell,
  ChevronRight,
  Clipboard,
  Clock,
  Coins,
  Eye,
  FileText,
  History,
  KeyRound,
  Lock,
  LogOut,
  Megaphone,
  Moon,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Undo2,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  isValidStudentCode,
  normalizeStudentCode,
  STUDENT_CODE_REQUIREMENTS,
} from "@/lib/student-code";
import { igkLevelForBalance, igkLevelLabel, type IgkStanding } from "@/lib/igk-levels";
import { usePlatformMode } from "@/components/portal/PlatformModeProvider";

type AdminTab = "users" | "content" | "notices";
type UserStatus =
  | "active"
  | "suspended"
  | "reverify"
  | "graduated"
  | "withdrawn";
type ContentStatus = "draft" | "scheduled" | "published" | "hidden" | "deleted";
type ReportStatus = "open" | "reviewing";
type InviteState = "active" | "used" | "expired" | "revoked";
type InvitePurpose = "REGISTER" | "RESET" | "REVERIFY";
type IssuableInvitePurpose = Exclude<InvitePurpose, "REGISTER">;

type PortalUser = {
  id: string;
  nickname: string;
  realName: string;
  studentId: string;
  grade: string;
  status: UserStatus;
  level: number;
  igk: number;
  lifetimeIgk?: number;
  igkDebt?: number;
  standing?: IgkStanding | null;
  posts: number;
  comments: number;
  reports: number;
  activeSessions: number;
  lastActive: string;
  joinedAt: string;
};

type ContentItem = {
  id: string;
  type: "post" | "comment";
  board: string;
  boardSlug: string;
  postId: string;
  contextTitle: string;
  title: string;
  preview: string;
  author: string;
  studentId: string;
  status: ContentStatus;
  reports: number;
  comments: number;
  time: string;
  createdAt: string;
  isLocked: boolean;
  isPinned: boolean;
};

type Notice = {
  id: string;
  title: string;
  content: string;
  status: "draft" | "published" | "scheduled" | "expired";
  priority: "normal" | "important" | "urgent";
  priorityValue: number;
  audience: string;
  targetAudience: string;
  publishedAt: string;
  scheduledFor: string | null;
  expiresAt: string | null;
  pinned: boolean;
};

type ReportItem = {
  id: string;
  status: ReportStatus;
  targetType: "USER" | "POST" | "COMMENT" | "MESSAGE";
  targetId: string | null;
  contentId: string | null;
  reporter: string;
  targetLabel: string;
  reasonCode: string;
  detail: string;
  createdAt: string;
  href: string | null;
};

type AuditEntry = {
  id: string;
  action: string;
  rawAction: string;
  target: string;
  targetType: string;
  reason: string;
  admin: string;
  time: string;
  ip: string;
};

type AdminInvite = {
  id: string;
  realName: string;
  studentCode: string;
  purpose: InvitePurpose;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

type CreatedInvite = {
  invite: AdminInvite;
  code: string;
};

type InviteDraft = {
  purpose: IssuableInvitePurpose;
  realName: string;
  studentCode: string;
  expiresAt: string;
};

type Summary = {
  userCount: number;
  postCount: number;
  openReportCount: number;
  newUsersToday: number;
  todayPosts: number;
  todayComments: number;
  activeSessionCount: number;
  publishedNoticeCount: number;
  scheduledNoticeCount: number;
};

type PendingActionKind =
  | "suspend-user"
  | "restore-user"
  | "delete-user"
  | "revoke-sessions"
  | "adjust-igk"
  | "hide-content"
  | "delete-content"
  | "restore-content"
  | "lock-content"
  | "unlock-content"
  | "delete-notice"
  | "review-report"
  | "resolve-report"
  | "dismiss-report";

type PendingAction = {
  kind: PendingActionKind;
  id: string;
  label: string;
};

type DashboardUser = {
  id: string;
  createdAt: string;
  nickname: string;
  realName: string | null;
  loginId: string;
  status: string;
  currentIgk: number;
  lifetimeIgk: number;
  igkDebt: number;
  level: number;
  standing?: IgkStanding | null;
  lastLoginAt: string | null;
  activeSessionCount: number;
  studentIdentity?: {
    studentCode: string;
    generation: number;
    grade: number;
    classNumber: number;
  } | null;
  _count: { posts: number; comments: number; reportsAgainst: number };
};

type DashboardPost = {
  id: string;
  title: string;
  contentText: string;
  status: string;
  commentCount: number;
  createdAt: string;
  isLocked: boolean;
  isPinned: boolean;
  board: { slug: string; name: string };
  author: {
    nickname: string;
    studentIdentity?: { studentCode: string } | null;
  };
  _count: { reports: number };
};

type DashboardComment = {
  id: string;
  content: string;
  status: string;
  createdAt: string;
  post: { id: string; title: string; board: { slug: string; name: string } };
  author: {
    nickname: string;
    studentIdentity?: { studentCode: string } | null;
  };
  _count: { reports: number };
};

type DashboardNotice = {
  id: string;
  title: string;
  content: string;
  status: string;
  priority: number;
  targetAudience: string;
  publishedAt: string | null;
  scheduledFor: string | null;
  expiresAt: string | null;
};

type DashboardReport = {
  id: string;
  status: string;
  targetType: "USER" | "POST" | "COMMENT" | "MESSAGE";
  targetUserId: string | null;
  postId: string | null;
  commentId: string | null;
  messageId: string | null;
  reasonCode: string;
  detail: string | null;
  createdAt: string;
  reporter: { nickname: string };
  targetUser: { id: string; nickname: string } | null;
  post: {
    id: string;
    title: string;
    author: { nickname: string };
    board: { slug: string; name: string };
  } | null;
  comment: {
    id: string;
    content: string;
    author: { nickname: string };
    post: { id: string; title: string; board: { slug: string; name: string } };
  } | null;
  message: {
    id: string;
    content: string;
    sender: { nickname: string };
  } | null;
};

type DashboardPayload = {
  summary: Summary;
  adminSession: { expiresAt: string };
  platform: {
    bSideEnabled: boolean;
    bSideEpoch: number;
    maintenanceEnabled?: boolean;
    updatedAt: string;
  };
  users: DashboardUser[];
  posts: DashboardPost[];
  comments: DashboardComment[];
  notices: DashboardNotice[];
  reports: DashboardReport[];
  auditLog: Array<{
    id: string;
    action: string;
    targetId: string | null;
    targetType: string;
    reason: string;
    createdAt: string;
    ipHash: string | null;
    admin: { nickname: string };
  }>;
};

const emptySummary: Summary = {
  userCount: 0,
  postCount: 0,
  openReportCount: 0,
  newUsersToday: 0,
  todayPosts: 0,
  todayComments: 0,
  activeSessionCount: 0,
  publishedNoticeCount: 0,
  scheduledNoticeCount: 0,
};

const initialUsers: PortalUser[] = [
  {
    id: "demo-u1",
    nickname: "푸른별",
    realName: "김인곽",
    studentId: "331201",
    grade: "37기 · 2학년 1반",
    status: "active",
    level: 6,
    igk: 2480,
    posts: 24,
    comments: 83,
    reports: 0,
    activeSessions: 2,
    lastActive: "방금",
    joinedAt: "2025. 03. 04.",
  },
  {
    id: "demo-u2",
    nickname: "과몰입금지",
    realName: "이준호",
    studentId: "331302",
    grade: "37기 · 2학년 3반",
    status: "suspended",
    level: 3,
    igk: 310,
    posts: 8,
    comments: 21,
    reports: 2,
    activeSessions: 0,
    lastActive: "2일 전",
    joinedAt: "2025. 04. 12.",
  },
];

const initialContents: ContentItem[] = [
  {
    id: "demo-p1",
    type: "post",
    board: "질문게시판",
    boardSlug: "question",
    postId: "demo-p1",
    contextTitle: "전자기 유도 문제",
    title: "전자기 유도 문제에서 렌츠 법칙 적용 방향이 헷갈립니다",
    preview: "자기선속과 유도 전류의 방향을 어떻게 구분해야 하나요?",
    author: "푸른별",
    studentId: "331201",
    status: "published",
    reports: 0,
    comments: 8,
    time: "12분 전",
    createdAt: "2026-07-12T05:00:00.000Z",
    isLocked: false,
    isPinned: false,
  },
  {
    id: "demo-c1",
    type: "comment",
    board: "자료공유",
    boardSlug: "resources",
    postId: "demo-p2",
    contextTitle: "생명과학 실험 보고서 양식",
    title: "댓글 · 생명과학 실험 보고서 양식",
    preview: "출처와 원 작성자 허락 여부를 확인해 주세요.",
    author: "라그랑주",
    studentId: "331106",
    status: "published",
    reports: 1,
    comments: 0,
    time: "44분 전",
    createdAt: "2026-07-12T04:20:00.000Z",
    isLocked: false,
    isPinned: false,
  },
];

const initialNotices: Notice[] = [
  {
    id: "demo-n1",
    title: "기숙사 소방 점검 일정 안내",
    content: "기숙사 소방 점검 시간을 확인해 주세요.",
    status: "published",
    priority: "important",
    priorityValue: 50,
    audience: "전체 학생",
    targetAudience: "ALL",
    publishedAt: "오늘 09:00",
    scheduledFor: null,
    expiresAt: null,
    pinned: true,
  },
];

const initialReports: ReportItem[] = [
  {
    id: "demo-r1",
    status: "open",
    targetType: "COMMENT",
    targetId: "demo-c1",
    contentId: "demo-c1",
    reporter: "푸른별",
    targetLabel: "댓글 · 생명과학 실험 보고서 양식",
    reasonCode: "COPYRIGHT",
    detail: "출처가 표시되지 않았습니다.",
    createdAt: "오늘 14:12",
    href: "/post/demo-p2",
  },
];

const demoSummary: Summary = {
  userCount: initialUsers.length,
  postCount: 2,
  openReportCount: initialReports.length,
  newUsersToday: 0,
  todayPosts: 1,
  todayComments: 1,
  activeSessionCount: 2,
  publishedNoticeCount: 1,
  scheduledNoticeCount: 0,
};

function normalizeUserStatus(status: string): UserStatus {
  if (status === "ACTIVE") return "active";
  if (status === "SUSPENDED") return "suspended";
  if (status === "GRADUATED") return "graduated";
  if (status === "WITHDRAWN") return "withdrawn";
  return "reverify";
}

function normalizeContentStatus(status: string): ContentStatus {
  if (status === "DRAFT") return "draft";
  if (status === "SCHEDULED") return "scheduled";
  if (status === "HIDDEN") return "hidden";
  if (status === "DELETED") return "deleted";
  return "published";
}

function normalizeNoticeStatus(status: string): Notice["status"] {
  if (status === "DRAFT") return "draft";
  if (status === "SCHEDULED") return "scheduled";
  if (status === "EXPIRED") return "expired";
  return "published";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

function defaultInviteExpiry() {
  return toDateTimeLocal(
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
  );
}

const invitePurposeDetails: Record<InvitePurpose, {
  label: string;
  description: string;
}> = {
  REGISTER: {
    label: "신규 가입",
    description: "과거 발급 기록입니다. 신규 가입은 리로스쿨 직접 인증만 사용합니다.",
  },
  RESET: {
    label: "비밀번호 재설정",
    description: "기존 학생 계정의 포털 비밀번호를 다시 설정할 때만 사용합니다.",
  },
  REVERIFY: {
    label: "재학생 재인증",
    description: "기존 학생 계정의 새 학년도 재학생 자격을 갱신할 때만 사용합니다.",
  },
};

const invitePurposeOptions: ReadonlyArray<{
  value: IssuableInvitePurpose;
  label: string;
  description: string;
}> = [
  { value: "RESET", ...invitePurposeDetails.RESET },
  { value: "REVERIFY", ...invitePurposeDetails.REVERIFY },
];

function invitePurposeOption(purpose: InvitePurpose) {
  return invitePurposeDetails[purpose];
}

function parseIssuableInvitePurpose(value: string): IssuableInvitePurpose | null {
  if (value === "RESET" || value === "REVERIFY") {
    return value;
  }
  return null;
}

function invitePurposeBadge(purpose: InvitePurpose) {
  const tone =
    purpose === "REGISTER" ? "blue" : purpose === "RESET" ? "amber" : "green";
  return <Badge tone={tone}>{invitePurposeOption(purpose).label}</Badge>;
}

function invitePurposeReason(purpose: InvitePurpose) {
  if (purpose === "REGISTER") return "신규 재학생 가입 초대 발급";
  if (purpose === "RESET") return "재학생 비밀번호 재설정 코드 발급";
  return "재학생 재인증 코드 발급";
}

function safeInvite(invite: AdminInvite): AdminInvite {
  return {
    id: invite.id,
    realName: invite.realName,
    studentCode: invite.studentCode,
    purpose: invite.purpose,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    usedAt: invite.usedAt,
    revokedAt: invite.revokedAt,
  };
}

function inviteState(invite: AdminInvite): InviteState {
  if (invite.revokedAt) return "revoked";
  if (invite.usedAt) return "used";
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

function inviteStateBadge(state: InviteState) {
  if (state === "active") return <Badge tone="green">사용 가능</Badge>;
  if (state === "used") return <Badge tone="blue">사용 완료</Badge>;
  if (state === "expired") return <Badge tone="amber">만료</Badge>;
  return <Badge tone="red">회수</Badge>;
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    USER_WARN: "사용자 경고",
    USER_SUSPEND: "사용자 기간 정지",
    USER_BAN: "사용자 영구 정지",
    USER_WITHDRAW: "사용자 탈퇴",
    USER_RESTORE: "사용자 복구",
    USER_REVOKE_SESSIONS: "사용자 세션 종료",
    USER_ADJUST_IGK: "IGK 조정",
    POST_HIDE: "게시글 숨김",
    POST_DELETE: "게시글 삭제",
    POST_RESTORE: "게시글 복구",
    POST_LOCK: "게시글 잠금",
    POST_UNLOCK: "게시글 잠금 해제",
    COMMENT_HIDE: "댓글 숨김",
    COMMENT_DELETE: "댓글 삭제",
    COMMENT_RESTORE: "댓글 복구",
    NOTICE_CREATE: "공지 등록",
    NOTICE_UPDATE: "공지 수정",
    NOTICE_DELETE: "공지 삭제",
    REPORT_REVIEW: "신고 검토 시작",
    REPORT_RESOLVE: "신고 해결",
    REPORT_DISMISS: "신고 기각",
    STUDENT_INVITE_CREATE: "학생 인증 코드 발급",
    STUDENT_INVITE_REVOKE: "학생 인증 코드 회수",
    B_SIDE_ENABLE: "B-side 활성화",
    B_SIDE_DISABLE: "B-side 비활성화",
    MAINTENANCE_ENABLE: "점검 모드 활성화",
    MAINTENANCE_DISABLE: "점검 모드 해제",
  };
  return labels[action] || action;
}

function statusBadge(status: UserStatus) {
  if (status === "active") return <Badge tone="green">정상</Badge>;
  if (status === "suspended") return <Badge tone="red">정지</Badge>;
  if (status === "graduated") return <Badge tone="slate">졸업</Badge>;
  if (status === "withdrawn") return <Badge tone="slate">탈퇴</Badge>;
  return <Badge tone="amber">재인증 필요</Badge>;
}

function contentStatusBadge(status: ContentStatus) {
  if (status === "published") return <Badge tone="green">게시 중</Badge>;
  if (status === "draft") return <Badge tone="slate">초안</Badge>;
  if (status === "scheduled") return <Badge tone="blue">예약</Badge>;
  if (status === "hidden") return <Badge tone="amber">숨김</Badge>;
  return <Badge tone="red">삭제</Badge>;
}

export default function AdminPage() {
  const router = useRouter();
  const { refresh: refreshPlatformMode } = usePlatformMode();
  const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true";
  const [accessState, setAccessState] = useState<
    "loading" | "ready" | "denied"
  >("loading");
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [adminExpiresAt, setAdminExpiresAt] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary>(
    demoMode ? demoSummary : emptySummary,
  );
  const [mobileTab, setMobileTab] = useState<AdminTab>("users");
  const [users, setUsers] = useState<PortalUser[]>(
    demoMode ? initialUsers : [],
  );
  const [contents, setContents] = useState<ContentItem[]>(
    demoMode ? initialContents : [],
  );
  const [notices, setNotices] = useState<Notice[]>(
    demoMode ? initialNotices : [],
  );
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<"all" | InviteState>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDraft, setInviteDraft] = useState<InviteDraft>(() => ({
    purpose: "RESET",
    realName: "",
    studentCode: "",
    expiresAt: defaultInviteExpiry(),
  }));
  const [inviteFormError, setInviteFormError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(
    null,
  );
  const [inviteCodeCopied, setInviteCodeCopied] = useState(false);
  const [revokingInvite, setRevokingInvite] = useState<AdminInvite | null>(
    null,
  );
  const [revokeReason, setRevokeReason] = useState("");
  const [inviteApplying, setInviteApplying] = useState(false);
  const [reports, setReports] = useState<ReportItem[]>(
    demoMode ? initialReports : [],
  );
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [userStatus, setUserStatus] = useState("all");
  const [contentQuery, setContentQuery] = useState("");
  const [contentStatus, setContentStatus] = useState("all");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditKind, setAuditKind] = useState("all");
  const [selectedUser, setSelectedUser] = useState<PortalUser | null>(null);
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(
    null,
  );
  const [auditOpen, setAuditOpen] = useState(false);
  const [reportQueueOpen, setReportQueueOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("7");
  const [igkAmount, setIgkAmount] = useState("");
  const [igkDirection, setIgkDirection] = useState<"GRANT" | "TAKE">("GRANT");
  const [noticeDraft, setNoticeDraft] = useState({
    title: "",
    body: "",
    priority: "normal",
    audience: "all",
    schedule: "",
    pinned: false,
  });
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const [bSideEnabled, setBSideEnabled] = useState(false);
  const [bSideEpoch, setBSideEpoch] = useState(0);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [platformApplying, setPlatformApplying] = useState(false);

  const showToast = useCallback(
    (message: string, tone: "success" | "error" = "success") => {
      setToast({ message, tone });
    },
    [],
  );
  const closeToast = useCallback(() => setToast(null), []);

  const loadInvites = useCallback(async () => {
    if (demoMode) {
      setInvites([]);
      setInviteError(null);
      return;
    }
    setInvitesLoading(true);
    setInviteError(null);
    try {
      const response = await fetch("/api/admin/invites", {
        cache: "no-store",
      });
      const payload = await readApiEnvelope<{ invites: AdminInvite[] }>(
        response,
      );
      if (!response.ok || !payload?.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessState("denied");
          router.replace("/admin/login?returnTo=/admin");
          return;
        }
        throw new Error(
          apiErrorMessage(payload, "학생 인증 코드 목록을 불러오지 못했습니다."),
        );
      }
      setInvites(payload.data.invites.map(safeInvite));
    } catch (cause) {
      setInviteError(
        cause instanceof Error
          ? cause.message
          : "학생 인증 코드 목록을 불러오지 못했습니다.",
      );
    } finally {
      setInvitesLoading(false);
    }
  }, [demoMode, router]);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const response = await fetch("/api/admin/dashboard", {
        cache: "no-store",
      });
      const payload = await readApiEnvelope<DashboardPayload>(response);
      if (!response.ok || !payload?.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessState("denied");
          router.replace("/admin/login?returnTo=/admin");
          return;
        }
        throw new Error(
          apiErrorMessage(payload, "운영 데이터를 불러오지 못했습니다."),
        );
      }

      const reportItems: ReportItem[] = payload.data.reports.map((report) => {
        const targetId =
          report.postId ||
          report.commentId ||
          report.messageId ||
          report.targetUserId ||
          null;
        const contentId = report.postId || report.commentId || null;
        let targetLabel = report.targetUser?.nickname || "대상 정보 없음";
        let href: string | null = null;
        if (report.post) {
          targetLabel = "게시글 · " + report.post.title;
          href = "/post/" + report.post.id;
        } else if (report.comment) {
          targetLabel = "댓글 · " + report.comment.post.title;
          href = "/post/" + report.comment.post.id;
        } else if (report.message) {
          targetLabel = "메시지 · " + report.message.sender.nickname;
        }
        return {
          id: report.id,
          status: report.status === "REVIEWING" ? "reviewing" : "open",
          targetType: report.targetType,
          targetId,
          contentId,
          reporter: report.reporter.nickname,
          targetLabel,
          reasonCode: report.reasonCode,
          detail: report.detail || "추가 설명 없음",
          createdAt: formatDateTime(report.createdAt),
          href,
        };
      });
      const loadedUsers: PortalUser[] = payload.data.users.map((user) => ({
        id: user.id,
        nickname: user.nickname,
        realName: user.realName || "(관리자 계정)",
        studentId: user.studentIdentity?.studentCode || user.loginId,
        grade: user.studentIdentity
          ? String(user.studentIdentity.generation) +
            "기 · " +
            String(user.studentIdentity.grade) +
            "학년 " +
            String(user.studentIdentity.classNumber) +
            "반"
          : "관리자 계정",
        status: normalizeUserStatus(user.status),
        level: user.level,
        igk: user.currentIgk,
        lifetimeIgk: user.lifetimeIgk,
        igkDebt: user.igkDebt,
        standing: user.standing,
        posts: user._count.posts,
        comments: user._count.comments,
        reports: user._count.reportsAgainst,
        activeSessions: user.activeSessionCount,
        lastActive: user.lastLoginAt
          ? formatDateTime(user.lastLoginAt)
          : "접속 기록 없음",
        joinedAt: new Intl.DateTimeFormat("ko-KR", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(user.createdAt)),
      }));

      const loadedPosts: ContentItem[] = payload.data.posts.map((post) => ({
        id: post.id,
        type: "post",
        board: post.board.name,
        boardSlug: post.board.slug,
        postId: post.id,
        contextTitle: post.title,
        title: post.title,
        preview: post.contentText,
        author: post.author.nickname,
        studentId: post.author.studentIdentity?.studentCode || "ADMIN",
        status: normalizeContentStatus(post.status),
        reports: post._count.reports,
        comments: post.commentCount,
        time: formatDateTime(post.createdAt),
        createdAt: post.createdAt,
        isLocked: post.isLocked,
        isPinned: post.isPinned,
      }));
      const loadedComments: ContentItem[] = payload.data.comments.map(
        (comment) => ({
          id: comment.id,
          type: "comment",
          board: comment.post.board.name,
          boardSlug: comment.post.board.slug,
          postId: comment.post.id,
          contextTitle: comment.post.title,
          title: "댓글 · " + comment.post.title,
          preview: comment.content,
          author: comment.author.nickname,
          studentId: comment.author.studentIdentity?.studentCode || "ADMIN",
          status: normalizeContentStatus(comment.status),
          reports: comment._count.reports,
          comments: 0,
          time: formatDateTime(comment.createdAt),
          createdAt: comment.createdAt,
          isLocked: false,
          isPinned: false,
        }),
      );

      setUsers(loadedUsers);
      setContents(
        [...loadedPosts, ...loadedComments].sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        ),
      );
      setNotices(
        payload.data.notices.map((notice) => ({
          id: notice.id,
          title: notice.title,
          content: notice.content,
          status: normalizeNoticeStatus(notice.status),
          priority:
            notice.priority >= 100
              ? "urgent"
              : notice.priority >= 50
                ? "important"
                : "normal",
          priorityValue: notice.priority,
          audience:
            notice.targetAudience === "ALL"
              ? "전체 학생"
              : notice.targetAudience,
          targetAudience: notice.targetAudience,
          publishedAt:
            notice.publishedAt || notice.scheduledFor
              ? formatDateTime(notice.publishedAt || notice.scheduledFor || "")
              : "미게시",
          scheduledFor: notice.scheduledFor,
          expiresAt: notice.expiresAt,
          pinned: notice.priority >= 50,
        })),
      );
      setReports(reportItems);
      setAuditEntries(
        payload.data.auditLog.map((entry) => ({
          id: entry.id,
          action: auditActionLabel(entry.action),
          rawAction: entry.action,
          target: entry.targetType + " · " + (entry.targetId || "-"),
          targetType: entry.targetType,
          reason: entry.reason,
          admin: entry.admin.nickname,
          time: new Date(entry.createdAt).toLocaleString("ko-KR"),
          ip: (entry.ipHash || "정보 없음").slice(0, 10),
        })),
      );
      setSummary(payload.data.summary);
      setBSideEnabled(payload.data.platform.bSideEnabled);
      setBSideEpoch(payload.data.platform.bSideEpoch);
      setMaintenanceEnabled(Boolean(payload.data.platform.maintenanceEnabled));
      setAdminExpiresAt(payload.data.adminSession.expiresAt);
      setLastUpdated(new Date());
      setAccessState("ready");
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "운영 데이터를 불러오지 못했습니다.";
      setDashboardError(message);
      if (demoMode) {
        setAccessState("ready");
      } else {
        setAccessState("ready");
      }
      showToast(message, "error");
    } finally {
      setDashboardLoading(false);
    }
  }, [demoMode, router, showToast]);

  useEffect(() => {
    void loadDashboard();
    void loadInvites();
  }, [loadDashboard, loadInvites]);

  async function logoutAdmin() {
    await fetch("/api/admin/auth/logout", { method: "POST" }).catch(
      () => undefined,
    );
    router.replace("/admin/login");
    router.refresh();
  }

  async function toggleBSide() {
    const enabled = !bSideEnabled;
    const confirmed = window.confirm(
      enabled
        ? "B-side를 켜면 모든 사용자 화면이 즉시 다크 모드로 전환되고 다른 사용자의 이름이 익명 해시로 표시됩니다. 계속할까요?"
        : "B-side를 끄면 일반 테마와 실제 사용자 이름 표시로 돌아갑니다. 계속할까요?",
    );
    if (!confirmed) return;
    setPlatformApplying(true);
    try {
      const response = await fetch("/api/admin/platform", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await readApiEnvelope<{
        bSideEnabled: boolean;
        bSideEpoch: number;
      }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, "B-side 상태를 바꾸지 못했습니다."));
      }
      setBSideEnabled(payload.data.bSideEnabled);
      setBSideEpoch(payload.data.bSideEpoch);
      showToast(enabled ? "B-side를 전역 활성화했습니다." : "B-side를 비활성화했습니다.");
      await refreshPlatformMode();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "B-side 상태를 바꾸지 못했습니다.", "error");
    } finally {
      setPlatformApplying(false);
    }
  }

  async function toggleMaintenance() {
    const next = !maintenanceEnabled;
    const confirmed = window.confirm(
      next
        ? "점검 모드를 켜면 관리자를 제외한 모든 사용자가 즉시 차단되고 점검 안내 페이지만 보게 됩니다. 계속할까요?"
        : "점검 모드를 끄면 모든 사용자가 다시 정상적으로 이용할 수 있습니다. 계속할까요?",
    );
    if (!confirmed) return;
    setPlatformApplying(true);
    try {
      const response = await fetch("/api/admin/platform", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenance: next }),
      });
      const payload = await readApiEnvelope<{ maintenanceEnabled: boolean }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, "점검 모드 상태를 바꾸지 못했습니다."));
      }
      setMaintenanceEnabled(Boolean(payload.data.maintenanceEnabled));
      showToast(next ? "점검 모드를 켰습니다. 일반 사용자는 이제 차단됩니다." : "점검 모드를 해제했습니다.");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "점검 모드 상태를 바꾸지 못했습니다.", "error");
    } finally {
      setPlatformApplying(false);
    }
  }

  function resetInviteDraft() {
    setInviteDraft({
      purpose: "RESET",
      realName: "",
      studentCode: "",
      expiresAt: defaultInviteExpiry(),
    });
    setInviteFormError(null);
  }

  function openInviteForm() {
    resetInviteDraft();
    setInviteOpen(true);
  }

  function closeCreatedInvite() {
    setCreatedInvite(null);
    setInviteCodeCopied(false);
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteFormError(null);
    const realName = inviteDraft.realName.trim();
    const studentCode = inviteDraft.studentCode.trim();
    const expiresAt = new Date(inviteDraft.expiresAt);
    if (realName.length < 2 || realName.length > 30) {
      setInviteFormError("학생 실명은 2~30자로 입력해 주세요.");
      return;
    }
    if (!isValidStudentCode(studentCode)) {
      setInviteFormError(STUDENT_CODE_REQUIREMENTS);
      return;
    }
    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() < Date.now() + 5 * 60 * 1_000
    ) {
      setInviteFormError("만료 시각은 현재보다 최소 5분 뒤로 지정해 주세요.");
      return;
    }
    if (expiresAt.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1_000) {
      setInviteFormError("코드 유효기간은 최대 90일입니다.");
      return;
    }
    if (demoMode) {
      setInviteFormError(
        "데모 데이터 모드에서는 실제 학생 인증 코드를 발급할 수 없습니다.",
      );
      return;
    }

    setInviteApplying(true);
    try {
      const response = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: inviteDraft.purpose,
          realName,
          studentCode,
          expiresAt: expiresAt.toISOString(),
          reason: invitePurposeReason(inviteDraft.purpose),
        }),
      });
      const payload = await readApiEnvelope<{
        invite: AdminInvite;
        code: string;
      }>(response);
      if (!response.ok || !payload?.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessState("denied");
          router.replace("/admin/login?returnTo=/admin");
          return;
        }
        throw new Error(
          apiErrorMessage(payload, "학생 인증 코드를 발급하지 못했습니다."),
        );
      }
      if (!payload.data.code) {
        throw new Error(
          "발급 응답에 인증 코드가 없습니다. 목록을 확인한 뒤 새로 발급해 주세요.",
        );
      }
      const invite = safeInvite(payload.data.invite);
      setInvites((current) => [
        invite,
        ...current.filter((item) => item.id !== invite.id),
      ]);
      setInviteOpen(false);
      resetInviteDraft();
      setCreatedInvite({ invite, code: payload.data.code });
      showToast("학생 인증 코드를 발급하고 감사 로그에 기록했습니다.");
    } catch (cause) {
      setInviteFormError(
        cause instanceof Error
          ? cause.message
          : "학생 인증 코드를 발급하지 못했습니다.",
      );
    } finally {
      setInviteApplying(false);
    }
  }

  async function copyInviteCode() {
    if (!createdInvite) return;
    try {
      await navigator.clipboard.writeText(createdInvite.code);
      setInviteCodeCopied(true);
    } catch {
      showToast(
        "클립보드에 복사하지 못했습니다. 코드를 직접 선택해 복사해 주세요.",
        "error",
      );
    }
  }

  async function revokeInvite() {
    if (!revokingInvite || revokeReason.trim().length < 4) return;
    setInviteApplying(true);
    try {
      const response = await fetch(
        "/api/admin/invites/" + encodeURIComponent(revokingInvite.id),
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: revokeReason.trim() }),
        },
      );
      const payload = await readApiEnvelope<{ invite: AdminInvite }>(response);
      if (!response.ok || !payload?.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessState("denied");
          router.replace("/admin/login?returnTo=/admin");
          return;
        }
        throw new Error(
          apiErrorMessage(payload, "학생 인증 코드를 회수하지 못했습니다."),
        );
      }
      const revoked = safeInvite(payload.data.invite);
      setInvites((current) =>
        current.map((item) => (item.id === revoked.id ? revoked : item)),
      );
      setRevokingInvite(null);
      setRevokeReason("");
      showToast("학생 인증 코드를 회수하고 감사 로그에 기록했습니다.");
    } catch (cause) {
      showToast(
        cause instanceof Error
          ? cause.message
          : "학생 인증 코드를 회수하지 못했습니다.",
        "error",
      );
    } finally {
      setInviteApplying(false);
    }
  }

  const filteredUsers = useMemo(
    () =>
      users.filter((user) => {
        const matchesQuery = (
          user.nickname +
          " " +
          user.realName +
          " " +
          user.studentId
        )
          .toLowerCase()
          .includes(userQuery.toLowerCase());
        return (
          matchesQuery && (userStatus === "all" || user.status === userStatus)
        );
      }),
    [users, userQuery, userStatus],
  );

  const filteredInvites = useMemo(
    () =>
      invites.filter((invite) =>
        inviteStatus === "all" ? true : inviteState(invite) === inviteStatus,
      ),
    [inviteStatus, invites],
  );

  const filteredContents = useMemo(
    () =>
      contents.filter((item) => {
        const matchesQuery = (
          item.title +
          " " +
          item.preview +
          " " +
          item.author +
          " " +
          item.studentId
        )
          .toLowerCase()
          .includes(contentQuery.toLowerCase());
        const matchesStatus =
          contentStatus === "all"
            ? true
            : contentStatus === "reported"
              ? item.reports > 0
              : item.status === contentStatus;
        return matchesQuery && matchesStatus;
      }),
    [contents, contentQuery, contentStatus],
  );

  const filteredAuditEntries = useMemo(
    () =>
      auditEntries.filter((entry) => {
        const matchesQuery = (
          entry.action +
          " " +
          entry.target +
          " " +
          entry.reason +
          " " +
          entry.admin
        )
          .toLowerCase()
          .includes(auditQuery.toLowerCase());
        const matchesKind =
          auditKind === "all" ||
          (auditKind === "content" &&
            ["POST", "COMMENT", "MESSAGE"].includes(entry.targetType)) ||
          entry.targetType === auditKind;
        return matchesQuery && matchesKind;
      }),
    [auditEntries, auditKind, auditQuery],
  );

  function closePendingAction() {
    setPendingAction(null);
    setReason("");
    setIgkAmount("");
    setIgkDirection("GRANT");
  }

  function openPendingAction(action: PendingAction) {
    setSelectedUser(null);
    setSelectedContent(null);
    setReportQueueOpen(false);
    setReason("");
    setIgkAmount("");
    setIgkDirection("GRANT");
    setPendingAction(action);
  }

  async function applyAction() {
    if (!pendingAction || reason.trim().length < 4) return;
    setApplying(true);
    try {
      let response: Response;
      if (
        [
          "suspend-user",
          "restore-user",
          "delete-user",
          "revoke-sessions",
          "adjust-igk",
        ].includes(pendingAction.kind)
      ) {
        const action =
          pendingAction.kind === "suspend-user"
            ? duration === "0"
              ? "BAN"
              : "SUSPEND"
            : pendingAction.kind === "restore-user"
              ? "RESTORE"
              : pendingAction.kind === "delete-user"
                ? "WITHDRAW"
                : pendingAction.kind === "adjust-igk"
                  ? "ADJUST_IGK"
                  : "REVOKE_SESSIONS";
        response = await fetch(
          "/api/admin/users/" + encodeURIComponent(pendingAction.id),
          {
            method: "PATCH",
            headers: { "content-type": "application/json", ...(action === "ADJUST_IGK" ? { "Idempotency-Key": crypto.randomUUID() } : {}) },
            body: JSON.stringify({
              action,
              reason: reason.trim(),
              durationDays: action === "SUSPEND" ? Number(duration) : undefined,
              amount: action === "ADJUST_IGK" ? Number(igkAmount) : undefined,
              direction: action === "ADJUST_IGK" ? igkDirection : undefined,
            }),
          },
        );
      } else if (
        [
          "hide-content",
          "delete-content",
          "restore-content",
          "lock-content",
          "unlock-content",
        ].includes(pendingAction.kind)
      ) {
        const content = contents.find((item) => item.id === pendingAction.id);
        if (!content) throw new Error("처리할 콘텐츠를 찾을 수 없습니다.");
        const action =
          pendingAction.kind === "hide-content"
            ? "HIDE"
            : pendingAction.kind === "delete-content"
              ? "DELETE"
              : pendingAction.kind === "restore-content"
                ? "RESTORE"
                : pendingAction.kind === "lock-content"
                  ? "LOCK"
                  : "UNLOCK";
        response = await fetch(
          "/api/admin/content/" +
            content.type +
            "/" +
            encodeURIComponent(content.id),
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, reason: reason.trim() }),
          },
        );
      } else if (pendingAction.kind === "delete-notice") {
        response = await fetch(
          "/api/admin/notices/" + encodeURIComponent(pendingAction.id),
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason: reason.trim() }),
          },
        );
      } else {
        const reportAction =
          pendingAction.kind === "review-report"
            ? "REVIEW"
            : pendingAction.kind === "resolve-report"
              ? "RESOLVE"
              : "DISMISS";
        response = await fetch(
          "/api/admin/reports/" + encodeURIComponent(pendingAction.id),
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: reportAction,
              reason: reason.trim(),
              resolution: reportAction === "REVIEW" ? undefined : reason.trim(),
            }),
          },
        );
      }
      const payload = await readApiEnvelope<unknown>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          apiErrorMessage(payload, "관리 작업을 적용하지 못했습니다."),
        );
      }
      const label = pendingAction.label;
      closePendingAction();
      setSelectedUser(null);
      setSelectedContent(null);
      await loadDashboard();
      showToast(label + " 처리를 완료하고 감사 로그에 기록했습니다.");
    } catch (cause) {
      showToast(
        cause instanceof Error
          ? cause.message
          : "관리 작업을 적용하지 못했습니다.",
        "error",
      );
    } finally {
      setApplying(false);
    }
  }

  function resetNoticeDraft() {
    setEditingNoticeId(null);
    setNoticeDraft({
      title: "",
      body: "",
      priority: "normal",
      audience: "all",
      schedule: "",
      pinned: false,
    });
  }

  function openNewNotice() {
    resetNoticeDraft();
    setNoticeOpen(true);
  }

  function openEditNotice(notice: Notice) {
    const supportedAudiences = ["ALL", "1학년", "2학년", "3학년"];
    setEditingNoticeId(notice.id);
    setNoticeDraft({
      title: notice.title,
      body: notice.content,
      priority: notice.priority,
      audience: supportedAudiences.includes(notice.targetAudience)
        ? notice.targetAudience === "ALL"
          ? "all"
          : notice.targetAudience
        : "all",
      schedule:
        notice.status === "scheduled"
          ? toDateTimeLocal(notice.scheduledFor)
          : "",
      pinned: notice.pinned,
    });
    setNoticeOpen(true);
  }

  async function saveNotice(event: FormEvent) {
    event.preventDefault();
    if (!noticeDraft.title.trim() || !noticeDraft.body.trim()) return;
    setApplying(true);
    try {
      const scheduled = Boolean(noticeDraft.schedule);
      const priorityValue =
        noticeDraft.priority === "urgent"
          ? 100
          : noticeDraft.priority === "important" || noticeDraft.pinned
            ? 50
            : 0;
      const response = await fetch(
        editingNoticeId
          ? "/api/admin/notices/" + encodeURIComponent(editingNoticeId)
          : "/api/admin/notices",
        {
          method: editingNoticeId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: noticeDraft.title.trim(),
            content: noticeDraft.body.trim(),
            status: scheduled ? "SCHEDULED" : "PUBLISHED",
            priority: priorityValue,
            targetAudience:
              noticeDraft.audience === "all" ? "ALL" : noticeDraft.audience,
            scheduledFor: scheduled
              ? new Date(noticeDraft.schedule).toISOString()
              : null,
            reason: editingNoticeId ? "관리자 공지 수정" : "관리자 공지 등록",
          }),
        },
      );
      const payload = await readApiEnvelope<{ notice: { id: string } }>(
        response,
      );
      if (!response.ok || !payload?.ok) {
        throw new Error(
          apiErrorMessage(payload, "공지를 저장하지 못했습니다."),
        );
      }
      const wasEditing = Boolean(editingNoticeId);
      setNoticeOpen(false);
      resetNoticeDraft();
      await loadDashboard();
      showToast(
        wasEditing
          ? "공지를 수정했습니다."
          : scheduled
            ? "공지를 예약했습니다."
            : "공지를 게시했습니다.",
      );
    } catch (cause) {
      showToast(
        cause instanceof Error ? cause.message : "공지를 저장하지 못했습니다.",
        "error",
      );
    } finally {
      setApplying(false);
    }
  }

  const adminExpiryLabel = adminExpiresAt
    ? new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(adminExpiresAt))
    : "확인 중";

  if (accessState === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 px-6">
        <div className="anim-fade flex flex-col items-center gap-4 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-[var(--shadow-md)]">
            <Shield className="h-6 w-6 text-white" />
          </span>
          <p className="text-sm font-semibold text-slate-300">
            관리자 권한과 운영 데이터를 확인하는 중…
          </p>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="skeleton h-1.5 w-10 rounded-full" />
            <span className="skeleton h-1.5 w-6 rounded-full" />
            <span className="skeleton h-1.5 w-8 rounded-full" />
          </div>
        </div>
      </div>
    );
  }
  if (accessState === "denied") return null;

  return (
    <div className="min-h-screen bg-[var(--surface-muted)] text-slate-900">
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-[var(--shadow-sm)]">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <div>
                <h1 className="text-base font-bold tracking-[-0.02em]">
                  인텍트 운영 도구
                </h1>
                <p className="mt-0.5 text-xs text-slate-400">관리자 전용 · 실제 운영 데이터</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-400 sm:flex">
              <i
                className={cn(
                  "h-2 w-2 rounded-full",
                  dashboardError ? "bg-red-400" : "bg-emerald-400",
                )}
              />
              {dashboardError ? "운영 데이터 연결 오류" : "운영 데이터 연결됨"}
            </span>
            <Button
              variant="ghost"
              className="text-slate-300 hover:bg-white/10 hover:text-white"
              onClick={() => setAuditOpen(true)}
            >
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">감사 로그</span>
            </Button>
            <Link
              href="/admin/moderation"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500/40 px-3.5 text-xs font-bold text-emerald-200 transition-all hover:border-emerald-400/60 hover:bg-emerald-500/10"
            >
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden sm:inline">이중망</span>
            </Link>
            <button
              type="button"
              onClick={logoutAdmin}
              className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              title="관리자 로그아웃"
              aria-label="관리자 로그아웃"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6 lg:px-8">
        <div className="anim-rise flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-slate-950">
              운영 현황
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              학생 인증 코드, 사용자, 콘텐츠, 공지를 실제 운영 데이터로 검토하고 모든
              위험 조치를 감사 기록으로 남깁니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 shadow-[var(--shadow-xs)]">
              <Lock className="h-3.5 w-3.5 text-emerald-700" />
              관리자 세션 {adminExpiryLabel} 만료 · 자동 연장 없음
            </span>
            <Button
              variant="secondary"
              className="h-9 px-3 text-xs"
              onClick={() => {
                void loadDashboard();
                void loadInvites();
              }}
              disabled={dashboardLoading || invitesLoading}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  (dashboardLoading || invitesLoading) && "animate-spin",
                )}
              />
              새로고침
            </Button>
          </div>
        </div>

        {dashboardError ? (
          <div className="anim-rise mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{dashboardError}</span>
            <button
              type="button"
              className="rounded-lg px-2 py-0.5 font-bold underline transition-colors hover:bg-red-100"
              onClick={() => void loadDashboard()}
            >
              다시 시도
            </button>
          </div>
        ) : null}

        <div className="stagger mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="전체 계정"
            value={summary.userCount.toLocaleString()}
            detail={
              "오늘 신규 " +
              summary.newUsersToday.toLocaleString() +
              "명 · 활성 세션 " +
              summary.activeSessionCount.toLocaleString()
            }
            icon={<Users className="h-4 w-4" />}
          />
          <Stat
            label="검토 대기 신고"
            value={summary.openReportCount.toLocaleString()}
            detail={
              "신고 큐에 " +
              reports.length.toLocaleString() +
              "건 표시" +
              (summary.openReportCount > reports.length ? " · 최대 100건" : "")
            }
            icon={<ShieldAlert className="h-4 w-4" />}
            tone="amber"
          />
          <Stat
            label="오늘 콘텐츠"
            value={(
              summary.todayPosts + summary.todayComments
            ).toLocaleString()}
            detail={
              "게시글 " +
              summary.todayPosts.toLocaleString() +
              " · 댓글 " +
              summary.todayComments.toLocaleString()
            }
            icon={<Activity className="h-4 w-4" />}
            tone="green"
          />
          <Stat
            label="게시 중 공지"
            value={summary.publishedNoticeCount.toLocaleString()}
            detail={
              "예약 " + summary.scheduledNoticeCount.toLocaleString() + "건"
            }
            icon={<Megaphone className="h-4 w-4" />}
            tone="slate"
          />
        </div>

        <Card className="mt-5 overflow-hidden border-slate-800 bg-slate-950 text-white">
          <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-slate-100">
                <Moon className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold">B-side 전역 모드</h3>
                  <Badge tone={bSideEnabled ? "green" : "slate"}>
                    {bSideEnabled ? "활성" : "비활성"}
                  </Badge>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
                  켜면 모든 사용자 화면이 다크 테마로 바뀌고, 본인을 제외한 이름·학번·프로필 이미지는 세션 {bSideEpoch}의 익명 해시로 대체됩니다.
                </p>
              </div>
            </div>
            <Button
              variant={bSideEnabled ? "danger" : "green"}
              className="h-10 shrink-0 text-xs"
              onClick={() => void toggleBSide()}
              disabled={platformApplying || demoMode}
            >
              <Moon className="h-4 w-4" />
              {platformApplying ? "적용 중" : bSideEnabled ? "B-side 끄기" : "B-side 켜기"}
            </Button>
          </div>
        </Card>

        <Card className="mt-5 overflow-hidden border-amber-200 bg-amber-50/70">
          <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-200/80 text-amber-800">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-950">서버 점검 모드</h3>
                  <Badge tone={maintenanceEnabled ? "red" : "slate"}>
                    {maintenanceEnabled ? "점검 중" : "정상 운영"}
                  </Badge>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
                  켜면 관리자를 제외한 전원이 차단되고 &ldquo;서버 점검중입니다 bb&rdquo; 페이지만 표시됩니다. 로그인·API·채팅까지 모두 막히며, 관리자 세션만 우회할 수 있습니다.
                </p>
              </div>
            </div>
            <Button
              variant={maintenanceEnabled ? "green" : "danger"}
              className="h-10 shrink-0 text-xs"
              onClick={() => void toggleMaintenance()}
              disabled={platformApplying || demoMode}
            >
              <ShieldAlert className="h-4 w-4" />
              {platformApplying ? "적용 중" : maintenanceEnabled ? "점검 끝내기" : "점검 시작"}
            </Button>
          </div>
        </Card>

        <Card className="mt-5 overflow-hidden ">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-blue-700" />
                학생 인증 코드 관리
              </span>
            }
            description={
              invites
                .filter((invite) => inviteState(invite) === "active")
                .length.toLocaleString() +
              "개 사용 가능 · 발급 코드는 생성 직후 한 번만 표시"
            }
            action={
              <div className="flex items-center gap-1">
                <IconButton
                  label="학생 인증 코드 목록 새로고침"
                  onClick={() => void loadInvites()}
                  disabled={invitesLoading}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", invitesLoading && "animate-spin")}
                  />
                </IconButton>
                <Button
                  className="h-9 px-3 text-xs"
                  onClick={openInviteForm}
                  disabled={demoMode}
                  title={
                    demoMode
                      ? "데모 데이터 모드에서는 초대를 발급할 수 없습니다."
                      : undefined
                  }
                >
                  <Plus className="h-4 w-4" />새 코드
                </Button>
              </div>
            }
          />
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-xs leading-5 text-slate-600">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <p>
                학생 실명과 허용된 6자리 학번, 코드 용도를 확인한 뒤 발급하세요.
                목록에는 원본 코드가 저장되거나 다시 표시되지 않습니다.
              </p>
            </div>
            <Select
              value={inviteStatus}
              onChange={(event) =>
                setInviteStatus(event.target.value as "all" | InviteState)
              }
              className="h-9 shrink-0 bg-white sm:w-36"
              aria-label="초대 상태 필터"
            >
              <option value="all">전체 상태</option>
              <option value="active">사용 가능</option>
              <option value="used">사용 완료</option>
              <option value="expired">만료</option>
              <option value="revoked">회수</option>
            </Select>
          </div>
          {inviteError ? (
            <div className="flex items-start gap-3 border-b border-red-100 bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{inviteError}</span>
              <button
                type="button"
                className="rounded-lg px-2 py-0.5 font-bold underline transition-colors hover:bg-red-100"
                onClick={() => void loadInvites()}
              >
                다시 시도
              </button>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500">
                <tr>
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">학생</th>
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">학번</th>
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">용도</th>
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">발급 시각</th>
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">만료 시각</th>
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">상태</th>
                  <th className="border-b border-slate-100 px-4 py-3 text-right font-bold">조치</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvites.map((invite) => {
                  const state = inviteState(invite);
                  const stateAt = invite.revokedAt || invite.usedAt;
                  return (
                    <tr key={invite.id} className="border-t border-slate-100 transition-colors hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {invite.realName}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold tracking-[0.08em] text-blue-700">
                        {invite.studentCode}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {invitePurposeBadge(invite.purpose)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {formatDateTime(invite.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatDateTime(invite.expiresAt)}
                      </td>
                      <td className="px-4 py-3">
                        {inviteStateBadge(state)}
                        {stateAt ? (
                          <span className="ml-2 text-xs text-slate-400">
                            {formatDateTime(stateAt)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {state === "active" ? (
                          <Button
                            variant="danger"
                            className="h-8 px-3 text-xs"
                            onClick={() => {
                              setRevokingInvite(invite);
                              setRevokeReason("");
                            }}
                          >
                            회수
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">
                            추가 조치 없음
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {invitesLoading && invites.length === 0 ? (
              <div className="border-t border-slate-100 py-10 text-center text-sm text-slate-500">
                학생 인증 코드 목록을 불러오는 중…
              </div>
            ) : null}
            {!invitesLoading && filteredInvites.length === 0 ? (
              <div className="border-t border-slate-100 py-10 text-center text-sm text-slate-500">
                {demoMode
                  ? "데모 데이터 모드에서는 실제 학생 인증 코드가 표시되지 않습니다."
                  : inviteStatus === "all"
                    ? "발급된 학생 인증 코드가 없습니다."
                    : "선택한 상태의 학생 인증 코드가 없습니다."}
              </div>
            ) : null}
          </div>
        </Card>

        <Tabs
          className="mt-5 lg:hidden"
          value={mobileTab}
          onChange={setMobileTab}
          items={[
            { value: "users", label: "사용자" },
            { value: "content", label: "콘텐츠" },
            { value: "notices", label: "공지" },
          ]}
        />

        <div className="mt-5 grid gap-5 lg:grid-cols-[0.95fr_1.12fr_0.93fr]">
          <Card
            className={cn(
              "min-h-[720px] overflow-hidden ",
              mobileTab === "users" ? "block" : "hidden",
              "lg:block",
            )}
          >
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-700" />
                  사용자 관리
                </span>
              }
              description={
                users.length.toLocaleString() +
                "명 · 정지 " +
                users
                  .filter((user) => user.status === "suspended")
                  .length.toLocaleString() +
                "명"
              }
              action={
                <IconButton
                  label="사용자 목록 새로고침"
                  onClick={() => void loadDashboard()}
                  disabled={dashboardLoading}
                >
                  <RefreshCw
                    className={cn(
                      "h-4 w-4",
                      dashboardLoading && "animate-spin",
                    )}
                  />
                </IconButton>
              }
            />
            <div className="space-y-2 border-b border-slate-100 bg-slate-50/70 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder="닉네임, 실명, 학번 검색"
                  className="h-10 bg-white pl-9"
                />
              </div>
              <Select
                value={userStatus}
                onChange={(event) => setUserStatus(event.target.value)}
                className="h-10 bg-white"
              >
                <option value="all">전체 계정 상태</option>
                <option value="active">정상 이용</option>
                <option value="suspended">정지 계정</option>
                <option value="reverify">재인증 필요</option>
                <option value="graduated">졸업 계정</option>
                <option value="withdrawn">탈퇴 계정</option>
              </Select>
            </div>
            <div className="max-h-[610px] overflow-y-auto">
              {filteredUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUser(user)}
                  className="flex w-full gap-3 border-b border-slate-100 px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-slate-50/80"
                >
                  <Avatar
                    name={user.nickname}
                    size="sm"
                    tone={user.status === "suspended" ? "slate" : "blue"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <strong className="truncate text-sm text-slate-900">
                        {user.nickname}
                      </strong>
                      {statusBadge(user.status)}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {user.studentId} · {user.realName}
                    </span>
                    <span className="mt-2 flex items-center justify-between text-xs text-slate-400">
                      <span>
                        {user.standing?.tierLabel ?? igkLevelLabel(user.level)}{user.standing?.rankLabel ? ` · ${user.standing.rankLabel}` : ''} · {user.igk.toLocaleString()} IGK
                      </span>
                      <span>{user.lastActive}</span>
                    </span>
                  </span>
                  <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300" />
                </button>
              ))}
              {filteredUsers.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500">
                  검색 결과가 없습니다.
                </div>
              ) : null}
            </div>
          </Card>

          <Card
            className={cn(
              "min-h-[720px] overflow-hidden ",
              mobileTab === "content" ? "block" : "hidden",
              "lg:block",
            )}
          >
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-emerald-700" />
                  콘텐츠 관리
                </span>
              }
              description={
                contents.length.toLocaleString() +
                "건 · 미처리 신고 " +
                summary.openReportCount.toLocaleString() +
                "건"
              }
              action={
                <Button
                  variant={summary.openReportCount ? "danger" : "secondary"}
                  className="h-8 px-2.5 text-xs"
                  onClick={() => setReportQueueOpen(true)}
                  disabled={!summary.openReportCount}
                  title={
                    summary.openReportCount
                      ? "미처리 신고 열기"
                      : "미처리 신고가 없습니다."
                  }
                >
                  신고 큐 {summary.openReportCount.toLocaleString()}
                </Button>
              }
            />
            <div className="grid grid-cols-[1fr_130px] gap-2 border-b border-slate-100 bg-slate-50/70 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={contentQuery}
                  onChange={(event) => setContentQuery(event.target.value)}
                  placeholder="제목, 본문, 작성자 검색"
                  className="h-10 bg-white pl-9"
                />
              </div>
              <Select
                value={contentStatus}
                onChange={(event) => setContentStatus(event.target.value)}
                className="h-10 bg-white"
              >
                <option value="all">전체 상태</option>
                <option value="reported">신고 있음</option>
                <option value="published">게시 중</option>
                <option value="draft">초안</option>
                <option value="scheduled">예약</option>
                <option value="hidden">숨김</option>
                <option value="deleted">삭제</option>
              </Select>
            </div>
            <div className="max-h-[610px] overflow-y-auto">
              {filteredContents.map((item) => (
                <article
                  key={item.type + "-" + item.id}
                  className={cn(
                    "border-b border-slate-100 px-4 py-4 transition-colors last:border-b-0 hover:bg-slate-50/60",
                    item.reports > 0 && "bg-red-50/50 hover:bg-red-50/70",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={item.type === "post" ? "blue" : "green"}>
                      {item.type === "post" ? "게시글" : "댓글"}
                    </Badge>
                    <Badge tone="slate">{item.board}</Badge>
                    {contentStatusBadge(item.status)}
                    {item.reports > 0 ? (
                      <Badge tone="red">신고 {item.reports}</Badge>
                    ) : null}
                    {item.isLocked ? <Badge tone="amber">잠금</Badge> : null}
                    <span className="ml-auto text-xs text-slate-400">
                      {item.time}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedContent(item)}
                    className="mt-2 block w-full text-left"
                  >
                    <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900">
                      {item.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                      {item.preview}
                    </p>
                  </button>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-500">
                      {item.author} · {item.studentId}
                      {item.type === "post"
                        ? " · 댓글 " + item.comments.toLocaleString()
                        : ""}
                    </span>
                    <IconButton
                      label="콘텐츠 검토"
                      onClick={() => setSelectedContent(item)}
                    >
                      <Eye className="h-4 w-4" />
                    </IconButton>
                  </div>
                </article>
              ))}
              {filteredContents.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500">
                  조건에 맞는 콘텐츠가 없습니다.
                </div>
              ) : null}
            </div>
          </Card>

          <Card
            className={cn(
              "min-h-[720px] overflow-hidden ",
              mobileTab === "notices" ? "block" : "hidden",
              "lg:block",
            )}
          >
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-violet-700" />
                  공지 관리
                </span>
              }
              description="홈 공지 패널 노출"
              action={
                <Button className="h-8 px-3 text-xs" onClick={openNewNotice}>
                  새 공지
                </Button>
              }
            />
            <div className="border-b border-blue-100 bg-blue-50/70 p-4">
              <div className="flex items-start gap-3">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                <div>
                  <h3 className="text-xs font-semibold text-blue-950">
                    공지 패널 상태
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-blue-800">
                    중요·긴급 공지{" "}
                    {notices
                      .filter(
                        (notice) =>
                          notice.status === "published" && notice.pinned,
                      )
                      .length.toLocaleString()}
                    건이 상단에 우선 노출됩니다.
                  </p>
                </div>
              </div>
            </div>
            <div className="max-h-[530px] overflow-y-auto">
              {notices.map((notice) => (
                <article
                  key={notice.id}
                  className="border-b border-slate-100 px-4 py-4 transition-colors last:border-b-0 hover:bg-slate-50/60"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {notice.status === "published" ? (
                      <Badge tone="green">게시 중</Badge>
                    ) : notice.status === "scheduled" ? (
                      <Badge tone="blue">
                        <Clock className="mr-1 h-3 w-3" />
                        예약
                      </Badge>
                    ) : notice.status === "draft" ? (
                      <Badge tone="slate">초안</Badge>
                    ) : (
                      <Badge tone="slate">종료</Badge>
                    )}
                    {notice.priority === "urgent" ? (
                      <Badge tone="red">긴급</Badge>
                    ) : notice.priority === "important" ? (
                      <Badge tone="amber">중요</Badge>
                    ) : null}
                    {notice.pinned ? (
                      <Pin className="h-3.5 w-3.5 text-blue-700" />
                    ) : null}
                  </div>
                  <h3 className="mt-2 text-sm font-semibold leading-5 text-slate-900">
                    {notice.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                    {notice.content}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {notice.audience} · {notice.publishedAt}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="secondary"
                      className="h-8 flex-1 px-2 text-xs"
                      onClick={() => openEditNotice(notice)}
                    >
                      수정
                    </Button>
                    <IconButton
                      label="공지 삭제"
                      className="border border-slate-200 text-red-600"
                      onClick={() =>
                        openPendingAction({
                          kind: "delete-notice",
                          id: notice.id,
                          label: "공지 삭제",
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </article>
              ))}
              {notices.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500">
                  등록된 공지가 없습니다.
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <p className="mt-3 text-right text-xs text-slate-400">
          {lastUpdated
            ? "마지막 동기화 " + lastUpdated.toLocaleTimeString("ko-KR")
            : "아직 동기화되지 않음"}
          {demoMode ? " · 데모 데이터 모드" : ""}
        </p>
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          resetInviteDraft();
        }}
        title="새 학생 인증 코드 발급"
        description="확인된 재학생 한 명에게 용도가 제한된 일회성 코드를 발급합니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setInviteOpen(false);
                resetInviteDraft();
              }}
              disabled={inviteApplying}
            >
              취소
            </Button>
            <Button
              variant="green"
              onClick={() => {
                const form = document.getElementById(
                  "invite-form",
                ) as HTMLFormElement | null;
                form?.requestSubmit();
              }}
              disabled={inviteApplying}
            >
              <KeyRound className="h-4 w-4" />
              {inviteApplying ? "발급 중…" : "일회성 코드 발급"}
            </Button>
          </>
        }
      >
        <form id="invite-form" onSubmit={createInvite} className="space-y-5">
          <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
            <ShieldCheck className="h-5 w-5 shrink-0 text-blue-700" />
            <p className="text-xs leading-5 text-blue-900">
              실명과 학번이 다른 학생에게 발급되지 않도록 학적 명부와
              대조하세요. 발급과 회수 작업은 관리자 감사 로그에 기록됩니다.
            </p>
          </div>
          <Field label="코드 용도" required hint="발급 후 변경할 수 없음">
            <Select
              value={inviteDraft.purpose}
              onChange={(event) => {
                const purpose = parseIssuableInvitePurpose(event.target.value);
                if (!purpose) return;
                setInviteDraft((current) => ({ ...current, purpose }));
              }}
              required
              className="bg-white"
            >
              {invitePurposeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {invitePurposeOption(inviteDraft.purpose).description}
            </p>
          </Field>
          <Field label="학생 실명" required hint="학적 명부 기준">
            <Input
              value={inviteDraft.realName}
              onChange={(event) =>
                setInviteDraft((current) => ({
                  ...current,
                  realName: event.target.value,
                }))
              }
              maxLength={30}
              autoComplete="off"
              placeholder="예: 김인곽"
            />
          </Field>
          <Field label="포털 학번" required hint="31~33기 · 가운데 11~14 · 번호 01~20">
            <Input
              value={inviteDraft.studentCode}
              onChange={(event) =>
                setInviteDraft((current) => ({
                  ...current,
                  studentCode: normalizeStudentCode(event.target.value),
                }))
              }
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="off"
              placeholder="예: 331101"
              className="font-mono font-bold tracking-[0.08em]"
            />
          </Field>
          <Field label="사용 만료 시각" required hint="기본 7일 후 · 최대 90일">
            <Input
              type="datetime-local"
              value={inviteDraft.expiresAt}
              min={toDateTimeLocal(
                new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
              )}
              onChange={(event) =>
                setInviteDraft((current) => ({
                  ...current,
                  expiresAt: event.target.value,
                }))
              }
            />
          </Field>
          {inviteFormError ? (
            <div
              className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{inviteFormError}</p>
            </div>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(createdInvite)}
        onClose={closeCreatedInvite}
        title="학생 인증 코드가 발급되었습니다"
        description="이 화면을 닫으면 원본 코드를 다시 확인할 수 없습니다."
        footer={
          <Button variant="green" onClick={closeCreatedInvite}>
            전달 완료 · 닫기
          </Button>
        }
      >
        {createdInvite ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
                <p className="text-xs leading-5 text-amber-900">
                  안전한 채널로 해당 학생에게만 전달하세요. 코드의 스크린샷이나
                  평문 사본을 관리자 기기에 보관하지 마세요.
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-sm">
              <div className="bg-white p-3">
                <dt className="text-xs text-slate-500">학생</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {createdInvite.invite.realName}
                </dd>
              </div>
              <div className="bg-white p-3">
                <dt className="text-xs text-slate-500">학번</dt>
                <dd className="mt-1 font-mono font-bold tracking-[0.08em] text-blue-700">
                  {createdInvite.invite.studentCode}
                </dd>
              </div>
              <div className="col-span-2 bg-white p-3">
                <dt className="text-xs text-slate-500">코드 용도</dt>
                <dd className="mt-1">
                  {invitePurposeBadge(createdInvite.invite.purpose)}
                  <span className="ml-2 text-xs text-slate-500">
                    {invitePurposeOption(createdInvite.invite.purpose).description}
                  </span>
                </dd>
              </div>
              <div className="col-span-2 bg-white p-3">
                <dt className="text-xs text-slate-500">사용 만료</dt>
                <dd className="mt-1 font-bold text-slate-900">
                  {new Date(createdInvite.invite.expiresAt).toLocaleString(
                    "ko-KR",
                  )}
                </dd>
              </div>
            </dl>
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500">일회용 인증 코드</p>
              <div
                className="rounded-2xl border-2 border-blue-700 bg-blue-50 px-4 py-5 text-center font-mono text-xl font-bold tracking-[0.12em] text-blue-950 selection:bg-blue-700 selection:text-white"
                aria-live="polite"
              >
                {createdInvite.code}
              </div>
              <Button
                variant={inviteCodeCopied ? "green" : "secondary"}
                className="mt-3 w-full"
                onClick={() => void copyInviteCode()}
              >
                <Clipboard className="h-4 w-4" />
                {inviteCodeCopied ? "클립보드에 복사됨" : "코드 복사"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(revokingInvite)}
        onClose={() => {
          setRevokingInvite(null);
          setRevokeReason("");
        }}
        title="학생 인증 코드 회수"
        description="회수 즉시 해당 코드는 사용할 수 없으며 다시 활성화할 수 없습니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRevokingInvite(null);
                setRevokeReason("");
              }}
              disabled={inviteApplying}
            >
              취소
            </Button>
            <Button
              variant="danger"
              onClick={() => void revokeInvite()}
              disabled={inviteApplying || revokeReason.trim().length < 4}
            >
              {inviteApplying ? "회수 중…" : "코드 회수"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {revokingInvite ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm">
              <p className="font-semibold text-slate-900">
                {revokingInvite.realName} · {revokingInvite.studentCode}
              </p>
              <div className="mt-2">{invitePurposeBadge(revokingInvite.purpose)}</div>
              <p className="mt-1 text-xs text-slate-500">
                만료{" "}
                {new Date(revokingInvite.expiresAt).toLocaleString("ko-KR")}
              </p>
            </div>
          ) : null}
          <Field label="회수 사유" required hint="최소 4자">
            <Textarea
              rows={4}
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="오발급, 학번 정정 등 판단 근거를 구체적으로 기록하세요."
              maxLength={1000}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUser(null)}
        title="사용자 상세"
        wide
      >
        {selectedUser ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-5 sm:flex-row sm:items-center">
              <Avatar
                name={selectedUser.nickname}
                size="xl"
                tone={selectedUser.status === "suspended" ? "slate" : "blue"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold text-slate-950">
                    {selectedUser.nickname}
                  </h3>
                  {statusBadge(selectedUser.status)}
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedUser.realName} · {selectedUser.studentId} ·{" "}
                  {selectedUser.grade}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  가입 {selectedUser.joinedAt} · 최근 활동{" "}
                  {selectedUser.lastActive}
                </p>
              </div>
              <div className="flex gap-1"><Badge tone="green">{selectedUser.standing?.tierLabel ?? igkLevelLabel(selectedUser.level)}</Badge>{selectedUser.standing?.rankLabel ? <Badge tone="blue">{selectedUser.standing.rankLabel}</Badge> : null}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["보유 IGK", selectedUser.igk.toLocaleString()],
                [
                  "게시글 / 댓글",
                  selectedUser.posts + " / " + selectedUser.comments,
                ],
                ["미처리 신고", selectedUser.reports.toLocaleString()],
                ["활성 세션", selectedUser.activeSessions.toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[var(--shadow-xs)]">
                  <p className="text-xs font-bold text-slate-500">
                    {label}
                  </p>
                  <p className="mt-2 text-lg font-bold tracking-[-0.02em] text-slate-900">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
                    <Coins className="h-4 w-4 text-emerald-700" /> IGK 관리
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    평생 활동 기록 {Number(selectedUser.lifetimeIgk || 0).toLocaleString()} · 미상환 회수 {Number(selectedUser.igkDebt || 0).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="green"
                  className="h-9 text-xs"
                  onClick={() =>
                    openPendingAction({
                      kind: "adjust-igk",
                      id: selectedUser.id,
                      label: "IGK 잔액 조정",
                    })
                  }
                >
                  <Coins className="h-4 w-4" /> 지급·회수
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-xs font-semibold">
                계정 조치
              </div>
              <div className="flex flex-wrap gap-2 p-4">
                {selectedUser.status === "suspended" ||
                selectedUser.status === "withdrawn" ? (
                  <Button
                    variant="green"
                    className="h-9 text-xs"
                    onClick={() =>
                      openPendingAction({
                        kind: "restore-user",
                        id: selectedUser.id,
                        label: "계정 복구",
                      })
                    }
                  >
                    <UserCheck className="h-4 w-4" />
                    계정 복구
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    className="h-9 text-xs"
                    onClick={() =>
                      openPendingAction({
                        kind: "suspend-user",
                        id: selectedUser.id,
                        label: "계정 정지",
                      })
                    }
                  >
                    <Ban className="h-4 w-4" />
                    기간 정지
                  </Button>
                )}
                <Button
                  variant="secondary"
                  className="h-9 text-xs"
                  disabled={selectedUser.activeSessions === 0}
                  title={
                    selectedUser.activeSessions
                      ? "이 사용자의 모든 활성 세션 종료"
                      : "종료할 활성 세션이 없습니다."
                  }
                  onClick={() =>
                    openPendingAction({
                      kind: "revoke-sessions",
                      id: selectedUser.id,
                      label: "활성 세션 전체 종료",
                    })
                  }
                >
                  세션 종료 ({selectedUser.activeSessions})
                </Button>
                <Button
                  variant="danger"
                  className="h-9 text-xs"
                  disabled={selectedUser.status === "withdrawn"}
                  onClick={() =>
                    openPendingAction({
                      kind: "delete-user",
                      id: selectedUser.id,
                      label: "계정 탈퇴",
                    })
                  }
                >
                  <UserMinus className="h-4 w-4" />
                  탈퇴 처리
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(selectedContent)}
        onClose={() => setSelectedContent(null)}
        title="콘텐츠 검토"
        wide
      >
        {selectedContent ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selectedContent.type === "post" ? "blue" : "green"}>
                {selectedContent.type === "post" ? "게시글" : "댓글"}
              </Badge>
              <Badge tone="slate">{selectedContent.board}</Badge>
              {contentStatusBadge(selectedContent.status)}
              {selectedContent.reports ? (
                <Badge tone="red">
                  미처리 신고 {selectedContent.reports}건
                </Badge>
              ) : null}
              {selectedContent.isLocked ? (
                <Badge tone="amber">잠금</Badge>
              ) : null}
              <span className="ml-auto text-xs text-slate-400">
                {selectedContent.id}
              </span>
            </div>
            <div>
              <h3 className="text-xl font-bold leading-8 text-slate-950">
                {selectedContent.title}
              </h3>
              <p className="mt-2 text-xs text-slate-500">
                {selectedContent.author} · {selectedContent.studentId} ·{" "}
                {selectedContent.time}
              </p>
              <p className="mt-5 whitespace-pre-wrap border-y border-slate-200 py-5 text-sm leading-7 text-slate-700">
                {selectedContent.preview}
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  {selectedContent.type === "post"
                    ? "댓글 " + selectedContent.comments.toLocaleString() + "개"
                    : "원 게시글 · " + selectedContent.contextTitle}
                </p>
              </div>
              <Link
                href={"/post/" + selectedContent.postId}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 shrink-0 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-blue-700 shadow-[var(--shadow-xs)] transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                사용자 화면 열기
              </Link>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {selectedContent.type === "post" &&
              !["hidden", "deleted"].includes(selectedContent.status) ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    openPendingAction({
                      kind: selectedContent.isLocked
                        ? "unlock-content"
                        : "lock-content",
                      id: selectedContent.id,
                      label: selectedContent.isLocked
                        ? "게시글 잠금 해제"
                        : "게시글 잠금",
                    })
                  }
                >
                  <Lock className="h-4 w-4" />
                  {selectedContent.isLocked ? "잠금 해제" : "댓글 잠금"}
                </Button>
              ) : null}
              {["hidden", "deleted"].includes(selectedContent.status) ? (
                <Button
                  variant="green"
                  onClick={() =>
                    openPendingAction({
                      kind: "restore-content",
                      id: selectedContent.id,
                      label: "콘텐츠 복구",
                    })
                  }
                >
                  <Undo2 className="h-4 w-4" />
                  복구
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      openPendingAction({
                        kind: "hide-content",
                        id: selectedContent.id,
                        label: "콘텐츠 숨김",
                      })
                    }
                  >
                    숨김
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      openPendingAction({
                        kind: "delete-content",
                        id: selectedContent.id,
                        label: "콘텐츠 삭제",
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    삭제
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={reportQueueOpen}
        onClose={() => setReportQueueOpen(false)}
        title="미처리 신고 큐"
        wide
      >
        <div className="space-y-3">
          {summary.openReportCount > reports.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs leading-5 text-amber-900">
              전체 {summary.openReportCount.toLocaleString()}건 중 오래된 순서로
              최대 100건을 표시합니다. 처리 후 새로고침하면 다음 신고가 이어서
              표시됩니다.
            </div>
          ) : null}
          {reports.map((report) => (
            <article key={report.id} className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[var(--shadow-xs)]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={report.status === "reviewing" ? "blue" : "red"}>
                  {report.status === "reviewing" ? "검토 중" : "접수"}
                </Badge>
                <Badge tone="slate">{report.targetType}</Badge>
                <span className="ml-auto text-xs text-slate-400">
                  {report.createdAt}
                </span>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">
                {report.targetLabel}
              </h3>
              <p className="mt-2 text-xs font-bold text-slate-600">
                신고자 {report.reporter} · 사유 코드 {report.reasonCode}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                {report.detail}
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {report.href ? (
                  <Link
                    href={report.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-blue-700 shadow-[var(--shadow-xs)] transition-all hover:border-slate-300 hover:bg-slate-50"
                  >
                    원문 열기
                  </Link>
                ) : (
                  <span
                    className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-slate-100 px-3 text-xs font-bold text-slate-400"
                    title="사용자 또는 메시지 신고는 공개 원문 링크를 제공하지 않습니다."
                  >
                    공개 원문 링크 없음
                  </span>
                )}
                {report.status === "open" ? (
                  <Button
                    variant="secondary"
                    className="h-9 text-xs"
                    onClick={() =>
                      openPendingAction({
                        kind: "review-report",
                        id: report.id,
                        label: "신고 검토 시작",
                      })
                    }
                  >
                    검토 시작
                  </Button>
                ) : null}
                <Button
                  variant="green"
                  className="h-9 text-xs"
                  onClick={() =>
                    openPendingAction({
                      kind: "resolve-report",
                      id: report.id,
                      label: "신고 해결",
                    })
                  }
                >
                  해결
                </Button>
                <Button
                  variant="danger"
                  className="h-9 text-xs"
                  onClick={() =>
                    openPendingAction({
                      kind: "dismiss-report",
                      id: report.id,
                      label: "신고 기각",
                    })
                  }
                >
                  기각
                </Button>
              </div>
            </article>
          ))}
          {reports.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              미처리 신고가 없습니다.
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={noticeOpen}
        onClose={() => {
          setNoticeOpen(false);
          resetNoticeDraft();
        }}
        title={editingNoticeId ? "공지 수정" : "새 공지 작성"}
        wide
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setNoticeOpen(false);
                resetNoticeDraft();
              }}
              disabled={applying}
            >
              취소
            </Button>
            <Button
              onClick={() => {
                const form = document.getElementById(
                  "notice-form",
                ) as HTMLFormElement | null;
                form?.requestSubmit();
              }}
              disabled={applying}
            >
              <Send className="h-4 w-4" />
              {applying
                ? "저장 중…"
                : editingNoticeId
                  ? "변경 저장"
                  : noticeDraft.schedule
                    ? "예약"
                    : "게시"}
            </Button>
          </>
        }
      >
        <form id="notice-form" onSubmit={saveNotice} className="space-y-5">
          <Field
            label="공지 제목"
            required
            hint={noticeDraft.title.length + "/60"}
          >
            <Input
              value={noticeDraft.title}
              onChange={(event) =>
                setNoticeDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              maxLength={60}
              placeholder="학생이 바로 이해할 수 있는 제목"
            />
          </Field>
          <Field
            label="공지 내용"
            required
            hint={noticeDraft.body.length + "/1000"}
          >
            <Textarea
              rows={7}
              value={noticeDraft.body}
              onChange={(event) =>
                setNoticeDraft((current) => ({
                  ...current,
                  body: event.target.value,
                }))
              }
              maxLength={1000}
              placeholder="일정, 대상, 필요한 행동을 구체적으로 작성하세요."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="중요도">
              <Select
                value={noticeDraft.priority}
                onChange={(event) =>
                  setNoticeDraft((current) => ({
                    ...current,
                    priority: event.target.value,
                  }))
                }
              >
                <option value="normal">일반</option>
                <option value="important">중요</option>
                <option value="urgent">긴급</option>
              </Select>
            </Field>
            <Field label="노출 대상">
              <Select
                value={noticeDraft.audience}
                onChange={(event) =>
                  setNoticeDraft((current) => ({
                    ...current,
                    audience: event.target.value,
                  }))
                }
              >
                <option value="all">전체 학생</option>
                <option value="1학년">1학년</option>
                <option value="2학년">2학년</option>
                <option value="3학년">3학년</option>
              </Select>
            </Field>
          </div>
          <Field label="예약 게시" hint="비워두면 즉시 게시">
            <Input
              type="datetime-local"
              value={noticeDraft.schedule}
              onChange={(event) =>
                setNoticeDraft((current) => ({
                  ...current,
                  schedule: event.target.value,
                }))
              }
            />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 transition-colors hover:bg-blue-50">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-blue-700"
              checked={noticeDraft.pinned}
              onChange={(event) =>
                setNoticeDraft((current) => ({
                  ...current,
                  pinned: event.target.checked,
                }))
              }
            />
            <span>
              <strong className="block text-sm text-blue-950">
                홈 공지 패널 우선 노출
              </strong>
              <span className="mt-1 block text-xs leading-5 text-blue-800">
                중요도 50 이상으로 저장되어 일반 공지보다 위에 표시됩니다.
              </span>
            </span>
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(pendingAction)}
        onClose={closePendingAction}
        title={pendingAction?.label || "관리 작업 확인"}
        description="위험 작업은 사유와 변경 전후 상태가 감사 로그에 영구 기록됩니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={closePendingAction}
              disabled={applying}
            >
              취소
            </Button>
            <Button
              variant={
                pendingAction?.kind.includes("restore") ||
                pendingAction?.kind === "resolve-report" ||
                pendingAction?.kind === "adjust-igk"
                  ? "green"
                  : "danger"
              }
              onClick={() => void applyAction()}
              disabled={
                applying ||
                reason.trim().length < 4 ||
                (pendingAction?.kind === "adjust-igk" &&
                  (!Number.isInteger(Number(igkAmount)) ||
                    Number(igkAmount) <= 0 ||
                    Number(igkAmount) > 100000))
              }
            >
              {applying ? "적용 중…" : pendingAction?.label || "적용"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
            <p className="text-xs leading-5 text-amber-900">
              대상 작업: <strong>{pendingAction?.label}</strong>
              <br />
              처리 사유와 변경 결과가 관리자 감사 로그에 기록됩니다.
            </p>
          </div>
          {pendingAction?.kind === "suspend-user" ? (
            <Field label="정지 기간">
              <Select
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              >
                <option value="1">1일</option>
                <option value="3">3일</option>
                <option value="7">7일</option>
                <option value="30">30일</option>
                <option value="0">영구 정지</option>
              </Select>
            </Field>
          ) : null}
          {pendingAction?.kind === "adjust-igk" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="IGK 조정 종류"><Button type="button" variant={igkDirection === 'GRANT' ? 'green' : 'secondary'} onClick={() => setIgkDirection('GRANT')}>지급</Button><Button type="button" variant={igkDirection === 'TAKE' ? 'danger' : 'secondary'} onClick={() => setIgkDirection('TAKE')}>회수</Button></div>
            <Field label={igkDirection === 'GRANT' ? '지급할 IGK' : '회수할 IGK'} required hint="현재 잔액만 변경하며 평생 활동 기록은 유지 · 1회 최대 100,000 IGK">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={100000}
                step={1}
                value={igkAmount}
                onChange={(event) => setIgkAmount(event.target.value)}
                placeholder="예: 500"
              />
            </Field>
            {(() => { const target = users.find((user) => user.id === pendingAction.id); if (!target || !Number.isInteger(Number(igkAmount)) || Number(igkAmount) <= 0) return null; const signed = Number(igkAmount) * (igkDirection === 'GRANT' ? 1 : -1); const after = Math.max(0, target.igk + signed); const tier = igkLevelForBalance(after); return <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-xs"><div className="bg-white p-3"><p className="text-slate-500">변경 전</p><p className="mt-1 font-black">{target.igk.toLocaleString()} IGK · {target.standing?.tierLabel ?? igkLevelLabel(target.level)}{target.standing?.rankLabel ? ` · ${target.standing.rankLabel}` : ''}</p></div><div className="bg-white p-3"><p className="text-slate-500">변경 후</p><p className="mt-1 font-black">{after.toLocaleString()} IGK · {tier.label}</p><p className="mt-1 text-slate-500">짱 순위 즉시 재계산</p></div></div>; })()}
            </div>
          ) : null}
          <Field
            label={
              pendingAction?.kind === "resolve-report" ||
              pendingAction?.kind === "dismiss-report"
                ? "처리 결과 및 근거"
                : "처리 사유"
            }
            required
            hint="최소 4자"
          >
            <Textarea
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="운영규칙 조항과 판단 근거를 구체적으로 기록하세요."
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title="관리자 감사 로그"
        wide
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={auditQuery}
              onChange={(event) => setAuditQuery(event.target.value)}
              placeholder="작업, 대상, 사유, 관리자 검색"
              className="pl-9"
            />
          </div>
          <Select
            value={auditKind}
            onChange={(event) => setAuditKind(event.target.value)}
            className="sm:w-40"
          >
            <option value="all">전체 작업</option>
            <option value="USER">사용자 조치</option>
            <option value="content">콘텐츠 조치</option>
            <option value="NOTICE">공지 변경</option>
            <option value="REPORT">신고 처리</option>
            <option value="STUDENT_INVITE">학생 인증 코드</option>
          </Select>
        </div>
        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500">
              <tr>
                <th className="border-b border-slate-100 px-4 py-3 font-bold">시간</th>
                <th className="border-b border-slate-100 px-4 py-3 font-bold">작업</th>
                <th className="border-b border-slate-100 px-4 py-3 font-bold">대상</th>
                <th className="border-b border-slate-100 px-4 py-3 font-bold">사유</th>
                <th className="border-b border-slate-100 px-4 py-3 font-bold">관리자 / IP 해시</th>
              </tr>
            </thead>
            <tbody>
              {filteredAuditEntries.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100 transition-colors hover:bg-slate-50/80">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {entry.time}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {entry.action}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{entry.target}</td>
                  <td className="max-w-[220px] px-4 py-3 leading-5 text-slate-600">
                    {entry.reason}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {entry.admin}
                    <br />
                    <span className="text-xs">{entry.ip}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredAuditEntries.length === 0 ? (
            <div className="border-t border-slate-100 py-10 text-center text-sm text-slate-500">
              조건에 맞는 감사 기록이 없습니다.
            </div>
          ) : null}
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          감사 로그는 변경하거나 삭제할 수 없습니다. 화면에는 최근 50건이
          표시됩니다.
        </p>
      </Modal>

      <Toast
        message={toast?.message || null}
        tone={toast?.tone}
        onClose={closeToast}
      />
    </div>
  );
}
