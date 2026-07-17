"use client";

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Modal,
  PageHeading,
  Progress,
  Select,
  Tabs,
  Textarea,
  Toast,
  apiErrorMessage,
  cn,
  readApiEnvelope,
} from "@/components/operations/ui";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarCheck,
  Check,
  Coins,
  FileText,
  Flame,
  Loader2,
  LogIn,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Snowflake,
  Sparkles,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { igkLevelForBalance, igkLevelLabel, type IgkStanding } from "@/lib/igk-levels";
import { usePlatformMode } from "@/components/portal/PlatformModeProvider";

const DEMO_MODE = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true";

type IgkTab = "ledger" | "levels" | "ranking";
type LoadState = "loading" | "ready" | "auth" | "error";
type Transaction = {
  id: string;
  type: "earn" | "gift-in" | "gift-out" | "reversal";
  title: string;
  description: string;
  amount: number;
  date: string;
  balance: number;
};
type Wallet = {
  currentIgk: number;
  lifetimeIgk: number;
  igkDebt?: number;
  level: number;
  igkRank?: number | null;
  standing: IgkStanding;
  rank: number;
  progress: number;
  nextLevel: {
    level: number;
    minimumCurrentIgk: number;
    label: string | null;
  } | null;
};
type Attendance = {
  streak: number;
  bestStreak: number;
  claimedToday: boolean;
  todayReward: number;
  freezeCount: number;
};
type LedgerEntry = {
  id: string;
  createdAt: string;
  type: string;
  amount: number;
  balanceAfter: number;
  lifetimeAfter: number;
  sourceType: string | null;
  sourceId: string | null;
  note: string | null;
  counterparty: {
    id: string;
    nickname: string;
    realName: string | null;
    studentIdentity: { studentCode: string } | null;
  } | null;
};
type Ranking = {
  rank: number;
  id: string;
  nickname: string;
  realName: string | null;
  profileImage: string | null;
  level: number;
  igkRank?: number | null;
  standing?: IgkStanding;
  currentIgk: number;
  lifetimeIgk: number;
  studentIdentity: { studentCode: string } | null;
};
type RecipientSuggestion = {
  id: string;
  nickname: string;
  realName: string | null;
  profileImage: string | null;
  level: number;
  standing: IgkStanding;
  studentIdentity: { studentCode: string } | null;
};

const demoWallet: Wallet = {
  currentIgk: 2480,
  lifetimeIgk: 2980,
  level: 6,
  standing: { level: 6, tierLabel: "4등급", rank: null, rankLabel: null },
  rank: 18,
  progress: (2480 - 2000) / (3500 - 2000),
  nextLevel: { level: 7, minimumCurrentIgk: 3500, label: "3등급" },
};
const demoTransactions: Transaction[] = [
  {
    id: "demo-tx-1",
    type: "earn",
    title: "받은 추천 보상",
    description: "전자기 유도 문제",
    amount: 3,
    date: "오늘 오후 2:32",
    balance: 2480,
  },
  {
    id: "demo-tx-2",
    type: "gift-in",
    title: "박민서님에게 받은 선물",
    description: "자료 고마워!",
    amount: 50,
    date: "어제 오후 8:14",
    balance: 2475,
  },
  {
    id: "demo-tx-3",
    type: "gift-out",
    title: "최서윤님에게 선물",
    description: "친절한 답변 감사합니다.",
    amount: -100,
    date: "7월 9일",
    balance: 2415,
  },
];
const demoRankings: Ranking[] = [
  {
    rank: 1,
    id: "demo-1",
    nickname: "은하수",
    realName: "강서준",
    profileImage: null,
    level: 9,
    igkRank: 1,
    standing: { level: 9, tierLabel: "1등급", rank: 1, rankLabel: "1짱" },
    currentIgk: 7820,
    lifetimeIgk: 7820,
    studentIdentity: { studentCode: "360103" },
  },
  {
    rank: 2,
    id: "demo-2",
    nickname: "뉴턴의사과",
    realName: "윤지민",
    profileImage: null,
    level: 8,
    igkRank: 2,
    standing: { level: 8, tierLabel: "2등급", rank: 2, rankLabel: "2짱" },
    currentIgk: 6540,
    lifetimeIgk: 6540,
    studentIdentity: { studentCode: "331312" },
  },
  {
    rank: 3,
    id: "demo-3",
    nickname: "미토콘드리아",
    realName: "임도현",
    profileImage: null,
    level: 8,
    igkRank: 3,
    standing: { level: 8, tierLabel: "2등급", rank: 3, rankLabel: "3짱" },
    currentIgk: 6210,
    lifetimeIgk: 6210,
    studentIdentity: { studentCode: "380204" },
  },
];

const typeLabels: Record<string, string> = {
  POST_CREATED: "게시글 작성",
  COMMENT_CREATED: "댓글 작성",
  RECOMMENDATION_RECEIVED: "받은 추천 보상",
  ANSWER_ACCEPTED: "답변 채택 보상",
  ATTENDANCE_REWARD: "출석 보상",
  TRANSFER_SENT: "IGK 선물",
  TRANSFER_RECEIVED: "IGK 선물 받음",
  REVERSAL: "보상 회수",
  SHOP_PURCHASE: "상점 구매",
  ADMIN_ADJUSTMENT: "운영자 조정",
};

const demoAttendance: Attendance = {
  streak: 4,
  bestStreak: 12,
  claimedToday: false,
  todayReward: 8,
  freezeCount: 1,
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

function toTransaction(entry: LedgerEntry): Transaction {
  const giftIn = entry.type === "TRANSFER_RECEIVED";
  const giftOut = entry.type === "TRANSFER_SENT";
  const reversal = entry.type === "REVERSAL" || (entry.amount < 0 && !giftOut);
  const counterparty = entry.counterparty
    ? `${entry.counterparty.realName || entry.counterparty.nickname}${entry.counterparty.studentIdentity?.studentCode && entry.counterparty.studentIdentity.studentCode !== '------' ? ` (${entry.counterparty.studentIdentity.studentCode})` : ""}`
    : null;
  return {
    id: entry.id,
    type: giftIn
      ? "gift-in"
      : giftOut
        ? "gift-out"
        : reversal
          ? "reversal"
          : "earn",
    title: giftIn
      ? `${counterparty ?? "다른 학생"}님에게 받은 선물`
      : giftOut
        ? `${counterparty ?? "다른 학생"}님에게 선물`
        : (typeLabels[entry.type] ?? entry.type),
    description:
      entry.note ||
      [entry.sourceType, entry.sourceId].filter(Boolean).join(" · ") ||
      "추가 설명 없음",
    amount: entry.amount,
    date: formatDate(entry.createdAt),
    balance: entry.balanceAfter,
  };
}

export default function IgkPage() {
  const { bSideEnabled } = usePlatformMode();
  const [tab, setTab] = useState<IgkTab>("ledger");
  const [wallet, setWallet] = useState<Wallet | null>(
    DEMO_MODE ? demoWallet : null,
  );
  const [transactions, setTransactions] = useState<Transaction[]>(
    DEMO_MODE ? demoTransactions : [],
  );
  const [rankings, setRankings] = useState<Ranking[]>(
    DEMO_MODE ? demoRankings : [],
  );
  const [attendance, setAttendance] = useState<Attendance | null>(
    DEMO_MODE ? demoAttendance : null,
  );
  const [claiming, setClaiming] = useState(false);
  const [selfStudentCode, setSelfStudentCode] = useState(
    DEMO_MODE ? "331201" : "",
  );
  const [loadState, setLoadState] = useState<LoadState>(
    DEMO_MODE ? "ready" : "loading",
  );
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState("all");
  const [recipient, setRecipient] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<RecipientSuggestion | null>(null);
  const [recipientSuggestions, setRecipientSuggestions] = useState<RecipientSuggestion[]>([]);
  const [recipientSearching, setRecipientSearching] = useState(false);
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("success");
  const transferIntentKeyRef = useRef("");

  useEffect(() => {
    if (bSideEnabled || selectedRecipient || recipient.trim().length < 2) {
      setRecipientSuggestions([]);
      setRecipientSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRecipientSearching(true);
      try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(recipient.trim())}`, { cache: "no-store", signal: controller.signal });
        const payload = await readApiEnvelope<{ users: RecipientSuggestion[] }>(response);
        if (response.ok && payload?.ok) {
          setRecipientSuggestions(payload.data.users);
          setRecipientPickerOpen(true);
        } else {
          setRecipientSuggestions([]);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setRecipientSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setRecipientSearching(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [bSideEnabled, recipient, selectedRecipient]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (
      requested === "ledger" ||
      requested === "levels" ||
      requested === "ranking"
    ) {
      setTab(requested);
    }
  }, []);

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoadState("loading");
      setLoadError("");
      try {
        const [
          balanceResponse,
          ledgerResponse,
          rankingResponse,
          profileResponse,
          attendanceResponse,
        ] = await Promise.all([
          fetch("/api/igk/balance", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/igk/ledger?pageSize=100", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/igk/ranking", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/profile", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/igk/attendance", {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        const [
          balancePayload,
          ledgerPayload,
          rankingPayload,
          profilePayload,
          attendancePayload,
        ] =
          await Promise.all([
            readApiEnvelope<Wallet>(balanceResponse),
            readApiEnvelope<{ entries: LedgerEntry[] }>(ledgerResponse),
            readApiEnvelope<{ leaders: Ranking[]; currentUserRank: number }>(
              rankingResponse,
            ),
            readApiEnvelope<{
              profile: { studentIdentity: { studentCode: string } | null };
            }>(profileResponse),
            readApiEnvelope<Attendance>(attendanceResponse),
          ]);
        if (!active) return;
        if (
          [balanceResponse, ledgerResponse, rankingResponse].some(
            (response) => response.status === 401,
          )
        ) {
          setLoadState("auth");
          return;
        }
        if (!balanceResponse.ok || !balancePayload?.ok)
          throw new Error(
            apiErrorMessage(balancePayload, "IGK 잔액을 불러오지 못했습니다."),
          );
        if (!ledgerResponse.ok || !ledgerPayload?.ok)
          throw new Error(
            apiErrorMessage(ledgerPayload, "IGK 원장을 불러오지 못했습니다."),
          );
        if (!rankingResponse.ok || !rankingPayload?.ok)
          throw new Error(
            apiErrorMessage(rankingPayload, "IGK 랭킹을 불러오지 못했습니다."),
          );
        setWallet({
          ...balancePayload.data,
          rank: rankingPayload.data.currentUserRank,
        });
        setTransactions(ledgerPayload.data.entries.map(toTransaction));
        setRankings(rankingPayload.data.leaders);
        setAttendance(
          attendanceResponse.ok && attendancePayload?.ok
            ? attendancePayload.data
            : null,
        );
        if (profileResponse.ok && profilePayload?.ok)
          setSelfStudentCode(
            profilePayload.data.profile.studentIdentity?.studentCode ?? "",
          );
        setLoadState("ready");
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setLoadError(
          cause instanceof Error
            ? cause.message
            : "IGK 정보를 불러오지 못했습니다.",
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

  const balance = wallet?.currentIgk ?? 0;
  const giftAmount = Number(amount);
  const filteredTransactions = useMemo(
    () =>
      transactions.filter(
        (item) =>
          filter === "all" ||
          (filter === "earn" &&
            (item.type === "earn" || item.type === "gift-in")) ||
          (filter === "spend" &&
            (item.type === "gift-out" || item.type === "reversal")),
      ),
    [transactions, filter],
  );
  const transferValid =
    (bSideEnabled ? /^#[A-F0-9]{8}$/.test(recipient) : Boolean(selectedRecipient)) &&
    Number.isInteger(giftAmount) &&
    giftAmount >= 1 &&
    giftAmount <= Math.min(500, balance) &&
    (!selfStudentCode || selectedRecipient?.studentIdentity?.studentCode !== selfStudentCode);

  function prepareTransfer(event: FormEvent) {
    event.preventDefault();
    if (!transferValid) return;
    setPassword("");
    setPasswordRequired(giftAmount >= 100);
    transferIntentKeyRef.current =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `igk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setConfirmOpen(true);
  }

  async function claimAttendance() {
    if (!attendance || attendance.claimedToday || claiming) return;
    setClaiming(true);
    try {
      if (DEMO_MODE) {
        const nextStreak = attendance.streak + 1;
        setAttendance({
          ...attendance,
          streak: nextStreak,
          bestStreak: Math.max(attendance.bestStreak, nextStreak),
          claimedToday: true,
        });
        if (wallet) {
          setWallet({ ...wallet, currentIgk: wallet.currentIgk + attendance.todayReward });
        }
        setToastTone("success");
        setToast(`출석 완료! ${attendance.todayReward} IGK를 받았습니다.`);
        return;
      }
      const response = await fetch("/api/igk/attendance", { method: "POST" });
      const payload = await readApiEnvelope<{
        streak: number;
        bestStreak: number;
        reward: number;
        balance: number;
        freezeUsed: boolean;
        freezeCount: number;
      }>(response);
      if (response.status === 401) {
        setLoadState("auth");
        return;
      }
      if (!response.ok || !payload?.ok) {
        throw new Error(apiErrorMessage(payload, "출석 체크에 실패했습니다."));
      }
      setAttendance({
        streak: payload.data.streak,
        bestStreak: payload.data.bestStreak,
        claimedToday: true,
        todayReward: payload.data.reward,
        freezeCount: payload.data.freezeCount,
      });
      if (wallet) setWallet({ ...wallet, currentIgk: payload.data.balance });
      setTransactions((current) => [
        {
          id: `attendance-${Date.now()}`,
          type: "earn",
          title: "출석 보상",
          description: `${payload.data.streak}일 연속 출석${payload.data.freezeUsed ? " · 스트릭 프리즈 사용" : ""}`,
          amount: payload.data.reward,
          date: "방금",
          balance: payload.data.balance,
        },
        ...current,
      ]);
      setToastTone("success");
      setToast(
        `${payload.data.streak}일 연속 출석! ${payload.data.reward} IGK를 받았습니다.${payload.data.freezeUsed ? " (스트릭 프리즈 1개 사용)" : ""}`,
      );
      setReloadKey((value) => value + 1);
    } catch (cause) {
      setToastTone("error");
      setToast(cause instanceof Error ? cause.message : "출석 체크에 실패했습니다.");
    } finally {
      setClaiming(false);
    }
  }

  async function confirmTransfer() {
    if (!wallet || !transferValid || (passwordRequired && !password)) return;
    setSending(true);
    try {
      if (DEMO_MODE) {
        const nextBalance = balance - giftAmount;
        const nextTier = igkLevelForBalance(nextBalance);
        setWallet({ ...wallet, currentIgk: nextBalance, level: nextTier.level, standing: { ...wallet.standing, level: nextTier.level, tierLabel: nextTier.label } });
        setTransactions((current) => [
          {
            id: `demo-${Date.now()}`,
            type: "gift-out",
            title: `${recipient} 학생에게 선물`,
            description: message || "IGK 선물",
            amount: -giftAmount,
            date: "방금",
            balance: nextBalance,
          },
          ...current,
        ]);
      } else {
        const response = await fetch("/api/igk/transfer", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": transferIntentKeyRef.current,
          },
          body: JSON.stringify({
            recipientId: selectedRecipient?.id,
            recipient: bSideEnabled ? recipient : undefined,
            amount: giftAmount,
            note: message,
            password: password || undefined,
          }),
        });
        const payload = await readApiEnvelope<{
          transferId: string;
          senderBalance: number;
          senderStanding: IgkStanding;
          recipientNickname: string;
        }>(response);
        if (
          payload &&
          !payload.ok &&
          payload.error.code === "PASSWORD_CONFIRMATION_REQUIRED"
        ) {
          setPasswordRequired(true);
          setToastTone("error");
          setToast(payload.error.message);
          return;
        }
        if (
          response.status === 401 &&
          (!payload || (!payload.ok && payload.error.code === "AUTH_REQUIRED"))
        ) {
          setConfirmOpen(false);
          setLoadState("auth");
          return;
        }
        if (!response.ok || !payload?.ok)
          throw new Error(
            apiErrorMessage(payload, "선물을 보내지 못했습니다."),
          );
        setWallet({ ...wallet, currentIgk: payload.data.senderBalance, level: payload.data.senderStanding.level, igkRank: payload.data.senderStanding.rank, standing: payload.data.senderStanding });
        setTransactions((current) => [
          {
            id: payload.data.transferId,
            type: "gift-out",
            title: `${payload.data.recipientNickname}님에게 선물`,
            description: message || "추가 메시지 없음",
            amount: -giftAmount,
            date: "방금",
            balance: payload.data.senderBalance,
          },
          ...current,
        ]);
      }
      setRecipient("");
      setSelectedRecipient(null);
      setRecipientSuggestions([]);
      setAmount("");
      setMessage("");
      setPassword("");
      setPasswordRequired(false);
      setConfirmOpen(false);
      transferIntentKeyRef.current = "";
      setToastTone("success");
      setToast(`${giftAmount.toLocaleString()} IGK를 선물했습니다.`);
      if (!DEMO_MODE) setReloadKey((value) => value + 1);
    } catch (cause) {
      setToastTone("error");
      setToast(
        cause instanceof Error ? cause.message : "선물을 보내지 못했습니다.",
      );
    } finally {
      setSending(false);
    }
  }

  if (loadState !== "ready" || !wallet) {
    return (
      <div className="app-page mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <PageHeading
          title="IGK 지갑"
        />
        <Card className="mt-4 p-8 text-center">
          {loadState === "loading" ? (
            <>
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-700" />
              <p className="mt-4 text-sm font-bold">
                IGK 정보를 불러오는 중입니다.
              </p>
            </>
          ) : null}
          {loadState === "auth" ? (
            <>
              <LogIn className="mx-auto h-7 w-7 text-blue-700" />
              <p className="mt-4 text-sm font-bold">로그인이 필요합니다.</p>
              <Link
                href="/login"
                className="mt-5 inline-flex h-10 items-center bg-blue-700 px-4 text-sm font-bold text-white"
              >
                로그인하기
              </Link>
            </>
          ) : null}
          {loadState === "error" ? (
            <>
              <RefreshCw className="mx-auto h-7 w-7 text-red-600" />
              <p className="mt-4 text-sm font-bold">
                IGK 정보를 표시할 수 없습니다.
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
      </div>
    );
  }

  const nextThreshold = wallet.nextLevel?.minimumCurrentIgk ?? null;
  const txIcon = (type: Transaction["type"]) =>
    type === "gift-in" ? (
      <ArrowDownLeft className="h-4 w-4" />
    ) : type === "gift-out" ? (
      <ArrowUpRight className="h-4 w-4" />
    ) : type === "reversal" ? (
      <RotateCcw className="h-4 w-4" />
    ) : (
      <Sparkles className="h-4 w-4" />
    );

  return (
    <div className="app-page mx-auto w-full max-w-[1320px] px-4 py-5 sm:px-6 lg:px-8">
      <PageHeading
        title="IGK 지갑"
      />
      <section className="relative mt-5 border-t-2 border-slate-800 bg-white px-4 py-5 sm:px-5">
        <div className="relative grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold text-emerald-700">
              <Coins className="h-4 w-4" />
              보유 IGK
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <strong className="text-3xl font-bold text-slate-950">
                {balance.toLocaleString()}
              </strong>
              <span className="text-base font-bold text-slate-500">IGK</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              현재 IGK 기준 교내 {wallet.rank}위 · 평생 획득 {wallet.lifetimeIgk.toLocaleString()} IGK
            </p>
            {wallet.igkDebt ? (
              <p className="mt-2 text-xs text-amber-700">
                회수 대기 {wallet.igkDebt.toLocaleString()} IGK · 앞으로 받는
                IGK에서 먼저 정산됩니다.
              </p>
            ) : null}
          </div>
          <div className="w-full border border-slate-200 bg-slate-50 p-4 md:w-80">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600">
                <span className="inline-flex gap-1.5"><Badge tone="green">{wallet.standing.tierLabel}</Badge>{wallet.standing.rankLabel ? <Badge tone="blue">{wallet.standing.rankLabel}</Badge> : null}</span>
              </span>
              {nextThreshold ? (
                <span className="font-semibold text-slate-800">
                  {wallet.currentIgk.toLocaleString()} /{" "}
                  {nextThreshold.toLocaleString()}
                </span>
              ) : null}
            </div>
            <div className="mt-3">
              <Progress value={wallet.progress * 100} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {nextThreshold
                ? `다음 등급까지 ${Math.max(0, nextThreshold - wallet.currentIgk).toLocaleString()} IGK`
                : "최고 등급 조졸"}
            </p>
          </div>
        </div>
      </section>

      {attendance ? (
        <section className="mt-4 border-l-4 border-emerald-700 bg-white px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-bold text-emerald-800">
                <CalendarCheck className="h-4 w-4" />
                매일 출석 체크
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5 text-xl font-bold text-slate-950">
                  <Flame className="h-5 w-5 text-rose-500" />
                  {attendance.streak}일 연속
                </span>
                <span className="text-xs font-bold text-slate-500">
                  최고 {attendance.bestStreak}일
                </span>
                {attendance.freezeCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-700">
                    <Snowflake className="h-3.5 w-3.5" />
                    프리즈 {attendance.freezeCount}개
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {attendance.claimedToday
                  ? "오늘 출석을 완료했습니다. 내일 다시 만나요!"
                  : `지금 출석하면 ${attendance.todayReward} IGK를 받습니다. 연속 출석할수록 보상이 커져요.`}
              </p>
            </div>
            <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
              <Button
                variant="green"
                onClick={() => void claimAttendance()}
                disabled={attendance.claimedToday || claiming}
              >
                <CalendarCheck className="h-4 w-4" />
                {attendance.claimedToday
                  ? "출석 완료"
                  : claiming
                    ? "출석 중…"
                    : `출석하고 ${attendance.todayReward} IGK 받기`}
              </Button>
              <Link
                href="/igk/shop"
                className="inline-flex min-h-11 items-center justify-center gap-2 border border-slate-300 bg-white px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:min-h-9"
              >
                <ShoppingBag className="h-4 w-4" />
                IGK 상점
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="min-w-0 overflow-hidden ">
          <Tabs
            items={[
              {
                value: "ledger",
                label: "거래 내역",
                count: transactions.length,
              },
              { value: "levels", label: "등급 안내" },
              { value: "ranking", label: "랭킹" },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "ledger" ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-4">
                <h2 className="text-sm font-semibold">IGK 원장</h2>
                <Select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  className="h-9 w-36"
                >
                  <option value="all">전체 거래</option>
                  <option value="earn">획득</option>
                  <option value="spend">사용·회수</option>
                </Select>
              </div>
              <div>
                {filteredTransactions.map((item) => (
                  <article
                    key={item.id}
                    className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"
                  >
                    <span
                      className={cn(
                        "grid h-10 w-10 shrink-0 place-items-center",
                        item.amount > 0
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-blue-50 text-blue-700",
                      )}
                    >
                      {txIcon(item.type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-bold">
                        {item.title}
                      </h3>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {item.description}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {item.date} · 잔액 {item.balance.toLocaleString()} IGK
                      </p>
                    </div>
                    <strong
                      className={
                        item.amount > 0 ? "text-emerald-700" : "text-slate-800"
                      }
                    >
                      {item.amount > 0 ? "+" : ""}
                      {item.amount.toLocaleString()}
                    </strong>
                  </article>
                ))}
                {filteredTransactions.length === 0 ? (
                  <div className="px-5 py-16 text-center text-sm text-slate-500">
                    조건에 맞는 IGK 거래 내역이 없습니다.
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          {tab === "levels" ? (
            <div className="p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border border-emerald-300 bg-white p-5">
                  <Badge tone="green">현재</Badge>
                  <p className="mt-3 text-lg font-bold">
                    <span className="inline-flex gap-1.5"><Badge tone="green">{wallet.standing.tierLabel}</Badge>{wallet.standing.rankLabel ? <Badge tone="blue">{wallet.standing.rankLabel}</Badge> : null}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    현재 {wallet.currentIgk.toLocaleString()} IGK
                  </p>
                </div>
                {wallet.nextLevel ? (
                  <div className="border border-slate-200 p-5">
                    <Badge tone="slate">다음</Badge>
                    <p className="mt-3 text-lg font-bold">
                      {wallet.nextLevel.label ?? igkLevelLabel(wallet.nextLevel.level)}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      현재{" "}
                      {wallet.nextLevel.minimumCurrentIgk.toLocaleString()}{" "}
                      IGK부터
                    </p>
                  </div>
                ) : null}
              </div>
              <Link
                href="/igk/roadmap"
                className="mt-4 flex h-9 items-center justify-center border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                전체 등급 로드맵 보기
              </Link>
            </div>
          ) : null}
          {tab === "ranking" ? (
            <div>
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                <h2 className="text-sm font-semibold">보유 IGK 랭킹</h2>
                <p className="mt-1 text-xs text-slate-500">현재 사용할 수 있는 IGK 잔액 기준</p>
                <Badge tone="blue" className="mt-2">
                  내 순위 {wallet.rank}위
                </Badge>
              </div>
              {rankings.map((person, index) => {
                const displayName = person.realName || person.nickname;
                return (
                  <Link
                    key={person.id}
                    href={`/users/${person.id}`}
                    className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"
                  >
                    <span className="grid h-8 w-8 place-items-center text-sm font-bold">
                      {person.rank <= 3 ? (
                        <Trophy className="h-4 w-4 text-amber-600" />
                      ) : (
                        person.rank
                      )}
                    </span>
                    <Avatar
                      name={displayName}
                      imageUrl={person.profileImage}
                      size="sm"
                      className={person.level >= 10 ? "top-level-avatar" : undefined}
                      tone={
                        (
                          ["blue", "green", "violet", "amber", "slate"] as const
                        )[index % 5]
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-bold">
                        {displayName}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {person.studentIdentity?.studentCode && person.studentIdentity.studentCode !== '------'
                          ? `${person.studentIdentity.studentCode} · `
                          : ''}
                        <span className="inline-flex gap-1"><Badge tone="green">{person.standing?.tierLabel ?? igkLevelLabel(person.level)}</Badge>{person.standing?.rankLabel ? <Badge tone="blue">{person.standing.rankLabel}</Badge> : null}</span>
                      </p>
                    </div>
                    <strong>{person.currentIgk.toLocaleString()} IGK</strong>
                  </Link>
                );
              })}
              {rankings.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500">
                  아직 랭킹에 표시할 학생이 없습니다.
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        <aside className="space-y-5">
          <Card className="">
            <CardHeader
              title="IGK 선물하기"
              action={
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                  <Coins className="h-4 w-4" />보유 {balance.toLocaleString()} IGK
                </span>
              }
            />
            <form onSubmit={prepareTransfer} className="space-y-4 p-5">
              <Field
                label={bSideEnabled ? "받는 사용자의 익명 해시" : "받는 학생 이름 또는 닉네임"}
                required
                error={
                  recipient &&
                  (bSideEnabled ? !/^#[A-F0-9]{8}$/.test(recipient) : !selectedRecipient)
                    ? bSideEnabled ? "#으로 시작하는 8자리 익명 해시를 입력하세요." : "검색 결과에서 받을 학생을 선택하세요."
                    : undefined
                }
              >
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    inputMode="text"
                    maxLength={bSideEnabled ? 9 : 32}
                    value={recipient}
                    role={bSideEnabled ? undefined : "combobox"}
                    aria-autocomplete={bSideEnabled ? undefined : "list"}
                    aria-expanded={bSideEnabled ? undefined : recipientPickerOpen}
                    aria-controls={bSideEnabled ? undefined : "igk-recipient-options"}
                    onFocus={() => setRecipientPickerOpen(true)}
                    onChange={(event) => {
                      setSelectedRecipient(null);
                      setRecipient(
                        bSideEnabled
                          ? event.target.value.toUpperCase().replace(/[^#A-F0-9]/g, "").replace(/(?!^)#/g, "")
                          : event.target.value,
                      );
                    }}
                    className="pl-9"
                    placeholder={bSideEnabled ? "#A1B2C3D4" : "이름 또는 닉네임 2자 이상"}
                  />
                  {recipientSearching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : null}
                  {!bSideEnabled && recipientPickerOpen && !selectedRecipient && recipient.trim().length >= 2 ? <div id="igk-recipient-options" role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto border border-slate-300 bg-white shadow-lg">
                    {recipientSuggestions.map((person) => <button key={person.id} type="button" role="option" aria-selected="false" className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-emerald-50 focus:bg-emerald-50" onClick={() => { setSelectedRecipient(person); setRecipient(person.realName || person.nickname); setRecipientPickerOpen(false); }}>
                      <Avatar name={person.realName || person.nickname} imageUrl={person.profileImage} size="sm" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-black text-slate-900">{person.realName || person.nickname} <span className="font-semibold text-slate-500">@{person.nickname}</span></span><span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">{person.studentIdentity?.studentCode}<Badge tone="green">{person.standing.tierLabel}</Badge>{person.standing.rankLabel ? <Badge tone="blue">{person.standing.rankLabel}</Badge> : null}</span></span>
                    </button>)}
                    {!recipientSearching && recipientSuggestions.length === 0 ? <p className="p-3 text-xs text-slate-500">일치하는 학생이 없습니다.</p> : null}
                  </div> : null}
                </div>
              </Field>
              <Field label="선물할 금액" required hint="일일 한도 500">
                <Input
                  type="number"
                  min={1}
                  max={Math.min(500, balance)}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
              {giftAmount > 0 && giftAmount <= balance ? (
                <div className="-mt-2 text-right text-xs font-bold text-slate-500"><p>선물 후 {(balance - giftAmount).toLocaleString()} IGK</p>{igkLevelForBalance(balance - giftAmount).level < wallet.level ? <p className="mt-1 text-amber-700">등급 하락: {wallet.standing.tierLabel} → {igkLevelForBalance(balance - giftAmount).label}</p> : null}</div>
              ) : null}
              <Field label="메시지" hint={`${message.length}/300`}>
                <Textarea
                  rows={3}
                  maxLength={300}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="green"
                className="w-full"
                disabled={!transferValid}
              >
                <Send className="h-4 w-4" />
                선물 내용 확인
              </Button>
              <p className="flex gap-2 text-xs leading-5 text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                하루 누적 선물이 100 IGK 이상이 되면 비밀번호를 확인합니다.
              </p>
            </form>
          </Card>
          <Card className="">
            <CardHeader title="IGK 받는 방법" />
            <div className="divide-y divide-slate-100">
              {[
                [FileText, "게시글 작성", "+10"],
                [MessageCircle, "댓글 작성", "+2"],
                [ThumbsUp, "받은 추천", "+3"],
                [Check, "답변 채택", "+15"],
              ].map(([Icon, label, reward]) => {
                const ItemIcon = Icon as typeof FileText;
                return (
                  <div
                    key={String(label)}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <ItemIcon className="h-4 w-4 text-blue-700" />
                    <span className="flex-1 text-xs font-bold">
                      {String(label)}
                    </span>
                    <Badge tone="green">{String(reward)} IGK</Badge>
                  </div>
                );
              })}
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setPasswordRequired(false);
        }}
        title="IGK 선물 확인"
        description="보낸 선물은 상대방이 받는 즉시 취소할 수 없습니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              돌아가기
            </Button>
            <Button
              variant="green"
              onClick={() => void confirmTransfer()}
              disabled={sending || (passwordRequired && !password)}
            >
              {sending ? "전송 중…" : `${giftAmount.toLocaleString()} IGK 선물`}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="border border-slate-300 bg-white p-5 text-center">
            <Avatar name={selectedRecipient?.realName || selectedRecipient?.nickname || recipient || "학생"} imageUrl={selectedRecipient?.profileImage} size="lg" tone="green" />
            <p className="mt-3 text-sm font-bold">{selectedRecipient ? `${selectedRecipient.realName || selectedRecipient.nickname} (@${selectedRecipient.nickname})` : recipient} 학생에게</p>
            <p className="mt-2 text-3xl font-bold text-emerald-700">
              {giftAmount.toLocaleString()} IGK
            </p>
          </div>
          {wallet && igkLevelForBalance(balance - giftAmount).level < wallet.level ? <p className="border border-amber-300 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">선물 후 현재 IGK가 낮아져 {wallet.standing.tierLabel}에서 {igkLevelForBalance(balance - giftAmount).label}(으)로 내려갑니다. 짱 순위도 즉시 다시 계산됩니다.</p> : null}
          {passwordRequired ? (
            <Field label="본인 확인 비밀번호" required hint="누적 100 IGK 이상">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                placeholder="인텍트 비밀번호"
              />
            </Field>
          ) : null}
        </div>
      </Modal>
      <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />
    </div>
  );
}
