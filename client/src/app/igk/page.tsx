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
  Check,
  Coins,
  FileText,
  Loader2,
  LogIn,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { igkLevelLabel } from "@/lib/igk-levels";
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
  teacherRank?: number | null;
  rank: number;
  progress: number;
  nextLevel: {
    level: number;
    minimumLifetimeIgk: number;
    label: string | null;
  } | null;
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
  teacherRank?: number | null;
  currentIgk: number;
  lifetimeIgk: number;
  studentIdentity: { studentCode: string } | null;
};

const demoWallet: Wallet = {
  currentIgk: 2480,
  lifetimeIgk: 2980,
  level: 6,
  rank: 18,
  progress: (2980 - 2000) / (3500 - 2000),
  nextLevel: { level: 7, minimumLifetimeIgk: 3500, label: "3등급" },
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
  TRANSFER_SENT: "IGK 선물",
  TRANSFER_RECEIVED: "IGK 선물 받음",
  REVERSAL: "보상 회수",
  ADMIN_ADJUSTMENT: "운영자 조정",
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
        ]);
        const [balancePayload, ledgerPayload, rankingPayload, profilePayload] =
          await Promise.all([
            readApiEnvelope<Wallet>(balanceResponse),
            readApiEnvelope<{ entries: LedgerEntry[] }>(ledgerResponse),
            readApiEnvelope<{ leaders: Ranking[]; currentUserRank: number }>(
              rankingResponse,
            ),
            readApiEnvelope<{
              profile: { studentIdentity: { studentCode: string } | null };
            }>(profileResponse),
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
    (bSideEnabled ? /^#[A-F0-9]{8}$/.test(recipient) : /^\d{6}$/.test(recipient)) &&
    Number.isInteger(giftAmount) &&
    giftAmount >= 1 &&
    giftAmount <= Math.min(500, balance) &&
    (!selfStudentCode || recipient !== selfStudentCode);

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

  async function confirmTransfer() {
    if (!wallet || !transferValid || (passwordRequired && !password)) return;
    setSending(true);
    try {
      if (DEMO_MODE) {
        const nextBalance = balance - giftAmount;
        setWallet({ ...wallet, currentIgk: nextBalance });
        setTransactions((current) => [
          {
            id: `demo-${Date.now()}`,
            type: "gift-out",
            title: `${recipient} 학생에게 선물`,
            description: message || "함께 성장하는 인텍트 선물",
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
            recipient,
            amount: giftAmount,
            note: message,
            password: password || undefined,
          }),
        });
        const payload = await readApiEnvelope<{
          transferId: string;
          senderBalance: number;
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
        setWallet({ ...wallet, currentIgk: payload.data.senderBalance });
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
      setAmount("");
      setMessage("");
      setPassword("");
      setPasswordRequired(false);
      setConfirmOpen(false);
      transferIntentKeyRef.current = "";
      setToastTone("success");
      setToast(`${giftAmount.toLocaleString()} IGK를 선물했습니다.`);
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
      <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
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

  const nextThreshold = wallet.nextLevel?.minimumLifetimeIgk ?? null;
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
    <div className="mx-auto w-full max-w-[1540px] px-4 py-4 sm:px-6 lg:px-8">
      <PageHeading
        title="IGK 지갑"
      />
      <section className="relative mt-4 border border-slate-200 bg-white px-4 py-4 sm:px-5">
        <div className="relative grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold text-emerald-700">
              <Coins className="h-4 w-4" />
              보유 IGK
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <strong className="text-3xl font-black text-slate-950">
                {balance.toLocaleString()}
              </strong>
              <span className="text-base font-bold text-slate-500">IGK</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              등급 누적 {wallet.lifetimeIgk.toLocaleString()} IGK · 보유 IGK 교내{" "}
              {wallet.rank}위
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
                {igkLevelLabel(wallet.level, wallet.teacherRank)}
              </span>
              {nextThreshold ? (
                <span className="font-extrabold text-slate-800">
                  {wallet.lifetimeIgk.toLocaleString()} /{" "}
                  {nextThreshold.toLocaleString()}
                </span>
              ) : null}
            </div>
            <div className="mt-3">
              <Progress value={wallet.progress * 100} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {nextThreshold
                ? `다음 등급까지 ${Math.max(0, nextThreshold - wallet.lifetimeIgk).toLocaleString()} IGK`
                : "최고 등급 선생님"}
            </p>
          </div>
        </div>
      </section>

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
                <h2 className="text-sm font-extrabold">IGK 원장</h2>
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
                      <p className="mt-1 text-[10px] text-slate-400">
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
                  <p className="mt-3 text-lg font-black">
                    {igkLevelLabel(wallet.level, wallet.teacherRank)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    누적 {wallet.lifetimeIgk.toLocaleString()} IGK
                  </p>
                </div>
                {wallet.nextLevel ? (
                  <div className="border border-slate-200 p-5">
                    <Badge tone="slate">다음</Badge>
                    <p className="mt-3 text-lg font-black">
                      {wallet.nextLevel.label ?? igkLevelLabel(wallet.nextLevel.level)}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      누적{" "}
                      {wallet.nextLevel.minimumLifetimeIgk.toLocaleString()}{" "}
                      IGK부터
                    </p>
                  </div>
                ) : null}
              </div>
              <Link
                href="/igk/roadmap"
                className="mt-4 flex h-9 items-center justify-center border border-slate-300 text-xs font-extrabold text-slate-800 hover:bg-slate-50"
              >
                전체 등급 로드맵 보기
              </Link>
            </div>
          ) : null}
          {tab === "ranking" ? (
            <div>
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                <h2 className="text-sm font-extrabold">보유 IGK 랭킹</h2>
                <p className="mt-1 text-xs text-slate-500">현재 사용할 수 있는 IGK 잔액 기준</p>
                <Badge tone="blue" className="mt-2">
                  내 순위 {wallet.rank}위
                </Badge>
              </div>
              {rankings.map((person, index) => {
                const displayName = person.realName || person.nickname;
                return (
                  <article
                    key={person.id}
                    className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"
                  >
                    <span className="grid h-8 w-8 place-items-center text-sm font-black">
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
                      className={person.level >= 10 ? "teacher-avatar" : undefined}
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
                      <p className="text-[11px] text-slate-400">
                        {person.studentIdentity?.studentCode && person.studentIdentity.studentCode !== '------'
                          ? `${person.studentIdentity.studentCode} · `
                          : ''}
                        {igkLevelLabel(person.level, person.teacherRank)}
                      </p>
                    </div>
                    <strong>{person.currentIgk.toLocaleString()} IGK</strong>
                  </article>
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
                <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-800">
                  <Coins className="h-4 w-4" />보유 {balance.toLocaleString()} IGK
                </span>
              }
            />
            <form onSubmit={prepareTransfer} className="space-y-4 p-5">
              <Field
                label={bSideEnabled ? "받는 사용자의 익명 해시" : "받는 학생의 6자리 학번"}
                required
                error={
                  recipient &&
                  (!(bSideEnabled ? /^#[A-F0-9]{8}$/.test(recipient) : /^\d{6}$/.test(recipient)) || recipient === selfStudentCode)
                    ? recipient === selfStudentCode
                      ? "본인에게는 선물할 수 없습니다."
                      : bSideEnabled ? "#으로 시작하는 8자리 익명 해시를 입력하세요." : "6자리 학번을 입력하세요."
                    : undefined
                }
              >
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    inputMode={bSideEnabled ? "text" : "numeric"}
                    maxLength={bSideEnabled ? 9 : 6}
                    value={recipient}
                    onChange={(event) =>
                      setRecipient(
                        bSideEnabled
                          ? event.target.value.toUpperCase().replace(/[^#A-F0-9]/g, "").replace(/(?!^)#/g, "")
                          : event.target.value.replace(/\D/g, ""),
                      )
                    }
                    className="pl-9"
                    placeholder={bSideEnabled ? "#A1B2C3D4" : "331101"}
                  />
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
                <p className="-mt-2 text-right text-[11px] font-bold text-slate-500">
                  선물 후 {(balance - giftAmount).toLocaleString()} IGK
                </p>
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
              <p className="flex gap-2 text-[11px] leading-5 text-slate-500">
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
            <Avatar name={recipient || "학생"} size="lg" tone="green" />
            <p className="mt-3 text-sm font-bold">{recipient} 학생에게</p>
            <p className="mt-2 text-3xl font-black text-emerald-700">
              {giftAmount.toLocaleString()} IGK
            </p>
          </div>
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
