"use client";

import {
  Avatar,
  apiErrorMessage,
  Badge,
  Button,
  Card,
  IconButton,
  Input,
  Modal,
  PageHeading,
  readApiEnvelope,
  Toast,
  cn,
} from "@/components/operations/ui";
import {
  Archive,
  ArrowDown,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronLeft,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  Smile,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { isValidStudentCode, STUDENT_CODE_REQUIREMENTS } from "@/lib/student-code";
import { fetchWithTimeout, isAbortError, requestErrorMessage } from "@/lib/client/request";
import { usePortalSession } from "@/components/portal/SessionProvider";
import { usePlatformMode } from "@/components/portal/PlatformModeProvider";
import type { IgkStanding } from "@/lib/igk-levels";
import { io, type Socket } from "socket.io-client";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const DEMO_MODE = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true";
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL;

function participantCodes(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

type Room = {
  id: string;
  name: string;
  type: "direct" | "group";
  preview: string;
  time: string;
  unread: number;
  online?: boolean;
  members: number;
  muted?: boolean;
  pinned?: boolean;
  tone: "blue" | "green" | "violet" | "amber" | "slate";
  memberIds: string[];
};

type ChatMessage = {
  id: string;
  sender: string;
  studentId: string;
  senderId?: string;
  standing?: IgkStanding | null;
  profileImage?: string | null;
  body: string;
  time: string;
  createdAt?: string;
  sequence?: string;
  mine?: boolean;
  read?: boolean;
  failed?: boolean;
  file?: { id?: string; name: string; size: string; mimeType?: string };
};

type ServerAuthor = {
  id: string;
  nickname: string;
  realName?: string | null;
  studentIdentity?: { studentCode: string } | null;
  standing?: IgkStanding | null;
  profileImage?: string | null;
};

type ServerMessage = {
  id: string;
  roomId?: string;
  createdAt: string;
  sequence?: string;
  content: string;
  sender: ServerAuthor;
  attachments?: Array<{ id: string; originalName: string; mimeType: string; sizeBytes?: number | string }>;
  readByAll?: boolean;
};

type ServerRoom = {
  id: string;
  type: "DIRECT" | "GROUP";
  title: string | null;
  members: Array<{
    user: ServerAuthor;
    lastReadSequence?: string;
    lastReadMessage?: { createdAt: string; sequence?: string } | null;
  }>;
  messages: Array<{
    id: string;
    sequence?: string;
    content: string;
    createdAt: string;
    sender: { id?: string; nickname: string; realName?: string | null };
  }>;
  unreadCount?: number;
};

type ChatCache = {
  savedAt: number;
  rooms: Room[];
  messages: Record<string, ChatMessage[]>;
  selectedId: string;
  currentUserId: string | null;
  currentStudentCode: string;
};

function chatCacheKey() {
  if (typeof document === "undefined") return "";
  const scope = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("intact_cache_scope="))
    ?.split("=")
    .slice(1)
    .join("=");
  return scope ? `intact:chat:v1:${decodeURIComponent(scope)}` : "";
}

function readChatCache(): ChatCache | null {
  const key = chatCacheKey();
  if (!key) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || "null") as ChatCache | null;
    if (!parsed || Date.now() - parsed.savedAt > 12 * 60 * 60_000 || !Array.isArray(parsed.rooms)) return null;
    return parsed;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

function writeChatCache(value: ChatCache) {
  const key = chatCacheKey();
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Chat remains fully usable when browser storage is unavailable or full.
  }
}

function isServerMessage(value: unknown): value is ServerMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ServerMessage>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.createdAt === "string" &&
    Boolean(candidate.sender && typeof candidate.sender.id === "string")
  );
}

function messageFromContract(value: unknown): ServerMessage | null {
  if (isServerMessage(value)) return value;
  if (!value || typeof value !== "object") return null;
  const candidate = value as { message?: unknown; data?: unknown };
  return messageFromContract(candidate.message) || messageFromContract(candidate.data);
}

function sequenceAtMost(value: string | undefined, upperBound: string | undefined) {
  if (!value || !upperBound || !/^\d+$/.test(value) || !/^\d+$/.test(upperBound)) return false;
  return BigInt(value) <= BigInt(upperBound);
}

function mapServerMessage(
  message: ServerMessage,
  currentUserId: string | null,
): ChatMessage {
  return {
    id: message.id,
    sender:
      message.sender.id === currentUserId
        ? "나"
        : message.sender.realName || message.sender.nickname,
    studentId: message.sender.studentIdentity?.studentCode ?? "",
    senderId: message.sender.id,
    standing: message.sender.standing,
    profileImage: message.sender.profileImage,
    body: message.content,
    time: new Intl.DateTimeFormat("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(message.createdAt)),
    createdAt: message.createdAt,
    sequence: message.sequence,
    mine: message.sender.id === currentUserId,
    read: Boolean(message.readByAll),
    file: message.attachments?.[0]
      ? {
          id: message.attachments[0].id,
          name: message.attachments[0].originalName,
          mimeType: message.attachments[0].mimeType,
          size: message.attachments[0].sizeBytes
            ? `${Math.max(0.1, Number(message.attachments[0].sizeBytes) / 1_048_576).toFixed(1)} MB`
            : "첨부 파일",
        }
      : undefined,
  };
}

async function persistMessage(
  roomId: string,
  content: string,
  clientId: string,
  attachmentIds: string[] = [],
) {
  const response = await fetchWithTimeout("/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": clientId,
    },
    body: JSON.stringify({ roomId, content, attachmentIds }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* handled below */
  }
  const envelope =
    payload && typeof payload === "object" && "ok" in payload
      ? (payload as {
          ok: boolean;
          error?: { message?: string };
        })
      : null;
  if (!response.ok)
    throw new Error(
      envelope?.error?.message || "메시지를 서버에 저장하지 못했습니다.",
    );
  const message = messageFromContract(payload);
  if (!message)
    throw new Error("서버의 메시지 응답을 확인할 수 없습니다.");
  return message;
}

function deliverRealtime(
  socket: Socket,
  roomId: string,
  content: string,
  clientId: string,
) {
  return new Promise<ServerMessage>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("실시간 응답 시간이 초과되었습니다.")),
      1_500,
    );
    socket.emit(
      "chat:message",
      { clientId, roomId, content, type: "TEXT" },
      (ack: unknown) => {
        window.clearTimeout(timer);
        const message = messageFromContract(ack);
        if (message) resolve(message);
        else {
          const error =
            ack && typeof ack === "object" && "error" in ack
              ? String((ack as { error?: unknown }).error || "")
              : "";
          reject(new Error(error || "실시간 전송에 실패했습니다."));
        }
      },
    );
  });
}

const initialRooms: Room[] = [
  {
    id: "physics",
    name: "물리올림피아드 준비방",
    type: "group",
    preview: "민서: 저녁에 4번 풀이 같이 볼 사람?",
    time: "방금",
    unread: 3,
    members: 8,
    pinned: true,
    tone: "blue",
    memberIds: ["demo-user-1", "demo-user-2"],
  },
  {
    id: "minseo",
    name: "박민서",
    type: "direct",
    preview: "자료 확인했어! 고마워 🙌",
    time: "14:21",
    unread: 1,
    online: true,
    members: 2,
    tone: "green",
    memberIds: ["demo-user-2"],
  },
  {
    id: "festival",
    name: "과학제 부스 운영",
    type: "group",
    preview: "부스 배치 최종본 올렸습니다.",
    time: "어제",
    unread: 0,
    members: 12,
    muted: true,
    tone: "violet",
    memberIds: [],
  },
  {
    id: "junho",
    name: "이준호",
    type: "direct",
    preview: "내일 점심시간 괜찮아?",
    time: "금",
    unread: 0,
    online: false,
    members: 2,
    tone: "amber",
    memberIds: [],
  },
  {
    id: "math",
    name: "37기 수학 질문방",
    type: "group",
    preview: "새로운 사진을 보냈습니다.",
    time: "목",
    unread: 0,
    members: 21,
    tone: "slate",
    memberIds: [],
  },
];

const initialMessages: Record<string, ChatMessage[]> = {
  physics: [
    {
      id: "m1",
      sender: "최서윤",
      studentId: "331108",
      body: "오늘 저녁 9시에 기출 풀이 맞춰볼까요?",
      time: "오후 2:03",
    },
    {
      id: "m2",
      sender: "나",
      studentId: "331201",
      body: "좋아요. 2024년 1차 1~5번까지 먼저 풀어갈게요.",
      time: "오후 2:07",
      mine: true,
      read: true,
    },
    {
      id: "m3",
      sender: "박민서",
      studentId: "331203",
      body: "저는 4번 풀이가 두 가지로 나왔는데, 비교해 보고 싶어요.",
      time: "오후 2:12",
    },
    {
      id: "m4",
      sender: "박민서",
      studentId: "331203",
      body: "제가 정리한 풀이도 먼저 올려둘게요.",
      time: "오후 2:13",
      file: { name: "KPhO_2024_4번_풀이.pdf", size: "1.8 MB" },
    },
    {
      id: "m5",
      sender: "나",
      studentId: "331201",
      body: "확인했어요. 운동량 보존을 적용하는 구간부터 같이 보면 될 것 같아요.",
      time: "오후 2:18",
      mine: true,
      read: true,
    },
    {
      id: "m6",
      sender: "박민서",
      studentId: "331203",
      body: "저녁에 4번 풀이 같이 볼 사람?",
      time: "오후 2:21",
    },
  ],
  minseo: [
    {
      id: "mm1",
      sender: "박민서",
      studentId: "331203",
      body: "아까 말한 생명과학 자료 혹시 보내줄 수 있어?",
      time: "오후 1:44",
    },
    {
      id: "mm2",
      sender: "나",
      studentId: "331201",
      body: "응, 자료공유 게시판에 올리고 링크 보냈어.",
      time: "오후 2:17",
      mine: true,
      read: true,
    },
    {
      id: "mm3",
      sender: "박민서",
      studentId: "331203",
      body: "자료 확인했어! 고마워 🙌",
      time: "오후 2:21",
    },
  ],
};

const people = [
  { id: "331108", name: "최서윤", classInfo: "1학년 1반", selected: true },
  { id: "331203", name: "박민서", classInfo: "1학년 2반", selected: true },
  { id: "331302", name: "김도윤", classInfo: "1학년 3반", selected: false },
  { id: "321111", name: "윤지호", classInfo: "1학년 1반", selected: false },
];

export default function MessagesPage() {
  const { bSideEnabled } = usePlatformMode();
  const { session, loading: sessionLoading } = usePortalSession();
  const [rooms, setRooms] = useState<Room[]>(DEMO_MODE ? initialRooms : []);
  const [selectedId, setSelectedId] = useState(DEMO_MODE ? "physics" : "");
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(
    DEMO_MODE ? initialMessages : {},
  );
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "auth" | "error"
  >(DEMO_MODE ? "ready" : "loading");
  const [loadError, setLoadError] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [messageHasMore, setMessageHasMore] = useState<Record<string, boolean>>(
    {},
  );
  const [messageCursor, setMessageCursor] = useState<Record<string, string | null>>(
    {},
  );
  const [newMessagesBelow, setNewMessagesBelow] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [messageQuery, setMessageQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [messageFile, setMessageFile] = useState<File | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState<string[]>(
    DEMO_MODE ? ["331108", "331203"] : [],
  );
  const [participantDraft, setParticipantDraft] = useState("");
  const [roomName, setRoomName] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [createError, setCreateError] = useState("");
  const [mobileView, setMobileView] = useState<"rooms" | "chat" | "details">(
    "rooms",
  );
  const [toast, setToast] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentStudentCode, setCurrentStudentCode] = useState("");
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "polling">(
    DEMO_MODE ? "live" : "connecting",
  );
  const [typingByRoom, setTypingByRoom] = useState<Record<string, string[]>>(
    {},
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const pendingScrollReasonRef = useRef<"initial" | "send" | "incoming" | null>(
    "initial",
  );
  const renderedMessagesRef = useRef({ roomId: selectedId, count: 0 });
  const olderScrollRestoreRef = useRef<{
    roomId: string;
    previousHeight: number;
    previousTop: number;
  } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const socketHealthyRef = useRef(false);
  const selectedIdRef = useRef(selectedId);
  const roomsRef = useRef(rooms);
  // Ids that were already on screen after the initial load — only messages
  // appended later (socket, send, polling) play the entrance animation.
  const initialMessageIdsRef = useRef<Set<string>>(
    new Set(
      DEMO_MODE
        ? Object.values(initialMessages)
            .flat()
            .map((message) => message.id)
        : [],
    ),
  );
  const enteredParticipantCodes = useMemo(
    () => participantCodes(participantDraft),
    [participantDraft],
  );
  const invalidParticipantCodes = useMemo(
    () => enteredParticipantCodes.filter((code) =>
      bSideEnabled ? !/^#[A-F0-9]{8}$/i.test(code) : !isValidStudentCode(code),
    ),
    [bSideEnabled, enteredParticipantCodes],
  );
  const createMemberCount = DEMO_MODE
    ? selectedPeople.length
    : enteredParticipantCodes.length;
  const createIsGroup = createMemberCount > 1;
  const canCreateRoom =
    createMemberCount > 0 &&
    createMemberCount <= 9 &&
    invalidParticipantCodes.length === 0 &&
    (bSideEnabled || !currentStudentCode ||
      !enteredParticipantCodes.includes(currentStudentCode)) &&
    (!createIsGroup || roomName.trim().length >= 2);

  useEffect(() => {
    if (DEMO_MODE) return;
    const cached = readChatCache();
    if (!cached?.rooms.length) return;
    Object.values(cached.messages || {}).forEach((list) =>
      list.forEach((message) => initialMessageIdsRef.current.add(message.id)),
    );
    setRooms(cached.rooms);
    setMessages(cached.messages || {});
    setSelectedId(cached.selectedId || cached.rooms[0]?.id || "");
    setCurrentUserId(cached.currentUserId);
    setCurrentStudentCode(cached.currentStudentCode || "");
    pendingScrollReasonRef.current = "initial";
    setLoadState("ready");
  }, []);

  useEffect(() => {
    if (DEMO_MODE || loadState !== "ready" || !rooms.length) return undefined;
    const timer = window.setTimeout(() => {
      const recentRooms = rooms.slice(0, 5);
      const recentMessages = Object.fromEntries(
        recentRooms.map((cachedRoom) => [cachedRoom.id, (messages[cachedRoom.id] || []).slice(-100)]),
      );
      writeChatCache({
        savedAt: Date.now(),
        rooms,
        messages: recentMessages,
        selectedId,
        currentUserId,
        currentStudentCode,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentStudentCode, currentUserId, loadState, messages, rooms, selectedId]);

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    const viewport = messagesViewportRef.current;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    nearBottomRef.current = true;
    setNewMessagesBelow(false);
  }

  async function markRoomRead(roomId: string, messageId: string, sequence?: string) {
    if (!roomId || !messageId || messageId.startsWith("local-")) return;
    try {
      const response = await fetchWithTimeout(
        `/api/chat/rooms/${encodeURIComponent(roomId)}/read`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, messageId, sequence }),
        },
      );
      if (!response.ok) return;
      setRooms((current) =>
        current.map((item) =>
          item.id === roomId ? { ...item, unread: 0 } : item,
        ),
      );
      socketRef.current?.emit("chat:read", { roomId, messageId, sequence });
    } catch {
      // The next focus, room selection, or polling pass retries the receipt.
    }
  }

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        !socketHealthyRef.current
      )
        setReloadKey((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 45_000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    if (sessionLoading) return undefined;
    if (!session?.authenticated || !session.user) {
      setLoadState("auth");
      return undefined;
    }
    const authenticatedUser = session.user;
    let active = true;
    const controller = new AbortController();
    async function loadRooms() {
      setLoadState((current) => (current === "ready" ? "ready" : "loading"));
      setLoadError("");
      try {
        const roomsResponse = await fetchWithTimeout("/api/chat/rooms", {
          cache: "default",
          signal: controller.signal,
        });
        const roomsPayload = await readApiEnvelope<{ rooms: ServerRoom[] }>(
          roomsResponse,
        );
        if (!active) return;
        if (roomsResponse.status === 401) {
          setLoadState("auth");
          return;
        }
        if (!roomsResponse.ok || !roomsPayload?.ok)
          throw new Error(
            apiErrorMessage(roomsPayload, "대화방을 불러오지 못했습니다."),
          );
        const userId = authenticatedUser.id;
        const loadedRooms: Room[] = roomsPayload.data.rooms.map(
          (serverRoom, index) => {
            const otherMembers = serverRoom.members.filter(
              (member) => member.user.id !== userId,
            );
            const latest = serverRoom.messages[0];
            return {
              id: serverRoom.id,
              name:
                serverRoom.title ||
                otherMembers
                  .map((member) => member.user.realName || member.user.nickname)
                  .join(", ") ||
                "1:1 대화",
              type: serverRoom.type === "DIRECT" ? "direct" : "group",
              preview: latest
                ? `${latest.sender.realName || latest.sender.nickname}: ${latest.content}`
                : "메시지 없음",
              time: latest
                ? new Intl.DateTimeFormat("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                  }).format(new Date(latest.createdAt))
                : "",
              unread: Number(serverRoom.unreadCount || 0),
              members: serverRoom.members.length,
              tone: (["blue", "green", "violet", "amber", "slate"] as const)[
                index % 5
              ],
              memberIds: serverRoom.members.map((member) => member.user.id),
            };
          },
        );
        setCurrentUserId(userId);
        setCurrentStudentCode(authenticatedUser.studentCode ?? "");
        setRooms(loadedRooms);
        setMessages((current) => {
          const next = { ...current };
          for (const serverRoom of roomsPayload.data.rooms) {
            const otherMembers = serverRoom.members.filter(
              (member) => member.user.id !== userId,
            );
            if (!otherMembers.length) continue;
            next[serverRoom.id] = (next[serverRoom.id] ?? []).map((message) => {
              if (!message.mine) return message;
              const readByEveryone = otherMembers.every((member) =>
                message.sequence && member.lastReadSequence
                  ? sequenceAtMost(message.sequence, member.lastReadSequence)
                  : Boolean(
                      message.createdAt &&
                      member.lastReadMessage &&
                      new Date(message.createdAt).getTime() <=
                        new Date(member.lastReadMessage.createdAt).getTime(),
                    ),
              );
              return readByEveryone ? { ...message, read: true } : message;
            });
          }
          return next;
        });
        const requestedRoomId = new URLSearchParams(window.location.search).get(
          "roomId",
        );
        setSelectedId((current) =>
          requestedRoomId &&
          loadedRooms.some((room) => room.id === requestedRoomId)
            ? requestedRoomId
            : current && loadedRooms.some((room) => room.id === current)
              ? current
              : (loadedRooms[0]?.id ?? ""),
        );
        pendingScrollReasonRef.current = "initial";
        nearBottomRef.current = true;
        setLoadState("ready");
      } catch (cause) {
        if (!active || isAbortError(cause)) return;
        setLoadError(
          requestErrorMessage(cause, "대화방을 불러오지 못했습니다."),
        );
        setLoadState("error");
      }
    }
    void loadRooms();
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey, session, sessionLoading]);

  useEffect(() => {
    if (DEMO_MODE || !selectedId || loadState !== "ready") return undefined;
    let active = true;
    const controller = new AbortController();
    async function loadMessages() {
      setMessagesLoading(true);
      setMessagesError("");
      try {
        const response = await fetchWithTimeout(
          `/api/messages?roomId=${encodeURIComponent(selectedId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await readApiEnvelope<{
          messages: ServerMessage[];
          hasMore: boolean;
          nextCursor?: string | null;
        }>(response);
        if (!active) return;
        if (response.status === 401) {
          setLoadState("auth");
          return;
        }
        if (!response.ok || !payload?.ok)
          throw new Error(
            apiErrorMessage(payload, "메시지를 불러오지 못했습니다."),
          );
        const loaded = payload.data.messages.map((message) =>
          mapServerMessage(message, currentUserId),
        );
        loaded.forEach((message) => initialMessageIdsRef.current.add(message.id));
        pendingScrollReasonRef.current = "initial";
        nearBottomRef.current = true;
        setMessages((current) => ({ ...current, [selectedId]: loaded }));
        setMessageHasMore((current) => ({
          ...current,
          [selectedId]: payload.data.hasMore,
        }));
        setMessageCursor((current) => ({
          ...current,
          [selectedId]: payload.data.nextCursor ?? null,
        }));
        const latest = payload.data.messages[payload.data.messages.length - 1];
        if (latest) {
          void markRoomRead(selectedId, latest.id, latest.sequence);
        }
      } catch (cause) {
        if (active && !isAbortError(cause))
          setMessagesError(
            requestErrorMessage(cause, "메시지를 불러오지 못했습니다."),
          );
      } finally {
        if (active) setMessagesLoading(false);
      }
    }
    void loadMessages();
    return () => {
      active = false;
      controller.abort();
    };
  }, [currentUserId, loadState, reloadKey, selectedId]);

  useEffect(() => {
    if (DEMO_MODE || !currentUserId || loadState !== "ready")
      return undefined;
    if (!REALTIME_URL) {
      socketHealthyRef.current = false;
      setConnectionState("polling");
      return undefined;
    }
    setConnectionState("connecting");
    const socket = io(REALTIME_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      socketHealthyRef.current = true;
      setConnectionState("live");
      roomsRef.current.forEach((room) => socket.emit("room:join", room.id));
      // Catch up once after every (re)connect, then rely on realtime delivery.
      setReloadKey((value) => value + 1);
    });
    socket.on("connect_error", () => {
      socketHealthyRef.current = false;
      setConnectionState("polling");
    });
    socket.on("disconnect", () => {
      const wasHealthy = socketHealthyRef.current;
      socketHealthyRef.current = false;
      setConnectionState("polling");
      if (wasHealthy) setReloadKey((value) => value + 1);
    });

    socket.on("chat:message", (payload: unknown) => {
      const message = messageFromContract(payload);
      if (!message) return;
      const roomId = message.roomId;
      if (!roomId || !message.id || !message.sender) return;
      const mapped = mapServerMessage(message, currentUserId);
      const isCurrentIncoming =
        selectedIdRef.current === roomId && message.sender.id !== currentUserId;
      if (isCurrentIncoming) {
        if (nearBottomRef.current) pendingScrollReasonRef.current = "incoming";
        else setNewMessagesBelow(true);
      }
      setMessages((current) => {
        const existing = current[roomId] ?? [];
        if (existing.some((item) => item.id === mapped.id)) return current;
        return { ...current, [roomId]: [...existing, mapped] };
      });
      setRooms((current) =>
        current.map((item) =>
          item.id === roomId
            ? {
                ...item,
                preview: `${mapped.sender}: ${mapped.body}`,
                time: "방금",
                unread: selectedIdRef.current === roomId ? 0 : item.unread + 1,
              }
            : item,
        ),
      );
      if (isCurrentIncoming) {
        void markRoomRead(roomId, message.id, message.sequence);
      }
    });
    socket.on("room:created", () => setReloadKey((value) => value + 1));
    socket.on(
      "chat:typing",
      (payload: { roomId?: string; nickname?: string; active?: boolean }) => {
        if (!payload.roomId || !payload.nickname) return;
        setTypingByRoom((current) => {
          const names = current[payload.roomId!] ?? [];
          const next = payload.active
            ? Array.from(new Set([...names, payload.nickname!]))
            : names.filter((name) => name !== payload.nickname);
          return { ...current, [payload.roomId!]: next };
        });
      },
    );
    socket.on(
      "chat:read",
      (payload: { roomId?: string; messageId?: string; sequence?: string; userId?: string }) => {
        if (!payload.roomId || payload.userId === currentUserId) return;
        setMessages((current) => {
          const list = current[payload.roomId!] ?? [];
          const targetIndex = payload.messageId
            ? list.findIndex((message) => message.id === payload.messageId)
            : -1;
          const receiptSequence =
            payload.sequence ||
            (targetIndex >= 0 ? list[targetIndex]?.sequence : undefined);
          return {
            ...current,
            [payload.roomId!]: list.map((message, index) =>
              message.mine &&
              (receiptSequence
                ? sequenceAtMost(message.sequence, receiptSequence)
                : targetIndex >= 0 && index <= targetIndex)
                ? { ...message, read: true }
                : message,
            ),
          };
        });
      },
    );
    socket.on(
      "presence:update",
      (payload: { userId?: string; status?: "online" | "offline" }) => {
        if (!payload.userId) return;
        setRooms((current) =>
          current.map((room) =>
            room.type === "direct" && room.memberIds.includes(payload.userId!)
              ? { ...room, online: payload.status === "online" }
              : room,
          ),
        );
      },
    );
    return () => {
      socketRef.current = null;
      socketHealthyRef.current = false;
      socket.disconnect();
    };
  }, [currentUserId, loadState]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    rooms.forEach((room) => socket.emit("room:join", room.id));
  }, [rooms]);

  const room = rooms.find((item) => item.id === selectedId) ??
    rooms[0] ?? {
      id: "",
      name: "대화 없음",
      type: "group" as const,
      preview: "",
      time: "",
      unread: 0,
      members: 0,
      tone: "slate" as const,
      memberIds: [],
    };
  const roomMessages = messages[selectedId] ?? [];
  const visibleMessages = messageQuery.trim()
    ? roomMessages.filter((message) =>
        message.body.toLowerCase().includes(messageQuery.toLowerCase()),
      )
    : roomMessages;
  const filteredRooms = useMemo(
    () =>
      rooms.filter((item) =>
        `${item.name} ${item.preview}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [rooms, query],
  );

  useLayoutEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!selectedId || !viewport) return;

    const restore = olderScrollRestoreRef.current;
    if (restore?.roomId === selectedId) {
      viewport.scrollTop =
        restore.previousTop + (viewport.scrollHeight - restore.previousHeight);
      olderScrollRestoreRef.current = null;
      loadingOlderRef.current = false;
      renderedMessagesRef.current = {
        roomId: selectedId,
        count: roomMessages.length,
      };
      return;
    }
    if (messagesLoading || loadingOlderRef.current) return;

    const previous = renderedMessagesRef.current;
    const roomChanged = previous.roomId !== selectedId;
    const messageAdded = !roomChanged && roomMessages.length > previous.count;
    const reason = pendingScrollReasonRef.current;
    renderedMessagesRef.current = {
      roomId: selectedId,
      count: roomMessages.length,
    };

    if (reason === "initial" || reason === "send" || reason === "incoming") {
      pendingScrollReasonRef.current = null;
      scrollToLatest(reason === "initial" ? "auto" : "smooth");
      return;
    }
    if (roomChanged) {
      scrollToLatest("auto");
      return;
    }
    if (messageAdded) {
      if (nearBottomRef.current) scrollToLatest("smooth");
      else setNewMessagesBelow(true);
    }
  }, [messagesLoading, roomMessages.length, selectedId]);

  useEffect(() => {
    const content = messagesContentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (nearBottomRef.current && !loadingOlderRef.current)
        scrollToLatest("auto");
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [selectedId]);

  useEffect(() => {
    function acknowledgeVisibleRoom() {
      if (document.visibilityState !== "visible") return;
      const list = messages[selectedIdRef.current] ?? [];
      const latest = list[list.length - 1];
      if (latest) void markRoomRead(selectedIdRef.current, latest.id, latest.sequence);
    }
    window.addEventListener("focus", acknowledgeVisibleRoom);
    document.addEventListener("visibilitychange", acknowledgeVisibleRoom);
    return () => {
      window.removeEventListener("focus", acknowledgeVisibleRoom);
      document.removeEventListener("visibilitychange", acknowledgeVisibleRoom);
    };
  }, [messages]);

  async function loadOlderMessages() {
    const first = roomMessages[0];
    const cursor =
      messageCursor[selectedId] ||
      (first?.sequence
        ? `seq:${first.sequence}`
        : first?.createdAt
          ? `${first.createdAt}|${first.id}`
          : null);
    if (
      !selectedId ||
      !cursor ||
      olderMessagesLoading ||
      !messageHasMore[selectedId]
    )
      return;
    const viewport = messagesViewportRef.current;
    loadingOlderRef.current = true;
    setOlderMessagesLoading(true);
    setMessagesError("");
    try {
      const response = await fetchWithTimeout(
        `/api/messages?roomId=${encodeURIComponent(selectedId)}&before=${encodeURIComponent(cursor)}`,
        { cache: "no-store" },
      );
      const payload = await readApiEnvelope<{
        messages: ServerMessage[];
        hasMore: boolean;
        nextCursor?: string | null;
      }>(response);
      if (!response.ok || !payload?.ok)
        throw new Error(
          apiErrorMessage(payload, "이전 메시지를 불러오지 못했습니다."),
        );
      const older = payload.data.messages.map((message) =>
        mapServerMessage(message, currentUserId),
      );
      const existingIds = new Set(roomMessages.map((message) => message.id));
      const uniqueOlder = older.filter((message) => !existingIds.has(message.id));
      uniqueOlder.forEach((message) => initialMessageIdsRef.current.add(message.id));
      if (viewport && uniqueOlder.length) {
        olderScrollRestoreRef.current = {
          roomId: selectedId,
          previousHeight: viewport.scrollHeight,
          previousTop: viewport.scrollTop,
        };
      }
      setMessages((current) => {
        const existing = current[selectedId] ?? [];
        return {
          ...current,
          [selectedId]: [...uniqueOlder, ...existing],
        };
      });
      setMessageHasMore((current) => ({
        ...current,
        [selectedId]: payload.data.hasMore,
      }));
      setMessageCursor((current) => ({
        ...current,
        [selectedId]: payload.data.nextCursor ?? null,
      }));
      if (!viewport || uniqueOlder.length === 0) {
        olderScrollRestoreRef.current = null;
        loadingOlderRef.current = false;
      }
    } catch (cause) {
      setMessagesError(requestErrorMessage(cause, "이전 메시지를 불러오지 못했습니다."));
      loadingOlderRef.current = false;
    } finally {
      setOlderMessagesLoading(false);
    }
  }

  function selectRoom(id: string) {
    pendingScrollReasonRef.current = "initial";
    renderedMessagesRef.current = { roomId: id, count: 0 };
    setSelectedId(id);
    setRooms((current) =>
      current.map((item) => (item.id === id ? { ...item, unread: 0 } : item)),
    );
    setMobileView("chat");
    setMessageQuery("");
    setNewMessagesBelow(false);
    nearBottomRef.current = true;
    const selectedMessages = messages[id] ?? [];
    const latest = selectedMessages[selectedMessages.length - 1];
    if (latest) void markRoomRead(id, latest.id, latest.sequence);
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const body =
      draft.trim() || (messageFile ? `파일: ${messageFile.name}` : "");
    if ((!body && !messageFile) || !selectedId || sendingMessage) return;
    if (messageFile && messageFile.size > 20 * 1024 * 1024) {
      setToast("파일은 20MB 이하만 보낼 수 있습니다.");
      return;
    }
    setSendingMessage(true);
    let uploadedAttachmentId: string | null = null;
    try {
      if (messageFile) {
        const form = new FormData();
        form.append("file", messageFile);
        const uploadResponse = await fetchWithTimeout("/api/uploads", {
          method: "POST",
          body: form,
        }, 30_000);
        const uploadPayload = await readApiEnvelope<{
          attachment: { id: string };
        }>(uploadResponse);
        if (!uploadResponse.ok || !uploadPayload?.ok) {
          throw new Error(
            apiErrorMessage(uploadPayload, "파일을 올리지 못했습니다."),
          );
        }
        uploadedAttachmentId = uploadPayload.data.attachment.id;
      }
      const clientId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimisticCreatedAt = new Date().toISOString();
      const next: ChatMessage = {
        id: `local-${Date.now()}`,
        sender: "나",
        studentId: currentStudentCode,
        body,
        time: new Intl.DateTimeFormat("ko-KR", {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date()),
        createdAt: optimisticCreatedAt,
        mine: true,
        read: false,
        file: messageFile
          ? {
              name: messageFile.name,
              size: `${Math.max(0.1, messageFile.size / 1_048_576).toFixed(1)} MB`,
            }
          : undefined,
      };
      pendingScrollReasonRef.current = "send";
      nearBottomRef.current = true;
      setMessages((current) => ({
        ...current,
        [selectedId]: [...(current[selectedId] ?? []), next],
      }));
      setRooms((current) =>
        current.map((item) =>
          item.id === selectedId
            ? { ...item, preview: `나: ${body}`, time: "방금" }
            : item,
        ),
      );
      setDraft("");
      if (composerRef.current) composerRef.current.style.height = "auto";
      setMessageFile(null);
      try {
        const socket = socketRef.current;
        let persisted: ServerMessage;
        if (socket?.connected && !uploadedAttachmentId) {
          try {
            persisted = await deliverRealtime(
              socket,
              selectedId,
              body,
              clientId,
            );
          } catch {
            persisted = await persistMessage(selectedId, body, clientId);
          }
        } else {
          persisted = await persistMessage(
            selectedId,
            body,
            clientId,
            uploadedAttachmentId ? [uploadedAttachmentId] : [],
          );
        }
        const mappedPersisted = mapServerMessage(persisted, currentUserId);
        initialMessageIdsRef.current.add(persisted.id);
        setMessages((current) => {
          const list = current[selectedId] ?? [];
          const serverAlreadyPresent = list.some(
            (message) => message.id === persisted.id,
          );
          return {
            ...current,
            [selectedId]: serverAlreadyPresent
              ? list.filter((message) => message.id !== next.id)
              : list.map((message) =>
                  message.id === next.id
                    ? { ...mappedPersisted, read: false }
                    : message,
                ),
          };
        });
      } catch (cause) {
        const detail =
          cause instanceof Error ? cause.message : "서버와 연결할 수 없습니다.";
        setMessages((current) => ({
          ...current,
          [selectedId]: (current[selectedId] ?? []).map((message) =>
            message.id === next.id ? { ...message, failed: true } : message,
          ),
        }));
        if (uploadedAttachmentId) {
          void fetchWithTimeout(
            `/api/uploads/${encodeURIComponent(uploadedAttachmentId)}`,
            {
              method: "DELETE",
              headers: { "content-type": "application/json" },
            },
          ).catch(() => undefined);
        }
        setToast(`메시지를 전송하지 못했습니다. ${detail}`);
      }
    } catch (cause) {
      if (uploadedAttachmentId) {
        void fetchWithTimeout(`/api/uploads/${encodeURIComponent(uploadedAttachmentId)}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
        }).catch(() => undefined);
      }
      setToast(
        cause instanceof Error ? cause.message : "메시지를 보내지 못했습니다.",
      );
    } finally {
      setSendingMessage(false);
    }
  }

  async function createRoom() {
    const memberIds = DEMO_MODE ? selectedPeople : enteredParticipantCodes;
    setCreateError("");
    if (memberIds.length === 0) {
      setCreateError(bSideEnabled ? "대화할 사용자의 익명 해시를 입력해 주세요." : "대화할 학생의 학번을 입력해 주세요.");
      return;
    }
    if (memberIds.length > 9) {
      setCreateError("한 번에 최대 9명까지 초대할 수 있습니다.");
      return;
    }
    if (invalidParticipantCodes.length) {
      setCreateError(bSideEnabled ? "#으로 시작하는 8자리 익명 해시를 입력해 주세요." : STUDENT_CODE_REQUIREMENTS);
      return;
    }
    if (currentStudentCode && memberIds.includes(currentStudentCode)) {
      setCreateError("본인 학번은 참여자에서 빼 주세요.");
      return;
    }
    if (memberIds.length > 1 && roomName.trim().length < 2) {
      setCreateError("그룹 대화방 이름을 2자 이상 입력해 주세요.");
      return;
    }
    if (DEMO_MODE) {
      const id = `demo-room-${Date.now()}`;
      const directPerson = people.find((person) => person.id === memberIds[0]);
      const next: Room = {
        id,
        name: roomName.trim() || directPerson?.name || "1:1 대화",
        type: memberIds.length > 1 ? "group" : "direct",
        preview: "새 대화방이 만들어졌습니다.",
        time: "방금",
        unread: 0,
        members: memberIds.length + 1,
        tone: "green",
        memberIds,
      };
      setRooms((current) => [next, ...current]);
      setMessages((current) => ({ ...current, [id]: [] }));
      setSelectedId(id);
      setCreateOpen(false);
      setMobileView("chat");
      return;
    }
    setCreatingRoom(true);
    try {
      const response = await fetchWithTimeout("/api/chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: roomName.trim(), memberIds }),
      });
      const payload = await readApiEnvelope<{
        room: {
          id: string;
          type: "DIRECT" | "GROUP";
          title: string | null;
          members: Array<{ user: ServerAuthor }>;
        };
        existing: boolean;
      }>(response);
      if (response.status === 401) {
        setCreateOpen(false);
        setLoadState("auth");
        return;
      }
      if (!response.ok || !payload?.ok)
        throw new Error(
          apiErrorMessage(payload, "대화방을 만들지 못했습니다."),
        );
      const serverRoom = payload.data.room;
      const otherMembers = serverRoom.members.filter(
        (member) => member.user.id !== currentUserId,
      );
      const next: Room = {
        id: serverRoom.id,
        name:
          serverRoom.title ||
          otherMembers
            .map((member) => member.user.realName || member.user.nickname)
            .join(", ") ||
          "1:1 대화",
        type: serverRoom.type === "DIRECT" ? "direct" : "group",
        preview: "메시지 없음",
        time: "",
        unread: 0,
        members: serverRoom.members.length,
        tone: "green",
        memberIds: serverRoom.members.map((member) => member.user.id),
      };
      setRooms((current) =>
        current.some((item) => item.id === next.id)
          ? current
          : [next, ...current],
      );
      setMessages((current) => ({
        ...current,
        [next.id]: current[next.id] ?? [],
      }));
      setSelectedId(next.id);
      setRoomName("");
      setParticipantDraft("");
      setCreateOpen(false);
      setMobileView("chat");
      setToast(
        payload.data.existing
          ? "기존 1:1 대화방을 열었습니다."
          : "새 대화방을 만들었습니다.",
      );
    } catch (cause) {
      setCreateError(
        requestErrorMessage(cause, "대화방을 만들지 못했습니다."),
      );
    } finally {
      setCreatingRoom(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  if (loadState !== "ready") {
    return (
      <div className="app-page mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <PageHeading title="메시지" />
        {loadState === "loading" ? (
          <Card className="mt-4 p-4 sm:p-5" aria-busy="true">
            <div className="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="skeleton h-10 w-full rounded-full" />
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="skeleton h-3.5 w-2/3" />
                      <div className="skeleton h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden space-y-3 md:block">
                <div className="skeleton h-10 w-52 rounded-full" />
                <div className="skeleton h-14 w-3/4 rounded-2xl" />
                <div className="skeleton ml-auto h-14 w-2/3 rounded-2xl" />
                <div className="skeleton h-14 w-3/5 rounded-2xl" />
              </div>
            </div>
            <p className="sr-only">대화방을 불러오는 중입니다.</p>
          </Card>
        ) : null}
        {loadState === "auth" || loadState === "error" ? (
          <Card className="anim-rise mt-4 p-10 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
              <MessageSquare className="h-6 w-6" />
            </span>
            {loadState === "auth" ? (
            <>
              <p className="mt-4 text-sm font-bold">
                메시지를 보려면 로그인해야 합니다.
              </p>
              <Link
                href="/login"
                className="mt-5 inline-flex h-10 items-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-[var(--shadow-xs)] transition-colors duration-150 hover:bg-emerald-800 hover:shadow-[var(--shadow-sm)]"
              >
                로그인하기
              </Link>
            </>
          ) : null}
          {loadState === "error" ? (
            <>
              <p className="mt-4 text-sm font-bold">
                대화방을 표시할 수 없습니다.
              </p>
              <p className="mt-2 text-xs text-red-600">{loadError}</p>
              <Button
                className="mt-5"
                onClick={() => setReloadKey((value) => value + 1)}
              >
                다시 시도
              </Button>
            </>
            ) : null}
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <div className="-mx-3 w-[calc(100%+24px)] max-w-[1320px] pb-0 sm:mx-auto sm:w-full sm:px-6 sm:py-5 lg:px-8">
      <div className="hidden sm:block">
        <PageHeading
          title="메시지"
          actions={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />새 대화
            </Button>
          }
        />
      </div>

      <Card className="h-[calc(100dvh-130px-env(safe-area-inset-bottom))] min-h-0 overflow-hidden max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 sm:mt-4 sm:h-[min(780px,calc(100vh-180px))] sm:min-h-[620px] sm:shadow-[var(--shadow-md)]">
        <div
          className={cn(
            "h-full min-h-0 md:grid md:grid-cols-[290px_minmax(0,1fr)]",
            showDetails && "xl:grid-cols-[290px_minmax(0,1fr)_270px]",
          )}
        >
          <aside
            className={cn(
              "h-full flex-col border-r border-slate-100 bg-white md:flex",
              mobileView === "rooms" ? "flex" : "hidden",
            )}
          >
            <div className="border-b border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-bold tracking-[-0.015em] text-slate-950">대화</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {DEMO_MODE
                      ? `읽지 않음 ${rooms.reduce((sum, item) => sum + item.unread, 0)}개`
                      : `${rooms.length}개 대화방`}
                  </p>
                </div>
                <IconButton label="새 대화" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-5 w-5" />
                </IconButton>
              </div>
              <div className="relative mt-3">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="이름 또는 대화 검색"
                  className="h-10 rounded-full pl-10"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filteredRooms.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectRoom(item.id)}
                  className={cn(
                    "flex w-full gap-3 rounded-2xl px-3 py-3 text-left transition-colors duration-150 hover:bg-slate-100/80",
                    selectedId === item.id && "bg-emerald-50 hover:bg-emerald-50",
                  )}
                >
                  <Avatar
                    name={item.name}
                    tone={item.tone}
                    status={
                      item.type === "direct" && typeof item.online === "boolean"
                        ? item.online
                          ? "online"
                          : "offline"
                        : undefined
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <strong className="truncate text-sm font-semibold text-slate-900">
                          {item.name}
                        </strong>
                        {item.pinned ? (
                          <Pin className="h-3 w-3 shrink-0 text-emerald-700" />
                        ) : null}
                        {item.muted ? (
                          <BellOff className="h-3 w-3 shrink-0 text-slate-400" />
                        ) : null}
                      </span>
                      <time className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">
                        {item.time}
                      </time>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {item.preview}
                      </span>
                      {item.unread > 0 ? (
                        <span
                          key={item.unread}
                          className="anim-pop grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold leading-none text-white shadow-[var(--shadow-xs)]"
                        >
                          {item.unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              ))}
              {filteredRooms.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
                    <MessageSquare className="h-6 w-6" />
                  </span>
                  <p className="mt-4 text-sm font-bold text-slate-600">
                    {query
                      ? "검색 결과가 없습니다."
                      : "아직 대화방이 없습니다."}
                  </p>
                  {!query ? (
                    <button
                      type="button"
                      onClick={() => setCreateOpen(true)}
                      className="mt-3 text-xs font-bold text-emerald-700 transition-colors hover:text-emerald-800"
                    >
                      첫 대화 시작하기
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>

          <section
            className={cn(
              "relative h-full min-h-0 min-w-0 flex-col bg-[var(--surface-muted)] md:flex",
              mobileView === "chat" ? "flex" : "hidden",
            )}
          >
            <header className="flex h-[61px] shrink-0 items-center justify-between gap-4 border-b border-slate-100 bg-white/95 px-3 backdrop-blur-sm sm:px-4">
              <div className="flex min-w-0 items-center gap-3">
                <IconButton
                  label="대화 목록"
                  className="md:hidden"
                  onClick={() => setMobileView("rooms")}
                >
                  <ChevronLeft className="h-5 w-5" />
                </IconButton>
                <Avatar
                  name={room.name}
                  size="sm"
                  tone={room.tone}
                  status={
                    room.id &&
                    room.type === "direct" &&
                    typeof room.online === "boolean"
                      ? room.online
                        ? "online"
                        : "offline"
                      : undefined
                  }
                />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-slate-950">
                    {room.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {!room.id
                      ? "왼쪽에서 대화를 선택하세요."
                      : room.type === "group"
                        ? `${room.members}명 참여`
                        : room.online === true
                          ? "현재 접속 중"
                          : room.online === false
                            ? "오프라인"
                            : "접속 상태 확인 중"}
                  </p>
                </div>
              </div>
              <div className="flex items-center">
                <span
                  className={cn(
                    "mr-2 hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold sm:inline-flex",
                    connectionState === "live"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700",
                  )}
                  role="status"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      connectionState === "live" ? "bg-emerald-500" : "bg-amber-500",
                    )}
                  />
                  {connectionState === "live" ? "실시간" : connectionState === "connecting" ? "연결 중" : "재연결 중"}
                </span>
                <IconButton
                  label="대화 내용 검색"
                  onClick={() => setShowMessageSearch((value) => !value)}
                >
                  <Search className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label="대화 정보"
                  onClick={() => {
                    setShowDetails((value) => !value);
                    setMobileView("details");
                  }}
                >
                  <Info className="h-4 w-4" />
                </IconButton>
                {DEMO_MODE ? (
                  <IconButton label="데모 더 보기">
                    <MoreHorizontal className="h-5 w-5" />
                  </IconButton>
                ) : null}
              </div>
            </header>
            {showMessageSearch ? (
              <div className="anim-fade flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-2">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  autoFocus
                  value={messageQuery}
                  onChange={(event) => setMessageQuery(event.target.value)}
                  placeholder="현재 대화에서 검색"
                  className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
                <span className="text-xs tabular-nums text-slate-400">
                  {visibleMessages.length}건
                </span>
                <IconButton
                  label="검색 닫기"
                  onClick={() => {
                    setShowMessageSearch(false);
                    setMessageQuery("");
                  }}
                >
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
            ) : null}
            <div
              ref={messagesViewportRef}
              data-testid="messages-viewport"
              onScroll={(event) => {
                const viewport = event.currentTarget;
                const remaining =
                  viewport.scrollHeight -
                  viewport.scrollTop -
                  viewport.clientHeight;
                nearBottomRef.current = remaining < 120;
                if (nearBottomRef.current) setNewMessagesBelow(false);
                if (
                  viewport.scrollTop < 80 &&
                  messageHasMore[selectedId] &&
                  !loadingOlderRef.current
                )
                  void loadOlderMessages();
              }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
            >
              <div ref={messagesContentRef} className="min-h-full">
              {messageHasMore[selectedId] ? (
                <div className="mb-5 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadOlderMessages()}
                    disabled={olderMessagesLoading}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 shadow-[var(--shadow-xs)] transition-colors duration-150 hover:border-emerald-300 hover:text-emerald-700 hover:shadow-[var(--shadow-sm)] disabled:opacity-60"
                  >
                    {olderMessagesLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {olderMessagesLoading
                      ? "이전 대화를 불러오는 중"
                      : "이전 대화 더 보기"}
                  </button>
                </div>
              ) : room.id && roomMessages.length ? (
                <div className="mx-auto mb-5 w-fit rounded-full bg-slate-200/60 px-3.5 py-1.5 text-[11px] font-bold text-slate-500">
                  대화의 시작
                </div>
              ) : null}
              {messagesLoading ? (
                <div className="space-y-4 py-2" aria-busy="true">
                  <p className="sr-only">메시지를 불러오는 중입니다.</p>
                  <div className="skeleton h-12 w-3/5 rounded-2xl" />
                  <div className="skeleton ml-auto h-12 w-1/2 rounded-2xl" />
                  <div className="skeleton h-12 w-2/3 rounded-2xl" />
                  <div className="skeleton ml-auto h-12 w-2/5 rounded-2xl" />
                </div>
              ) : null}
              {messagesError ? (
                <div className="anim-rise rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs font-bold text-red-700">
                  {messagesError}
                </div>
              ) : null}
              <div className="space-y-3">
                {visibleMessages.map((message, index) => {
                  const previous = visibleMessages[index - 1];
                  const grouped =
                    previous?.sender === message.sender &&
                    previous.mine === message.mine;
                  const animateIn = !initialMessageIdsRef.current.has(message.id);
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        "flex gap-2.5",
                        message.mine && "justify-end",
                        animateIn && "anim-rise",
                      )}
                    >
                      {!message.mine && !grouped ? (
                        message.senderId ? <Link href={`/users/${message.senderId}`} aria-label={`${message.sender} 프로필`}><Avatar name={message.sender} imageUrl={message.profileImage} size="sm" tone={message.sender === "박민서" ? "green" : "violet"} /></Link> : <Avatar name={message.sender} imageUrl={message.profileImage} size="sm" tone={message.sender === "박민서" ? "green" : "violet"} />
                      ) : !message.mine ? (
                        <span className="w-8 shrink-0" />
                      ) : null}
                      <div
                        className={cn(
                          "max-w-[78%]",
                          message.mine && "items-end",
                        )}
                      >
                        {!message.mine && !grouped ? (
                          <p className="mb-1.5 flex flex-wrap items-center gap-1 text-xs font-bold text-slate-700">
                            {message.senderId ? <Link href={`/users/${message.senderId}`} className="hover:text-emerald-700">{message.sender}</Link> : message.sender}{" "}
                            {message.studentId && message.studentId !== '------' ? (
                              <span className="ml-1 font-normal tabular-nums text-slate-400">
                                {message.studentId}
                              </span>
                            ) : null}
                            {message.standing ? <><Badge tone="green">{message.standing.tierLabel}</Badge>{message.standing.rankLabel ? <Badge tone="blue">{message.standing.rankLabel}</Badge> : null}</> : null}
                          </p>
                        ) : null}
                        <div className="flex items-end gap-2">
                          <div
                            className={cn(
                              "border px-3.5 py-2.5 text-sm leading-6 shadow-[var(--shadow-xs)] transition-shadow duration-200",
                              message.mine
                                ? "order-2 rounded-2xl rounded-br-md"
                                : "rounded-2xl rounded-bl-md",
                              message.failed
                                ? "border-red-200 bg-red-50 text-red-800"
                                : message.mine
                                  ? "border-emerald-700 bg-emerald-700 text-white"
                                  : "border-slate-200/80 bg-white text-slate-800",
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">
                              {message.body}
                            </p>
                            {message.failed ? (
                              <p className="mt-1 text-xs font-bold text-red-600">
                                전송 실패
                              </p>
                            ) : null}
                            {message.file ? (
                              <a
                                href={message.file.id ? `/preview/${encodeURIComponent(message.file.id)}?${new URLSearchParams({
                                  name: message.file.name,
                                  type: message.file.mimeType || "application/octet-stream",
                                }).toString()}` : undefined}
                                target={message.file.id ? "_blank" : undefined}
                                rel={message.file.id ? "noreferrer" : undefined}
                                className={cn(
                                  "mt-3 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-200",
                                  message.mine && !message.failed
                                    ? "border-white/25 bg-white/10 hover:bg-white/15"
                                    : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                                )}
                              >
                                <span className={cn(
                                  "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                                  message.mine && !message.failed
                                    ? "bg-white/15 text-white"
                                    : "bg-blue-100 text-blue-700",
                                )}>
                                  <FileText className="h-4 w-4" />
                                </span>
                                <span className="min-w-0">
                                  <strong className="block truncate text-xs">
                                    {message.file.name}
                                  </strong>
                                  <span className={cn(
                                    "mt-0.5 block text-xs",
                                    message.mine && !message.failed ? "text-white/70" : "text-slate-400",
                                  )}>
                                    {message.file.size}
                                  </span>
                                </span>
                                {message.file.id ? <span className="ml-auto text-xs font-bold">열기</span> : null}
                              </a>
                            ) : null}
                          </div>
                          <span
                            className={cn(
                              "mb-0.5 flex shrink-0 flex-col items-end text-[11px] tabular-nums text-slate-400",
                              message.mine && "order-1",
                            )}
                          >
                            {message.mine ? (
                              message.read ? (
                                <CheckCheck
                                  className="mb-0.5 h-3 w-3 text-emerald-600"
                                  aria-label="읽음"
                                />
                              ) : (
                                <Check
                                  className="mb-0.5 h-3 w-3 text-slate-400"
                                  aria-label="전송됨"
                                />
                              )
                            ) : null}
                            {message.time}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {(typingByRoom[room.id] ?? []).length > 0 && !messageQuery ? (
                <div className="anim-fade mt-4 flex items-center gap-2 pl-11 text-xs font-medium text-slate-400">
                  <span className="flex gap-1">
                    <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                    <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
                    <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
                  </span>
                  {typingByRoom[room.id].join(", ")}님이 입력 중
                </div>
              ) : null}
              <div ref={messagesEndRef} className="h-1" aria-hidden="true" />
              </div>
            </div>
            {newMessagesBelow ? (
              <button
                type="button"
                onClick={() => scrollToLatest("smooth")}
                className="anim-pop absolute bottom-[84px] left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-emerald-800 bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-[var(--shadow-md)] transition-colors duration-150 hover:bg-emerald-800"
              >
                <ArrowDown className="h-3.5 w-3.5" />새 메시지
              </button>
            ) : null}
            <form
              onSubmit={sendMessage}
              className="shrink-0 border-t border-slate-100 bg-white px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-3"
            >
              {messageFile ? (
                <div className="anim-rise mb-2 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-800">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {messageFile.name}
                  </span>
                  <span className="tabular-nums">
                    {Math.max(0.1, messageFile.size / 1_048_576).toFixed(1)} MB
                  </span>
                  <button
                    type="button"
                    onClick={() => setMessageFile(null)}
                    aria-label="첨부 파일 제거"
                    className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-blue-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
              <div className="flex items-end gap-1.5 rounded-full border border-slate-200 bg-slate-50/80 p-1 transition-colors duration-150 focus-within:border-emerald-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-600/10">
                <div className="flex">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      event.target.value = "";
                      if (file && file.size > 20 * 1024 * 1024) {
                        setToast("파일은 20MB 이하만 보낼 수 있습니다.");
                        return;
                      }
                      setMessageFile(file);
                    }}
                  />
                  <IconButton
                    type="button"
                    label="파일 첨부"
                    disabled={!room.id || sendingMessage}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="h-4 w-4" />
                  </IconButton>
                  {DEMO_MODE ? (
                    <IconButton type="button" label="데모 이모지">
                      <Smile className="h-4 w-4" />
                    </IconButton>
                  ) : null}
                </div>
                <textarea
                  ref={composerRef}
                  value={draft}
                  maxLength={4000}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    event.currentTarget.style.height = "auto";
                    event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`;
                    if (room.id)
                      socketRef.current?.emit("chat:typing", {
                        roomId: room.id,
                        active: Boolean(event.target.value.trim()),
                      });
                  }}
                  onBlur={() => {
                    if (room.id)
                      socketRef.current?.emit("chat:typing", {
                        roomId: room.id,
                        active: false,
                      });
                  }}
                  onKeyDown={handleComposerKeyDown}
                  rows={1}
                  disabled={!room.id || sendingMessage}
                  placeholder={
                    room.id ? "메시지 보내기" : "대화방을 먼저 선택하세요."
                  }
                  className="max-h-28 min-h-[38px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1.5 py-2.5 text-[15px] leading-5 outline-none disabled:text-slate-400"
                />
                <button
                  type="submit"
                  aria-label="메시지 보내기"
                  disabled={
                    !room.id ||
                    sendingMessage ||
                    (!draft.trim() && !messageFile)
                  }
                  className="grid h-10 w-10 shrink-0 place-items-center self-end rounded-full bg-emerald-700 text-white shadow-[var(--shadow-sm)] transition-colors duration-150 hover:bg-emerald-800 hover:shadow-[var(--shadow-md)] disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  <Send className="h-4 w-4 -translate-x-px" />
                </button>
              </div>
            </form>
          </section>

          <aside
            className={cn(
              "h-full flex-col bg-white xl:flex",
              showDetails ? "xl:flex" : "xl:hidden",
              mobileView === "details" ? "flex" : "hidden",
            )}
          >
            <div className="flex h-[61px] items-center justify-between border-b border-slate-100 px-4">
              <div className="flex items-center gap-2">
                <IconButton
                  label="대화로 돌아가기"
                  className="xl:hidden"
                  onClick={() => setMobileView("chat")}
                >
                  <ChevronLeft className="h-5 w-5" />
                </IconButton>
                <h2 className="text-sm font-semibold text-slate-950">
                  대화 정보
                </h2>
              </div>
              <IconButton
                label="정보 패널 닫기"
                onClick={() => {
                  setShowDetails(false);
                  setMobileView("chat");
                }}
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="border-b border-slate-100 px-4 py-6 text-center">
                <Avatar name={room.name} size="xl" tone={room.tone} />
                <h3 className="mt-3 text-base font-bold text-slate-950">
                  {room.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {room.type === "group"
                    ? `${room.members}명의 멤버`
                    : room.online
                      ? "현재 접속 중"
                      : "오프라인"}
                </p>
                {DEMO_MODE ? (
                  <div className="mt-5 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setRooms((current) =>
                          current.map((item) =>
                            item.id === room.id
                              ? { ...item, muted: !item.muted }
                              : item,
                          ),
                        )
                      }
                      className="flex flex-col items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
                    >
                      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-700 transition-colors duration-150 hover:bg-slate-200">
                        {room.muted ? (
                          <BellOff className="h-4 w-4" />
                        ) : (
                          <Bell className="h-4 w-4" />
                        )}
                      </span>
                      데모 알림
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setRooms((current) =>
                          current.map((item) =>
                            item.id === room.id
                              ? { ...item, pinned: !item.pinned }
                              : item,
                          ),
                        )
                      }
                      className="flex flex-col items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
                    >
                      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-700 transition-colors duration-150 hover:bg-slate-200">
                        <Pin className="h-4 w-4" />
                      </span>
                      데모 고정
                    </button>
                    <button
                      type="button"
                      className="flex flex-col items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
                    >
                      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-700 transition-colors duration-150 hover:bg-slate-200">
                        <Search className="h-4 w-4" />
                      </span>
                      검색
                    </button>
                  </div>
                ) : null}
              </div>
              {room.type === "group" ? (
                <div className="border-b border-slate-100 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-slate-900">
                      참여자 {room.members}
                    </h3>
                    {DEMO_MODE ? (
                      <IconButton label="멤버 초대">
                        <UserPlus className="h-4 w-4" />
                      </IconButton>
                    ) : null}
                  </div>
                  {DEMO_MODE ? (
                    <div className="mt-3 space-y-3">
                      {["최서윤", "박민서", "김도윤", "나"].map(
                        (name, index) => (
                          <div key={name} className="flex items-center gap-2.5">
                            <Avatar
                              name={name}
                              size="sm"
                              tone={index % 2 ? "green" : "violet"}
                            />
                            <span className="min-w-0 flex-1 text-xs font-bold text-slate-700">
                              {name}
                            </span>
                            {name === "최서윤" ? (
                              <Badge tone="blue">방장</Badge>
                            ) : null}
                          </div>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {DEMO_MODE ? (
                <div className="border-b border-slate-100 p-5">
                  <h3 className="text-xs font-semibold text-slate-900">
                    데모 공유 파일
                  </h3>
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {[ImageIcon, FileText, ImageIcon].map((Icon, index) => (
                      <button
                        key={index}
                        type="button"
                        className="grid aspect-square place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 transition-colors hover:bg-slate-100"
                      >
                        <Icon className="h-5 w-5" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {DEMO_MODE ? (
                <div className="p-3">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <Archive className="h-4 w-4" />
                    데모 대화 보관
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-bold text-red-600 transition-colors hover:bg-red-50"
                  >
                    <X className="h-4 w-4" />
                    데모 대화 나가기
                  </button>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => {
          if (!creatingRoom) {
            setCreateOpen(false);
            setCreateError("");
          }
        }}
        title="새 대화 시작"
        description="1명은 1:1 · 2명 이상은 그룹"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCreateOpen(false);
                setCreateError("");
              }}
              disabled={creatingRoom}
            >
              취소
            </Button>
            <Button
              onClick={() => void createRoom()}
              disabled={creatingRoom || !canCreateRoom}
            >
              {creatingRoom ? "만드는 중…" : "대화 시작"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <label className="block">
            <span className="mb-2 flex items-center justify-between text-sm font-bold text-slate-800">
              <span>
                대화방 이름{" "}
                {createIsGroup ? (
                  <span className="text-blue-700">*</span>
                ) : null}
              </span>
              <span className="text-xs font-normal text-slate-400">
                {createIsGroup ? "그룹은 필수" : "1:1은 선택"}
              </span>
            </span>
            <Input
              value={roomName}
              onChange={(event) => {
                setRoomName(event.target.value);
                setCreateError("");
              }}
              maxLength={120}
              placeholder={
                createIsGroup
                  ? "예: 2026 과학제 준비방"
                  : "비워두면 상대방 이름으로 표시됩니다"
              }
            />
          </label>
          {DEMO_MODE ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-800">
                  데모 참여자 선택
                </span>
                <span className="text-xs text-blue-700">
                  {selectedPeople.length}명 선택
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                {people.map((person) => (
                  <label
                    key={person.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-3 transition-colors last:border-b-0 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-700"
                      checked={selectedPeople.includes(person.id)}
                      onChange={() => {
                        setCreateError("");
                        setSelectedPeople((current) =>
                          current.includes(person.id)
                            ? current.filter((id) => id !== person.id)
                            : [...current, person.id],
                        );
                      }}
                    />
                    <Avatar name={person.name} size="sm" tone="green" />
                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm text-slate-800">
                        {person.name}
                      </strong>
                      <span className="text-xs text-slate-400">
                        {person.id} · {person.classInfo}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <label className="block">
              <span className="mb-2 flex items-center justify-between text-sm font-bold text-slate-800">
                <span>
                  {bSideEnabled ? '참여자 익명 해시' : '참여자 학번'} <span className="text-blue-700">*</span>
                </span>
                <span className="text-xs font-normal text-blue-700">
                  {enteredParticipantCodes.length}/9명
                </span>
              </span>
              <Input
                inputMode={bSideEnabled ? "text" : "numeric"}
                value={participantDraft}
                onChange={(event) => {
                  setParticipantDraft(bSideEnabled ? event.target.value.toUpperCase() : event.target.value);
                  setCreateError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canCreateRoom) {
                    event.preventDefault();
                    void createRoom();
                  }
                }}
                aria-invalid={Boolean(
                  createError || invalidParticipantCodes.length,
                )}
                placeholder={bSideEnabled ? "예: #A1B2C3D4, #91F0E2A7" : "예: 331108, 331203"}
              />
              <span className="mt-2 block text-xs leading-5 text-slate-500">{bSideEnabled ? '화면에 표시된 해시 · 쉼표/공백 구분 · 본인 제외' : '31~33기 학번 · 쉼표/공백 구분 · 본인 제외'}</span>
            </label>
          )}
          {createError ? (
            <p
              role="alert"
              className="anim-rise rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
            >
              {createError}
            </p>
          ) : invalidParticipantCodes.length ? (
            <p role="alert" className="text-xs font-bold text-red-600">
              {bSideEnabled ? '#으로 시작하는 8자리 익명 해시를 확인하세요.' : STUDENT_CODE_REQUIREMENTS}
            </p>
          ) : null}
        </div>
      </Modal>
      <Toast
        message={toast}
        tone={toast?.includes("못") ? "error" : "success"}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
