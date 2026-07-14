"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";

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
    <div className="mx-auto max-w-3xl">
      <header className="border-b-2 border-[var(--ink)] bg-white px-6 py-8">
        <p className="section-kicker">{reportTarget ? "REPORT" : "SUPPORT"}</p>
        <h1 className="mt-3 text-2xl font-black">
          {reportTarget ? "콘텐츠 신고" : "문의·신고"}
        </h1>
        {reportTarget ? <p className="mt-2 text-sm text-[var(--ink-soft)]">운영자만 확인</p> : null}
      </header>
      {sent ? (
        <div className="surface-card border-t-0 px-6 py-14 text-center">
          <CheckCircle2 className="mx-auto text-[var(--green)]" size={38} />
          <h2 className="mt-4 text-lg font-black">
            {reportTarget ? "신고를 접수했습니다" : "문의를 접수했습니다"}
          </h2>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="surface-card space-y-5 border-t-0 px-6 py-8"
        >
          <label className="block">
            <span className="mb-2 block text-xs font-black">
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
                <span className="mb-2 block text-xs font-black">제목</span>
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
                <span className="mb-2 block text-xs font-black">
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
            <span className="mb-2 block text-xs font-black">자세한 내용</span>
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
              className="border-l-2 border-red-600 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
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
