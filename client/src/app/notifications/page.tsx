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
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchWithTimeout, isAbortError, requestErrorMessage } from "@/lib/client/request";

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

type NotificationPreference = {
  type: ServerNotification["type"];
  inAppEnabled: boolean;
  pushEnabled: boolean;
};

type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
  timeZone: string;
};

type PushConfig = {
  configured: boolean;
  publicKey: string | null;
  subscribed: boolean;
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

function applicationServerKey(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const bytes = atob(padded);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function preferenceEnabled(preferences: NotificationPreference[], types: ServerNotification["type"][]) {
  return types.every((type) => preferences.find((item) => item.type === type)?.inAppEnabled !== false);
}

function notificationTarget(item: NotificationItem) {
  if (item.sourceType === "MESSAGE" && item.metadata.roomId) {
    return `/messages?roomId=${encodeURIComponent(item.metadata.roomId)}`;
  }
  return item.href?.startsWith("/") && !item.href.startsWith("//")
    ? item.href
    : undefined;
}

export default function NotificationsPage() {
  const router = useRouter();
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
  const [onlyUnread, setOnlyUnread] = useState(true);
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
    system: true,
    push: false,
  });
  const [settingsLoading, setSettingsLoading] = useState(!DEMO_MODE);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [quietHours, setQuietHours] = useState<QuietHours>({
    enabled: false,
    start: "22:00",
    end: "07:00",
    timeZone: "Asia/Seoul",
  });
  const [pushConfig, setPushConfig] = useState<PushConfig>({
    configured: false,
    publicKey: null,
    subscribed: false,
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
        const response = await fetchWithTimeout("/api/notifications?pageSize=100", {
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
        if (!active || isAbortError(cause)) return;
        setLoadError(requestErrorMessage(cause, "알림을 불러오지 못했습니다."));
        setLoadState("error");
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    const controller = new AbortController();
    async function loadSettings() {
      setSettingsLoading(true);
      try {
        const [preferenceResponse, pushResponse] = await Promise.all([
          fetchWithTimeout("/api/notifications/preferences", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetchWithTimeout("/api/notifications/push-subscriptions", {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        const preferencePayload = await readApiEnvelope<{
          preferences: NotificationPreference[];
          quietHours: QuietHours;
        }>(preferenceResponse);
        const pushPayload = await readApiEnvelope<PushConfig>(pushResponse);
        if (!preferenceResponse.ok || !preferencePayload?.ok) {
          throw new Error(apiErrorMessage(preferencePayload, "알림 설정을 불러오지 못했습니다."));
        }
        if (!pushResponse.ok || !pushPayload?.ok) {
          throw new Error(apiErrorMessage(pushPayload, "푸시 설정을 불러오지 못했습니다."));
        }
        const preferences = preferencePayload.data.preferences;
        setSettings({
          comments: preferenceEnabled(preferences, ["COMMENT", "REPLY"]),
          mentions: preferenceEnabled(preferences, ["MENTION"]),
          rewards: preferenceEnabled(preferences, ["RECOMMENDATION", "ANSWER_ACCEPTED"]),
          messages: preferenceEnabled(preferences, ["MESSAGE"]),
          notices: preferenceEnabled(preferences, ["NOTICE"]),
          system: preferenceEnabled(preferences, ["SYSTEM"]),
          push: preferences.some((item) => item.pushEnabled),
        });
        setQuietHours(preferencePayload.data.quietHours);
        setPushConfig(pushPayload.data);
      } catch (cause) {
        if (!isAbortError(cause)) {
          setToastTone("error");
          setToast(requestErrorMessage(cause, "알림 설정을 불러오지 못했습니다."));
        }
      } finally {
        setSettingsLoading(false);
      }
    }
    void loadSettings();
    return () => controller.abort();
  }, []);

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

  function toggleGroup(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openNotification(item: NotificationItem) {
    setNotifications((current) => current.filter((candidate) => candidate.id !== item.id));
    if (item.unread) {
      void syncReadState({ ids: [item.id] }, undefined, true);
    }
    const target = notificationTarget(item);
    if (target) router.push(target);
  }

  function openGroup(group: NotificationGroup) {
    const ids = group.items.filter((item) => item.unread).map((item) => item.id);
    const groupIds = new Set(group.items.map((item) => item.id));
    setNotifications((current) => current.filter((item) => !groupIds.has(item.id)));
    if (ids.length) {
      void syncReadState({ ids }, undefined, true);
    }
    const target = notificationTarget(group.latest);
    if (target) router.push(target);
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
    keepalive = false,
  ) {
    try {
      const response = await fetchWithTimeout("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive,
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
      setToast(requestErrorMessage(cause, "알림 상태를 서버에 반영하지 못했습니다."));
      return false;
    }
  }

  async function syncPushSubscription(enabled: boolean) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("이 브라우저는 웹 푸시를 지원하지 않습니다.");
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const existing = await registration.pushManager.getSubscription();
    if (!enabled) {
      if (existing) {
        const response = await fetchWithTimeout("/api/notifications/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        const payload = await readApiEnvelope<{ unsubscribed: boolean }>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(apiErrorMessage(payload, "푸시 구독을 해제하지 못했습니다."));
        }
        await existing.unsubscribe();
      }
      setPushConfig((current) => ({ ...current, subscribed: false }));
      return;
    }
    if (!pushConfig.configured || !pushConfig.publicKey) {
      throw new Error("웹 푸시 공개 키가 설정되지 않았습니다.");
    }
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission !== "granted") throw new Error("브라우저 알림 권한이 필요합니다.");
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(pushConfig.publicKey),
    });
    const response = await fetchWithTimeout("/api/notifications/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    const payload = await readApiEnvelope<{ subscription: { id: string } }>(response);
    if (!response.ok || !payload?.ok) {
      if (!existing) await subscription.unsubscribe();
      throw new Error(apiErrorMessage(payload, "푸시 구독을 저장하지 못했습니다."));
    }
    setPushConfig((current) => ({ ...current, subscribed: true }));
  }

  async function saveSettings() {
    if (DEMO_MODE) {
      setSettingsOpen(false);
      setToastTone("success");
      setToast("데모 알림 설정을 반영했습니다.");
      return;
    }
    setSettingsSaving(true);
    try {
      await syncPushSubscription(settings.push);
      const enabledByType: Record<ServerNotification["type"], boolean> = {
        COMMENT: settings.comments,
        REPLY: settings.comments,
        MENTION: settings.mentions,
        RECOMMENDATION: settings.rewards,
        ANSWER_ACCEPTED: settings.rewards,
        MESSAGE: settings.messages,
        NOTICE: settings.notices,
        SANCTION: true,
        SYSTEM: settings.system,
      };
      const response = await fetchWithTimeout("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: Object.entries(enabledByType).map(([type, inAppEnabled]) => ({
            type,
            inAppEnabled,
            pushEnabled: settings.push && inAppEnabled,
          })),
          quietHours,
        }),
      });
      const payload = await readApiEnvelope<{ preferences: NotificationPreference[] }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, "알림 설정을 저장하지 못했습니다."));
      }
      setSettingsOpen(false);
      setToastTone("success");
      setToast("알림 설정을 저장했습니다.");
    } catch (cause) {
      setToastTone("error");
      setToast(requestErrorMessage(cause, "알림 설정을 저장하지 못했습니다."));
    } finally {
      setSettingsSaving(false);
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
    <div className="app-page mx-auto w-full max-w-[1200px] px-4 py-4 sm:px-6 lg:px-8">
      <PageHeading
        title="알림"
        actions={
          <Button
            variant="secondary"
            onClick={() => setSettingsOpen(true)}
            disabled={settingsLoading}
          >
            {settingsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
            알림 설정
          </Button>
        }
      />

      <div className="mt-4 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside>
          <Card className="overflow-hidden ">
            <CardHeader
              title="알림 분류"
              description={`읽지 않음 ${unreadCount}개`}
              className="min-h-0 px-4 py-3"
            />
            <nav className="grid grid-cols-3 gap-1 p-2 md:block md:space-y-0.5">
              {categories.map((item) => {
                const Icon = item.icon;
                const count = categoryCount(item.value);
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setCategory(item.value)}
                    className={cn(
                      "flex min-w-0 w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-xs font-bold transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] md:gap-3 md:px-3",
                      category === item.value
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                        category === item.value
                          ? "bg-emerald-100/70 text-emerald-700"
                          : "bg-slate-100 text-slate-400",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>
          </Card>
        </aside>

        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-700"
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
                className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:text-slate-400 disabled:hover:bg-transparent"
              >
                <CheckCheck className="h-4 w-4" />
                모두 읽음
              </button>
              {DEMO_MODE ? (
                <button
                  type="button"
                  onClick={deleteRead}
                  className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100"
                >
                  <Trash2 className="h-4 w-4" />
                  데모 정리
                </button>
              ) : null}
            </div>
          </div>
          <div>
            {loadState === "loading" ? (
              <div className="space-y-1 p-3" aria-busy="true">
                <p className="sr-only">알림을 불러오는 중입니다.</p>
                {[0, 1, 2, 3, 4].map((item) => (
                  <div key={item} className="flex items-center gap-3 px-2 py-3">
                    <div className="skeleton h-10 w-10 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="skeleton h-3.5 w-3/5" />
                      <div className="skeleton h-3 w-4/5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {loadState === "auth" ? (
              <div className="px-5 py-20 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
                  <LogIn className="h-6 w-6" />
                </span>
                <p className="mt-4 text-sm font-bold text-slate-800">로그인이 필요합니다.</p>
                <Link
                  href="/login"
                  className="mt-5 inline-flex h-10 items-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-[var(--shadow-xs)] transition-all duration-200 hover:bg-emerald-800 hover:shadow-[var(--shadow-sm)] active:scale-[0.97]"
                >
                  로그인하기
                </Link>
              </div>
            ) : null}
            {loadState === "error" ? (
              <div className="px-5 py-20 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-50 text-red-500">
                  <RefreshCw className="h-6 w-6" />
                </span>
                <p className="mt-4 text-sm font-bold text-slate-800">
                  알림을 표시할 수 없습니다.
                </p>
                <p className="mt-2 text-xs text-red-600">{loadError}</p>
                <Button
                  className="mt-5"
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
                          "relative flex gap-3 border-b border-slate-100 px-4 py-4 transition-colors duration-300 last:border-b-0 hover:bg-slate-50/70 sm:px-5",
                          item.unread && "bg-emerald-50/50 hover:bg-emerald-50/70",
                        )}
                      >
                        {item.unread ? (
                          <span className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-full bg-emerald-500" />
                        ) : null}
                        {item.actor ? (
                          <Avatar
                            name={item.actor}
                            tone={item.type === "reward" ? "green" : "blue"}
                          />
                        ) : (
                          <span
                            className={cn(
                              "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
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
                                item.unread ? "font-semibold" : "font-bold",
                              )}
                            >
                              {DEMO_MODE && item.actor ? (
                                <>{item.actor}님이 </>
                              ) : null}
                              {item.title}
                            </h3>
                              {item.unread ? <span className="h-2 w-2 rounded-full bg-emerald-500" aria-label="읽지 않음" /> : null}
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-600">
                            {item.detail}
                          </p>
                          <p className="mt-2 text-xs text-slate-400">
                            {item.time}
                          </p>
                        </button>
                        <ChevronRight className="h-4 w-4 shrink-0 self-center text-slate-300" />
                      </article>
                    );
                  }

                  return (
                    <section
                      key={group.key}
                      className={cn(
                        "border-b border-slate-100 transition-colors duration-300 last:border-b-0",
                        group.unreadCount > 0 && "bg-emerald-50/40",
                      )}
                    >
                      <div className="relative flex gap-3 px-4 py-4 sm:px-5">
                        {group.unreadCount > 0 ? (
                          <span className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-full bg-emerald-500" />
                        ) : null}
                        <span
                          className={cn(
                            "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                            notificationTone(item.type),
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <button
                          type="button"
                          onClick={() => openGroup(group)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">
                              {group.title}
                            </h3>
                            <Badge tone="slate">{group.items.length}개</Badge>
                            {group.unreadCount > 0 ? (
                              <Badge tone="green">미확인 {group.unreadCount}</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1.5 line-clamp-1 text-xs leading-5 text-slate-600">
                            {item.actor ? `${item.actor} · ` : ""}
                            {item.title}
                          </p>
                          {item.detail ? (
                            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                              {item.detail}
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs text-slate-400">
                            {item.time}
                          </p>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <IconButton
                            label={expanded ? "알림 그룹 접기" : "알림 그룹 펼치기"}
                            aria-expanded={expanded}
                            onClick={() => toggleGroup(group.key)}
                          >
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                expanded && "rotate-180",
                              )}
                            />
                          </IconButton>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="anim-fade border-t border-slate-100 bg-slate-50/40 sm:pl-[68px]">
                          {group.items.map((child) => {
                            const ChildIcon = iconForType(child.type);
                            return (
                              <article
                                key={child.id}
                                className={cn(
                                  "relative flex gap-3 border-b border-slate-100 px-4 py-3 transition-colors duration-300 last:border-b-0 hover:bg-slate-50",
                                  child.unread && "bg-emerald-50/40 hover:bg-emerald-50/60",
                                )}
                              >
                                <span
                                  className={cn(
                                    "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                                    notificationTone(child.type),
                                  )}
                                >
                                  <ChildIcon className="h-3.5 w-3.5" />
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openNotification(child)}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <p
                                    className={cn(
                                      "text-xs text-slate-800",
                                      child.unread ? "font-semibold" : "font-bold",
                                    )}
                                  >
                                    {child.actor ? `${child.actor} · ` : ""}
                                    {child.title}
                                  </p>
                                  {child.detail ? (
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                                      {child.detail}
                                    </p>
                                  ) : null}
                                  <p className="mt-1 text-xs text-slate-400">
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
                <h3 className="mt-4 text-sm font-semibold text-slate-800">
                  새로운 알림이 없습니다.
                </h3>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="알림 설정"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSettingsOpen(false)} disabled={settingsSaving}>
              취소
            </Button>
            <Button onClick={() => void saveSettings()} disabled={settingsSaving || settingsLoading}>
              {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              설정 저장
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-xs font-semibold text-slate-500">
              알림 유형
            </h3>
            <div className="overflow-hidden rounded-xl border border-slate-200">
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
                  ["system", "시스템", "계정과 서비스 상태가 변경될 때"],
                ] as const
              ).map(([key, label, detail]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-slate-50/60"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-800">{label}</p>
                    <p className="mt-1 text-xs text-slate-500">{detail}</p>
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
                      "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      settings[key] ? "bg-emerald-600" : "bg-slate-300",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 h-4 w-4 rounded-full bg-white shadow-[var(--shadow-sm)] transition-all duration-200 ease-[cubic-bezier(0.34,1.32,0.5,1)]",
                        settings[key] ? "left-6" : "left-1",
                      )}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-slate-200 py-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
                <BellRing className="h-4 w-4" />웹 푸시 알림
              </p>
              <p className="mt-1 text-xs text-emerald-800">
                {DEMO_MODE
                  ? "이 기기의 브라우저 알림으로 전달합니다."
                  : pushConfig.configured
                    ? `${pushConfig.subscribed ? "이 기기가 구독 중입니다." : "이 기기에서 직접 동의해야 활성화됩니다."}`
                    : "서버에 웹 푸시 공개 키가 설정되지 않았습니다."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.push}
              disabled={!DEMO_MODE && !pushConfig.configured}
              onClick={() =>
                setSettings((current) => ({ ...current, push: !current.push }))
              }
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] disabled:cursor-not-allowed disabled:opacity-50",
                settings.push ? "bg-emerald-600" : "bg-slate-300",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 h-4 w-4 rounded-full bg-white shadow-[var(--shadow-sm)] transition-all duration-200 ease-[cubic-bezier(0.34,1.32,0.5,1)]",
                  settings.push ? "left-6" : "left-1",
                )}
              />
            </button>
          </div>
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">방해 금지 시간</p>
                <p className="mt-1 text-xs text-slate-500">보안 및 제재 알림을 제외한 웹 푸시를 잠시 멈춥니다.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={quietHours.enabled}
                onClick={() => setQuietHours((current) => ({ ...current, enabled: !current.enabled }))}
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  quietHours.enabled ? "bg-emerald-600" : "bg-slate-300",
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 h-4 w-4 rounded-full bg-white shadow-[var(--shadow-sm)] transition-all duration-200 ease-[cubic-bezier(0.34,1.32,0.5,1)]",
                    quietHours.enabled ? "left-6" : "left-1",
                  )}
                />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">
                시작
                <input
                  type="time"
                  value={quietHours.start}
                  disabled={!quietHours.enabled}
                  onChange={(event) => setQuietHours((current) => ({ ...current, start: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm transition-colors focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/10 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                종료
                <input
                  type="time"
                  value={quietHours.end}
                  disabled={!quietHours.enabled}
                  onChange={(event) => setQuietHours((current) => ({ ...current, end: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm transition-colors focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/10 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                시간대
                <select
                  value={quietHours.timeZone}
                  disabled={!quietHours.enabled}
                  onChange={(event) => setQuietHours((current) => ({ ...current, timeZone: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm transition-colors focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/10 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="Asia/Seoul">서울 (KST)</option>
                  <option value="Asia/Tokyo">도쿄 (JST)</option>
                  <option value="UTC">UTC</option>
                </select>
              </label>
            </div>
          </div>
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            보안 및 제재 알림은 계정 보호와 운영 정책 안내를 위해 유형 설정과 관계없이 인앱으로 전달됩니다. 웹 푸시는 이 기기에서 동의한 경우에만 전달됩니다.
          </p>
        </div>
      </Modal>
      <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />
    </div>
  );
}
