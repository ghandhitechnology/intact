"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare, Plus, Send } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/operations/ui";

type TicketSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  category: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  subject: string;
  description: string;
  resolution: string | null;
  resolvedAt: string | null;
  _count: { messages: number };
  messages: Array<{ id: string; createdAt: string; body: string }>;
};

type TicketDetail = Omit<TicketSummary, "messages" | "_count"> & {
  requesterId: string;
  assignedTo: { id: string; nickname: string } | null;
  messages: Array<{
    id: string;
    createdAt: string;
    body: string;
    authorId: string | null;
    author: { id: string; nickname: string; role: string } | null;
  }>;
  statusEvents: Array<{
    id: string;
    createdAt: string;
    fromStatus: TicketSummary["status"] | null;
    toStatus: TicketSummary["status"];
    note?: string | null;
  }>;
};

const statusLabel: Record<TicketSummary["status"], string> = {
  OPEN: "접수",
  IN_PROGRESS: "처리 중",
  RESOLVED: "답변 완료",
  CLOSED: "종료",
};

const categoryLabel: Record<string, string> = {
  CONTENT: "콘텐츠",
  ACCOUNT: "계정·개인정보",
  BUG: "오류",
  FEATURE: "기능 제안",
  OTHER: "기타",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function apiData<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error?.message || fallback);
  return body.data as T;
}

function statusTone(status: TicketSummary["status"]): "blue" | "amber" | "green" | "slate" {
  if (status === "OPEN") return "blue";
  if (status === "IN_PROGRESS") return "amber";
  if (status === "RESOLVED") return "green";
  return "slate";
}

export default function SupportPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [replying, setReplying] = useState(false);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    type: "USER" | "POST" | "COMMENT" | "MESSAGE";
    id: string;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("targetType");
    const id = params.get("targetId");
    if (
      id &&
      (type === "USER" || type === "POST" || type === "COMMENT" || type === "MESSAGE")
    ) {
      setReportTarget({ type, id });
      setLoading(false);
      return;
    }
    const ticketId = params.get("ticket");
    async function initialLoad() {
      setLoading(true);
      setLoadError("");
      try {
        const listResponse = await fetch("/api/support?pageSize=50", { cache: "no-store" });
        const listData = await apiData<{ tickets: TicketSummary[] }>(listResponse, "문의 내역을 불러오지 못했습니다.");
        setTickets(listData.tickets);
        if (ticketId) {
          const detailResponse = await fetch(`/api/support/${encodeURIComponent(ticketId)}`, { cache: "no-store" });
          const detailData = await apiData<{ ticket: TicketDetail }>(detailResponse, "문의 내용을 불러오지 못했습니다.");
          setSelected(detailData.ticket);
        }
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : "문의 내역을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }
    void initialLoad();
  }, []);

  async function loadTickets(ticketId?: string | null) {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/support?pageSize=50", { cache: "no-store" });
      const data = await apiData<{ tickets: TicketSummary[] }>(response, "문의 내역을 불러오지 못했습니다.");
      setTickets(data.tickets);
      if (ticketId) await openTicket(ticketId, false);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "문의 내역을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function openTicket(id: string, updateUrl = true) {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/support/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await apiData<{ ticket: TicketDetail }>(response, "문의 내용을 불러오지 못했습니다.");
      setSelected(data.ticket);
      if (updateUrl) window.history.replaceState(null, "", `/support?ticket=${encodeURIComponent(id)}`);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "문의 내용을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function startNewTicket() {
    setSelected(null);
    setSent(false);
    setError("");
    window.history.replaceState(null, "", "/support");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(reportTarget ? "/api/reports" : "/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          reportTarget
            ? {
                targetType: reportTarget.type,
                targetId: reportTarget.id,
                reasonCode: payload.category,
                detail: payload.description,
              }
            : {
                category: payload.category,
                subject: payload.subject,
                description: payload.description,
                pageUrl: payload.pageUrl,
              },
        ),
      });
      const data = await apiData<{ ticket?: TicketSummary }>(response, "문의를 접수하지 못했습니다.");
      setSent(true);
      form.reset();
      if (!reportTarget && data.ticket) {
        await loadTickets();
        await openTicket(data.ticket.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "문의를 접수하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") || "");
    setReplying(true);
    setError("");
    try {
      const response = await fetch(`/api/support/${encodeURIComponent(selected.id)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, clientMessageId: crypto.randomUUID() }),
      });
      await apiData(response, "답글을 등록하지 못했습니다.");
      form.reset();
      await openTicket(selected.id, false);
      await loadTickets();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "답글을 등록하지 못했습니다.");
    } finally {
      setReplying(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="space-y-5">
      <Field label={reportTarget ? "신고 사유" : "문의 유형"} required>
        <Select name="category" required>
          <option value="">선택해 주세요</option>
          {reportTarget ? (
            <>
              <option value="HARASSMENT">비방·욕설·괴롭힘</option>
              <option value="PERSONAL_INFO">개인정보 노출</option>
              <option value="SPAM">도배·광고·스팸</option>
              <option value="COPYRIGHT">저작권 침해</option>
              <option value="OTHER">기타 운영규칙 위반</option>
            </>
          ) : (
            <>
              <option value="CONTENT">부적절한 게시글·댓글</option>
              <option value="ACCOUNT">계정·개인정보</option>
              <option value="BUG">오류 신고</option>
              <option value="FEATURE">기능 제안</option>
              <option value="OTHER">기타 문의</option>
            </>
          )}
        </Select>
      </Field>
      {!reportTarget ? (
        <>
          <Field label="제목" required>
            <Input name="subject" required minLength={2} maxLength={180} placeholder="문의 내용을 한 줄로 적어 주세요" />
          </Field>
          <Field label="관련 링크" hint="(선택)">
            <Input name="pageUrl" type="url" placeholder="https://..." />
          </Field>
        </>
      ) : null}
      <Field label="자세한 내용" required>
        <Textarea name="description" required minLength={10} maxLength={reportTarget ? 1000 : 10000} rows={8} placeholder="확인이 필요한 상황을 구체적으로 적어 주세요." />
      </Field>
      {error ? <p role="alert" className="anim-rise rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {submitting ? "보내는 중…" : "운영자에게 보내기"}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <header className="anim-rise flex flex-col gap-3 px-1 pb-5 pt-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-slate-950">{reportTarget ? "콘텐츠 신고" : "문의·신고"}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {reportTarget ? "신고 내용은 운영자만 확인합니다." : "불편한 점이나 제안을 남기고 처리 내역을 이어서 확인할 수 있습니다."}
          </p>
        </div>
        {!reportTarget && selected ? (
          <Button type="button" variant="secondary" className="shrink-0" onClick={startNewTicket}><Plus size={15} />새 문의</Button>
        ) : null}
      </header>

      {sent ? (
        <div className="anim-rise mt-1 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3.5">
          <p className="text-sm font-semibold text-emerald-800">{reportTarget ? "신고를 접수했습니다." : "문의를 접수했습니다."}</p>
        </div>
      ) : null}

      {reportTarget ? (
        <Card className="anim-rise anim-delay-1 mt-4 p-5 sm:p-7">{form}</Card>
      ) : (
        <div className="anim-rise anim-delay-1 mt-4 grid items-start gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <CardHeader title="내 문의 내역" description="최근 업데이트 순" />
            {loading && tickets.length === 0 ? (
              <div className="grid gap-2.5 p-4">
                <div className="skeleton h-16 w-full" />
                <div className="skeleton h-16 w-full" />
                <div className="skeleton h-16 w-full" />
                <span className="sr-only">문의 내역을 불러오는 중</span>
              </div>
            ) : null}
            {!loading && tickets.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><MessageSquare size={20} /></span>
                <p className="mt-3 text-xs text-slate-500">아직 접수한 문의가 없습니다.</p>
              </div>
            ) : null}
            <div className="grid gap-2 p-2.5">
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => void openTicket(ticket.id)}
                  className={`block w-full rounded-xl border px-3.5 py-3 text-left transition-all duration-200 ${
                    selected?.id === ticket.id
                      ? "border-emerald-200 bg-emerald-50/70 shadow-[var(--shadow-xs)]"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50/80"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={statusTone(ticket.status)}>{statusLabel[ticket.status]}</Badge>
                    <span className="text-[11px] text-slate-400">{formatDate(ticket.updatedAt)}</span>
                  </div>
                  <p className="mt-2 truncate text-sm font-bold text-slate-900">{ticket.subject}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{ticket.messages[0]?.body || ticket.description}</p>
                  <p className="mt-1.5 text-[11px] text-slate-400">답글 {ticket._count.messages}개</p>
                </button>
              ))}
            </div>
          </Card>

          <div className="min-w-0">
            {loadError ? <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{loadError}</p> : null}
            {!selected ? (
              <Card className="p-5 sm:p-7">{form}</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
                  <button type="button" className="mb-3 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 md:hidden" onClick={() => setSelected(null)}><ArrowLeft size={14} />목록</button>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={statusTone(selected.status)}>{statusLabel[selected.status]}</Badge>
                    <Badge tone="slate">{categoryLabel[selected.category] || selected.category}</Badge>
                  </div>
                  <h2 className="mt-2.5 text-lg font-bold tracking-[-0.02em] text-slate-950">{selected.subject}</h2>
                  <p className="mt-1.5 text-xs text-slate-400">접수 {formatDate(selected.createdAt)} · 담당 {selected.assignedTo?.nickname || "배정 전"}</p>
                </div>

                <div className="space-y-3.5 bg-slate-50/50 px-5 py-5 sm:px-6">
                  {selected.messages.map((message) => {
                    const requester = message.authorId === selected.requesterId;
                    return (
                      <article
                        key={message.id}
                        className={`max-w-[88%] rounded-2xl border px-4 py-3 shadow-[var(--shadow-xs)] ${
                          requester
                            ? "mr-auto rounded-tl-md border-slate-200/90 bg-white"
                            : "ml-auto rounded-tr-md border-emerald-200 bg-emerald-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 text-[11px]">
                          <span className="font-bold text-slate-700">{requester ? "나" : message.author?.nickname || "운영자"}</span>
                          <span className="text-slate-400">{formatDate(message.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-800">{message.body}</p>
                      </article>
                    );
                  })}
                </div>

                {selected.statusEvents.length ? (
                  <div className="border-t border-slate-100 px-5 py-4 sm:px-6">
                    <p className="text-xs font-bold text-slate-700"><MessageSquare className="mr-1 inline" size={13} />처리 기록</p>
                    <ul className="mt-2 space-y-1.5">
                      {selected.statusEvents.map((event) => (
                        <li key={event.id} className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                          {formatDate(event.createdAt)} · {statusLabel[event.toStatus]}{event.note ? ` · ${event.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {selected.status !== "CLOSED" ? (
                  <form onSubmit={submitReply} className="border-t border-slate-100 px-5 py-4 sm:px-6">
                    <Field label="답글" required>
                      <Textarea name="body" required minLength={2} maxLength={10000} rows={4} placeholder="추가로 전달할 내용을 적어 주세요." />
                    </Field>
                    {error ? <p role="alert" className="anim-rise mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p> : null}
                    <div className="mt-3 flex justify-end">
                      <Button type="submit" disabled={replying}>{replying ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{replying ? "등록 중…" : "답글 등록"}</Button>
                    </div>
                  </form>
                ) : (
                  <p className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 text-xs leading-5 text-slate-500 sm:px-6">종료된 문의입니다. 추가 도움이 필요하면 새 문의를 접수해 주세요.</p>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
