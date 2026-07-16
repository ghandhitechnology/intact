"use client";

import { FormEvent, useEffect, useState } from "react";
import { Send } from "lucide-react";

export default function SupportPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
      (type === "USER" ||
        type === "POST" ||
        type === "COMMENT" ||
        type === "MESSAGE")
    ) {
      setReportTarget({ type, id });
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        reportTarget ? "/api/reports" : "/api/support",
        {
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
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok)
        throw new Error(body?.error?.message || "문의를 접수하지 못했습니다.");
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "문의를 접수하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="border-b-2 border-slate-800 bg-white px-1 pb-4 pt-2">
        <h1 className="text-2xl font-bold tracking-[-0.03em] text-slate-950">
          {reportTarget ? "콘텐츠 신고" : "문의·신고"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
          {reportTarget ? "신고 내용은 운영자만 확인합니다." : "불편한 점이나 제안을 남기면 운영자가 확인합니다."}
        </p>
      </header>
      {sent ? (
        <div className="border-l-4 border-[var(--green)] bg-white px-5 py-8">
          <h2 className="text-lg font-bold">
            {reportTarget ? "신고를 접수했습니다" : "문의를 접수했습니다"}
          </h2>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">운영자가 확인한 뒤 필요한 조치를 진행하겠습니다.</p>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="space-y-5 bg-white px-1 py-6"
        >
          <label className="block">
            <span className="mb-2 block text-xs font-bold">
              {reportTarget ? "신고 사유" : "문의 유형"}
            </span>
            <select
              name="category"
              required
              className="h-11 w-full border border-[var(--line-strong)] bg-white px-3 text-sm outline-none"
            >
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
            </select>
          </label>
          {!reportTarget && (
            <>
              <label className="block">
                <span className="mb-2 block text-xs font-bold">제목</span>
                <input
                  name="subject"
                  required
                  minLength={2}
                  maxLength={180}
                  className="h-11 w-full border border-[var(--line-strong)] px-3 text-sm outline-none focus:border-[var(--blue)]"
                  placeholder="문의 내용을 한 줄로 적어 주세요"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold">
                  관련 링크{" "}
                  <small className="font-medium text-[var(--ink-faint)]">
                    (선택)
                  </small>
                </span>
                <input
                  name="pageUrl"
                  type="url"
                  className="h-11 w-full border border-[var(--line-strong)] px-3 text-sm outline-none focus:border-[var(--blue)]"
                  placeholder="https://..."
                />
              </label>
            </>
          )}
          <label className="block">
            <span className="mb-2 block text-xs font-bold">자세한 내용</span>
            <textarea
              name="description"
              required
              minLength={10}
              maxLength={reportTarget ? 1000 : 2000}
              rows={8}
              className="w-full resize-y border border-[var(--line-strong)] p-3 text-sm leading-6 outline-none focus:border-[var(--blue)]"
              placeholder="확인이 필요한 상황을 구체적으로 적어 주세요."
            />
          </label>
          {error && (
            <p
              role="alert"
              className="border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-700"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              className="primary-button"
              type="submit"
              disabled={submitting}
            >
              <Send size={15} />
              {submitting ? "보내는 중…" : "운영자에게 보내기"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
