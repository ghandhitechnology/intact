"use client";

import {
  Avatar,
  apiErrorMessage,
  Badge,
  Button,
  Card,
  CardHeader,
  IconButton,
  Modal,
  PageHeading,
  readApiEnvelope,
  Toast,
  cn,
} from "@/components/operations/ui";
import {
  AtSign,
  Bell,
  BellOff,
  BellRing,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Gift,
  Loader2,
  LogIn,
  Megaphone,
  MessageCircle,
  RefreshCw,
  Settings2,
  ShieldAlert,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const DEMO_MODE = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true";

type NotificationType =
  | "comment"
  | "mention"
  | "recommend"
  | "reward"
  | "notice"
  | "message"
  | "system";
type NotificationMetadata = {
  postId?: string;
  commentId?: string;
  roomId?: string;
  messageId?: string;
  noticeId?: string;
  transferId?: string;
  [key: string]: unknown;
};
type NotificationItem = {
  id: string;
  type: NotificationType;
  actor?: string;
  title: string;
  detail: string;
  time: string;
  createdAt: string;
  unread: boolean;
  href?: string;
  sourceType: ServerNotification["type"];
  metadata: NotificationMetadata;
};

type NotificationGroup = {
  key: string;
  kind: "post" | "recommend" | "message" | "single";
  title: string;
  items: NotificationItem[];
  latest: NotificationItem;
  unreadCount: number;
};

type ServerNotification = {
  id: string;
  createdAt: string;
  type:
    | "COMMENT"
    | "REPLY"
    | "MENTION"
    | "RECOMMENDATION"
    | "ANSWER_ACCEPTED"
    | "MESSAGE"
    | "NOTICE"
    | "SANCTION"
    | "SYSTEM";
  title: string;
  body: string | null;
  href: string | null;
  metadata: unknown;
  readAt: string | null;
  actor: {
    id: string;
    nickname: string;
    realName: string | null;
    profileImage: string | null;
    studentIdentity: { studentCode: string } | null;
  } | null;
};

const initialNotifications: NotificationItem[] = [
  {
    id: "n1",
    type: "comment",
    actor: "박민서",
    title: "내 질문에 새 답변을 남겼습니다.",
    detail: "전자기 유도 문제에서 렌츠 법칙 적용 방향이 헷갈립니다",
    time: "3분 전",
    createdAt: "2026-07-13T12:57:00+09:00",
    unread: true,
    href: "/boards/questions/128",
    sourceType: "COMMENT",
    metadata: { postId: "128", commentId: "comment-128-a" },
  },
  {
    id: "n2",
    type: "mention",
    actor: "최서윤",
    title: "댓글에서 나를 언급했습니다.",
    detail: "푸른별님이 정리한 4번 풀이도 같이 참고하면 좋을 것 같아요.",
    time: "18분 전",
    createdAt: "2026-07-13T12:42:00+09:00",
    unread: true,
    href: "/boards/questions/128",
    sourceType: "MENTION",
    metadata: { postId: "128", commentId: "comment-128-b" },
  },
  {
    id: "n3",
    type: "reward",
    actor: "박민서",
    title: "50 IGK를 선물했습니다.",
    detail: "자료 고마워! 다음에도 부탁해 🙌",
    time: "1시간 전",
    createdAt: "2026-07-13T12:00:00+09:00",
    unread: true,
    href: "/igk",
    sourceType: "SYSTEM",
    metadata: { transferId: "transfer-1" },
  },
  {
    id: "n4",
    type: "recommend",
    actor: "김도윤",
    title: "내 게시글을 추천했습니다.",
    detail: "전국 청소년 과학탐구대회 물리 분야 팀원 1명 모집",
    time: "오늘 12:41",
    createdAt: "2026-07-13T12:41:00+09:00",
    unread: false,
    href: "/boards/recruit/52",
    sourceType: "RECOMMENDATION",
    metadata: { postId: "52" },
  },
  {
    id: "n5",
    type: "notice",
    title: "기숙사 소방 점검 일정 안내",
    detail: "7월 15일 19:00~20:00 기숙사 전 층 소방 점검이 진행됩니다.",
    time: "오늘 09:00",
    createdAt: "2026-07-13T09:00:00+09:00",
    unread: false,
    href: "/notices/17",
    sourceType: "NOTICE",
    metadata: { noticeId: "17" },
  },
  {
    id: "n6",
    type: "system",
    title: "재학생 인증이 30일 후 만료됩니다.",
    detail:
      "계속 이용하려면 리로스쿨에서 2026학년도 재학생 인증을 완료해 주세요.",
    time: "어제",
    createdAt: "2026-07-12T15:00:00+09:00",
    unread: false,
    href: "/profile/verification",
    sourceType: "SYSTEM",
    metadata: {},
  },
  {
    id: "n7",
    type: "comment",
    actor: "윤지호",
    title: "내 댓글에 답글을 남겼습니다.",
    detail: "그 방식이면 오차 전파도 고려해야 하지 않을까요?",
    time: "7월 10일",
    createdAt: "2026-07-10T14:00:00+09:00",
    unread: false,
    href: "/boards/questions/91",
    sourceType: "REPLY",
    metadata: { postId: "91", commentId: "comment-91" },
  },
  {
    id: "n8",
    type: "recommend",
    actor: "이준호",
    title: "내 답변을 추천했습니다.",
    detail: "케플러 제2법칙 유도 과정에 대한 답변",
    time: "7월 9일",
    createdAt: "2026-07-09T11:00:00+09:00",
    unread: false,
    href: "/boards/questions/76",
    sourceType: "RECOMMENDATION",
    metadata: { postId: "76", commentId: "answer-76" },
  },
];

const categories = [
  { value: "all", label: "전체 알림", icon: Bell },
  { value: "interaction", label: "댓글·멘션", icon: AtSign },
  { value: "reward", label: "추천·IGK", icon: Gift },
  { value: "notice", label: "공지", icon: Megaphone },
  { value: "system", label: "시스템", icon: ShieldAlert },
] as const;

const iconForType = (type: NotificationType) => {
  if (type === "comment" || type === "message") return MessageCircle;
  if (type === "mention") return AtSign;
  if (type === "recommend") return ThumbsUp;
  if (type === "reward") return Gift;
  if (type === "notice") return Megaphone;
  return ShieldAlert;
};

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "방금";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}일 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function mapType(notification: ServerNotification): NotificationType {
  if (notification.type === "COMMENT" || notification.type === "REPLY")
    return "comment";
  if (notification.type === "MENTION") return "mention";
  if (notification.type === "RECOMMENDATION") return "recommend";
  if (notification.type === "ANSWER_ACCEPTED" || notification.href === "/igk")
    return "reward";
  if (notification.type === "NOTICE") return "notice";
  if (notification.type === "MESSAGE") return "message";
  return "system";
}

function parseNotificationMetadata(value: unknown): NotificationMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const metadata: NotificationMetadata = {};
  for (const key of [
    "postId",
    "commentId",
    "roomId",
    "messageId",
    "noticeId",
    "transferId",
  ] as const) {
    if (typeof source[key] === "string") metadata[key] = source[key];
  }
  return metadata;
}

function postIdFromHref(href?: string) {
  if (!href) return undefined;
  return (
    href.match(/\/post\/([^/?#]+)/)?.[1] ??
    href.match(/\/boards\/[^/]+\/([^/?#]+)/)?.[1]
  );
}

function notificationGroupIdentity(item: NotificationItem) {
  const postId = item.metadata.postId ?? postIdFromHref(item.href);
  if (
    (item.sourceType === "COMMENT" ||
      item.sourceType === "REPLY" ||
      item.sourceType === "MENTION") &&
    postId
  ) {
    return {
      key: `post:${postId}`,
      kind: "post" as const,
      title: "이 글의 새 활동",
    };
  }
  if (item.sourceType === "RECOMMENDATION") {
    const target = item.metadata.commentId
      ? `comment:${item.metadata.commentId}`
      : postId
        ? `post:${postId}`
        : undefined;
    if (target)
      return {
        key: `recommend:${target}`,
        kind: "recommend" as const,
        title: "이 콘텐츠의 새 추천",
      };
  }
  if (item.sourceType === "MESSAGE" && item.metadata.roomId) {
    return {
      key: `message:${item.metadata.roomId}`,
      kind: "message" as const,
      title: "이 대화방의 새 메시지",
    };
  }
  return {
    key: `single:${item.id}`,
    kind: "single" as const,
    title: item.title,
  };
}

function groupNotifications(items: NotificationItem[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  for (const item of items) {
    const identity = notificationGroupIdentity(item);
    const current = groups.get(identity.key);
    if (current) current.items.push(item);
    else {
      groups.set(identity.key, {
        ...identity,
        items: [item],
        latest: item,
        unreadCount: 0,
      });
    }
  }
  return Array.from(groups.values())
    .map((group) => {
      const sorted = [...group.items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return {
        ...group,
        items: sorted,
        latest: sorted[0],
        unreadCount: sorted.filter((item) => item.unread).length,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.latest.createdAt).getTime() -
        new Date(a.latest.createdAt).getTime(),
    );
}

function notificationTone(type: NotificationType) {
  if (type === "reward") return "bg-emerald-100 text-emerald-700";
  if (type === "notice") return "bg-blue-100 text-blue-700";
  if (type === "system") return "bg-amber-100 text-amber-700";
  if (type === "recommend") return "bg-violet-100 text-violet-700";
  return "bg-slate-100 text-slate-700";
}

function mapNotification(item: ServerNotification): NotificationItem {
  return {
    id: item.id,
    type: mapType(item),
    actor: item.actor?.realName || item.actor?.nickname,
    title: item.title,
    detail: item.body ?? "",
    time: relativeTime(item.createdAt),
    createdAt: item.createdAt,
    unread: item.readAt === null,
    href: item.href ?? undefined,
    sourceType: item.type,
    metadata: parseNotificationMetadata(item.metadata),
  };
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    DEMO_MODE ? initialNotifications : [],
  );
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "auth" | "error"
  >(DEMO_MODE ? "ready" : "loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [category, setCategory] =
    useState<(typeof categories)[number]["value"]>("all");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({
    comments: true,
    mentions: true,
    rewards: true,
    messages: true,
    notices: true,
    push: false,
  });
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("success");

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoadState("loading");
      setLoadError("");
      try {
        const response = await fetch("/api/notifications?pageSize=100", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readApiEnvelope<{
          notifications: ServerNotification[];
          unreadCount: number;
        }>(response);
        if (!active) return;
        if (response.status === 401) {
          setLoadState("auth");
          return;
        }
        if (!response.ok || !payload?.ok)
          throw new Error(
            apiErrorMessage(payload, "알림을 불러오지 못했습니다."),
          );
        setNotifications(payload.data.notifications.map(mapNotification));
        setLoadState("ready");
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setLoadError(
          cause instanceof Error
            ? cause.message
            : "알림을 불러오지 못했습니다.",
        );
        setLoadState("error");
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  const unreadCount = notifications.filter((item) => item.unread).length;
  const visible = useMemo(
    () =>
      notifications.filter((item) => {
        if (onlyUnread && !item.unread) return false;
        if (category === "interaction")
          return (
            item.type === "comment" ||
            item.type === "mention" ||
            item.type === "message"
          );
        if (category === "reward")
          return item.type === "recommend" || item.type === "reward";
        if (category === "notice") return item.type === "notice";
        if (category === "system") return item.type === "system";
        return true;
      }),
    [notifications, category, onlyUnread],
  );
  const visibleGroups = useMemo(() => groupNotifications(visible), [visible]);

  function markRead(id: string) {
    const previous = notifications;
    setNotifications((current) =>
      current.map((item) =>
        item.id === id ? { ...item, unread: false } : item,
      ),
    );
    void syncReadState({ ids: [id] }).then((ok) => {
      if (!ok) setNotifications(previous);
    });
  }

  async function markGroupRead(group: NotificationGroup) {
    const ids = group.items.filter((item) => item.unread).map((item) => item.id);
    if (!ids.length) return;
    const previous = notifications;
    setNotifications((current) =>
      current.map((item) =>
        ids.includes(item.id) ? { ...item, unread: false } : item,
      ),
    );
    const ok = await syncReadState({ ids });
    if (!ok) setNotifications(previous);
  }

  function toggleGroup(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function openNotification(item: NotificationItem) {
    if (item.unread) {
      const ok = await syncReadState({ ids: [item.id] });
      if (!ok) return;
      setNotifications((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, unread: false }
            : candidate,
        ),
      );
    }
    if (item.href) window.location.assign(item.href);
  }

  function markAllRead() {
    const previous = notifications;
    setNotifications((current) =>
      current.map((item) => ({ ...item, unread: false })),
    );
    void syncReadState({ all: true }, "모든 알림을 읽음 처리했습니다.").then(
      (ok) => {
        if (!ok) setNotifications(previous);
      },
    );
  }

  async function syncReadState(
    body: { ids?: string[]; all?: boolean },
    successMessage?: string,
  ) {
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readApiEnvelope<{ markedRead: number }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          apiErrorMessage(payload, "알림 상태를 서버에 반영하지 못했습니다."),
        );
      }
      if (successMessage) {
        setToastTone("success");
        setToast(successMessage);
      }
      return true;
    } catch (cause) {
      setToastTone("error");
      setToast(
        cause instanceof Error
          ? cause.message
          : "알림 상태를 서버에 반영하지 못했습니다.",
      );
      return false;
    }
  }

  function deleteRead() {
    if (!DEMO_MODE) return;
    setNotifications((current) => current.filter((item) => item.unread));
    setToastTone("success");
    setToast("데모 알림을 정리했습니다.");
  }

  const categoryCount = (value: string) =>
    notifications.filter((item) => {
      if (value === "all") return true;
      if (value === "interaction")
        return (
          item.type === "comment" ||
          item.type === "mention" ||
          item.type === "message"
        );
      if (value === "reward")
        return item.type === "recommend" || item.type === "reward";
      return item.type === value;
    }).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeading
        eyebrow="내 소식"
        title="알림 센터"
        actions={
          DEMO_MODE ? (
            <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="h-4 w-4" />
              데모 설정
            </Button>
          ) : undefined
        }
      />

      <div className="mt-6 grid gap-6 md:grid-cols-[230px_minmax(0,1fr)]">
        <aside>
          <Card className="overflow-hidden shadow-none">
            <CardHeader
              title="알림 분류"
              description={`읽지 않음 ${unreadCount}개`}
              className="min-h-0 px-4 py-3 md:min-h-[68px] md:px-5 md:py-4"
            />
            <nav className="grid grid-cols-3 gap-1 p-2 md:block">
              {categories.map((item) => {
                const Icon = item.icon;
                const count = categoryCount(item.value);
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setCategory(item.value)}
                    className={cn(
                      "flex min-w-0 w-full items-center gap-2 px-2 py-2.5 text-left text-xs font-bold transition md:gap-3 md:px-3 md:py-3 md:text-sm",
                      category === item.value
                        ? "bg-blue-50 text-blue-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span
                      className={cn(
                        "text-xs",
                        category === item.value
                          ? "text-blue-700"
                          : "text-slate-400",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>
          </Card>
          {DEMO_MODE ? (
            <Card className="mt-4 hidden border-emerald-200 bg-emerald-50 p-4 shadow-none md:block">
              <div className="flex gap-3">
                <BellRing className="h-5 w-5 shrink-0 text-emerald-700" />
                <div>
                  <h3 className="text-xs font-extrabold text-emerald-950">
                    데모 푸시 알림
                  </h3>
                </div>
              </div>
            </Card>
          ) : null}
        </aside>

        <Card className="min-w-0 overflow-hidden shadow-none">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-700"
                checked={onlyUnread}
                onChange={(event) => setOnlyUnread(event.target.checked)}
              />
              읽지 않은 알림만 보기
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={markAllRead}
                disabled={unreadCount === 0 || loadState !== "ready"}
                className="inline-flex h-9 items-center gap-2 px-3 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:text-slate-400"
              >
                <CheckCheck className="h-4 w-4" />
                모두 읽음
              </button>
              {DEMO_MODE ? (
                <button
                  type="button"
                  onClick={deleteRead}
                  className="inline-flex h-9 items-center gap-2 px-3 text-xs font-bold text-slate-500 hover:bg-slate-100"
                >
                  <Trash2 className="h-4 w-4" />
                  데모 정리
                </button>
              ) : null}
            </div>
          </div>
          <div>
            {loadState === "loading" ? (
              <div className="px-5 py-20 text-center">
                <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-700" />
                <p className="mt-3 text-sm font-bold">
                  알림을 불러오는 중입니다.
                </p>
              </div>
            ) : null}
            {loadState === "auth" ? (
              <div className="px-5 py-20 text-center">
                <LogIn className="mx-auto h-7 w-7 text-blue-700" />
                <p className="mt-3 text-sm font-bold">로그인이 필요합니다.</p>
                <Link
                  href="/login"
                  className="mt-4 inline-flex h-10 items-center bg-blue-700 px-4 text-sm font-bold text-white"
                >
                  로그인하기
                </Link>
              </div>
            ) : null}
            {loadState === "error" ? (
              <div className="px-5 py-20 text-center">
                <RefreshCw className="mx-auto h-7 w-7 text-red-600" />
                <p className="mt-3 text-sm font-bold">
                  알림을 표시할 수 없습니다.
                </p>
                <p className="mt-2 text-xs text-red-600">{loadError}</p>
                <Button
                  className="mt-4"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  다시 시도
                </Button>
              </div>
            ) : null}
            {loadState === "ready"
              ? visibleGroups.map((group) => {
                  const item = group.latest;
                  const Icon = iconForType(item.type);
                  const expanded = expandedGroups.has(group.key);

                  if (group.kind === "single") {
                    return (
                      <article
                        key={group.key}
                        className={cn(
                          "relative flex gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0 sm:px-5",
                          item.unread && "bg-blue-50/40",
                        )}
                      >
                        {item.unread ? (
                          <span className="absolute left-0 top-0 h-full w-0.5 bg-blue-600" />
                        ) : null}
                        {item.actor ? (
                          <Avatar
                            name={item.actor}
                            tone={item.type === "reward" ? "green" : "blue"}
                          />
                        ) : (
                          <span
                            className={cn(
                              "grid h-10 w-10 shrink-0 place-items-center rounded-md",
                              notificationTone(item.type),
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void openNotification(item)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h3
                              className={cn(
                                "text-sm text-slate-900",
                                item.unread ? "font-extrabold" : "font-bold",
                              )}
                            >
                              {DEMO_MODE && item.actor ? (
                                <>{item.actor}님이 </>
                              ) : null}
                              {item.title}
                            </h3>
                            {item.unread ? <Badge tone="blue">NEW</Badge> : null}
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-600">
                            {item.detail}
                          </p>
                          <p className="mt-2 text-[11px] text-slate-400">
                            {item.time}
                          </p>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          {item.unread ? (
                            <IconButton
                              label="읽음 처리"
                              onClick={() => markRead(item.id)}
                            >
                              <CheckCheck className="h-4 w-4" />
                            </IconButton>
                          ) : null}
                          <ChevronRight className="h-4 w-4 text-slate-300" />
                        </div>
                      </article>
                    );
                  }

                  return (
                    <section
                      key={group.key}
                      className={cn(
                        "border-b border-slate-200 last:border-b-0",
                        group.unreadCount > 0 && "bg-blue-50/30",
                      )}
                    >
                      <div className="relative flex gap-3 px-4 py-4 sm:px-5">
                        {group.unreadCount > 0 ? (
                          <span className="absolute left-0 top-0 h-full w-0.5 bg-blue-600" />
                        ) : null}
                        <span
                          className={cn(
                            "grid h-10 w-10 shrink-0 place-items-center rounded-md",
                            notificationTone(item.type),
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => toggleGroup(group.key)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-extrabold text-slate-900">
                              {group.title}
                            </h3>
                            <Badge tone="slate">{group.items.length}개</Badge>
                            {group.unreadCount > 0 ? (
                              <Badge tone="blue">미확인 {group.unreadCount}</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1.5 line-clamp-1 text-xs leading-5 text-slate-600">
                            {item.actor ? `${item.actor} · ` : ""}
                            {item.title}
                          </p>
                          {item.detail ? (
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                              {item.detail}
                            </p>
                          ) : null}
                          <p className="mt-2 text-[11px] text-slate-400">
                            {item.time}
                          </p>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          {group.unreadCount > 0 ? (
                            <IconButton
                              label="그룹 모두 읽음"
                              onClick={() => void markGroupRead(group)}
                            >
                              <CheckCheck className="h-4 w-4" />
                            </IconButton>
                          ) : null}
                          <IconButton
                            label={expanded ? "알림 그룹 접기" : "알림 그룹 펼치기"}
                            aria-expanded={expanded}
                            onClick={() => toggleGroup(group.key)}
                          >
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 transition-transform",
                                expanded && "rotate-180",
                              )}
                            />
                          </IconButton>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="border-t border-slate-200 bg-white sm:pl-[68px]">
                          {group.items.map((child) => {
                            const ChildIcon = iconForType(child.type);
                            return (
                              <article
                                key={child.id}
                                className={cn(
                                  "relative flex gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0",
                                  child.unread && "bg-blue-50/30",
                                )}
                              >
                                <span
                                  className={cn(
                                    "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md",
                                    notificationTone(child.type),
                                  )}
                                >
                                  <ChildIcon className="h-3.5 w-3.5" />
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void openNotification(child)}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <p
                                    className={cn(
                                      "text-xs text-slate-800",
                                      child.unread ? "font-extrabold" : "font-bold",
                                    )}
                                  >
                                    {child.actor ? `${child.actor} · ` : ""}
                                    {child.title}
                                  </p>
                                  {child.detail ? (
                                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">
                                      {child.detail}
                                    </p>
                                  ) : null}
                                  <p className="mt-1 text-[10px] text-slate-400">
                                    {child.time}
                                  </p>
                                </button>
                                <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300" />
                              </article>
                            );
                          })}
                        </div>
                      ) : null}
                    </section>
                  );
                })
              : null}
            {loadState === "ready" && visibleGroups.length === 0 ? (
              <div className="px-5 py-20 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
                  <BellOff className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-sm font-extrabold text-slate-800">
                  새로운 알림이 없습니다.
                </h3>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Modal
        open={DEMO_MODE && settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="데모 알림 설정"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSettingsOpen(false)}>
              취소
            </Button>
            <Button
              onClick={() => {
                setSettingsOpen(false);
                setToastTone("success");
                setToast("데모 알림 설정을 반영했습니다.");
              }}
            >
              설정 반영
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">
              알림 유형
            </h3>
            <div className="border border-slate-200">
              {(
                [
                  [
                    "comments",
                    "내 글의 댓글·답글",
                    "질문과 게시글에 새 반응이 달릴 때",
                  ],
                  ["mentions", "멘션", "댓글이나 채팅에서 나를 언급할 때"],
                  ["rewards", "추천·IGK", "추천, 채택, IGK 선물이 생길 때"],
                  ["messages", "메시지", "새 1:1 및 그룹 메시지가 도착할 때"],
                  ["notices", "학교·운영 공지", "중요 공지가 게시될 때"],
                ] as const
              ).map(([key, label, detail]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-800">{label}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings[key]}
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        [key]: !current[key],
                      }))
                    }
                    className={cn(
                      "relative h-6 w-11 shrink-0 rounded-full transition",
                      settings[key] ? "bg-blue-700" : "bg-slate-300",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all",
                        settings[key] ? "left-6" : "left-1",
                      )}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border border-emerald-200 bg-emerald-50 p-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-extrabold text-emerald-950">
                <BellRing className="h-4 w-4" />웹 푸시 알림
              </p>
              <p className="mt-1 text-[11px] text-emerald-800">
                이 기기의 브라우저 알림으로 전달합니다.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.push}
              onClick={() =>
                setSettings((current) => ({ ...current, push: !current.push }))
              }
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition",
                settings.push ? "bg-emerald-700" : "bg-slate-300",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all",
                  settings.push ? "left-6" : "left-1",
                )}
              />
            </button>
          </div>
        </div>
      </Modal>
      <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />
    </div>
  );
}
