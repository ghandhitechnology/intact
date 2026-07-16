"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Select, Textarea } from "@/components/operations/ui";

type Submission = {
  id: string; createdAt: string; state: string; decision: string | null; explanationKo: string | null;
  candidateTitle: string; candidateContentText: string; candidateAttachmentIds: string[];
  normalizedText: string; ocrText: string | null; localSignals: unknown; lunaResult: unknown; evidence: unknown;
  categories: string[]; evasionDetected: boolean; safeContext: boolean | null; isNewPost: boolean;
  author: { nickname: string; realName: string | null; status: string };
  post: { id: string; status: string; title: string; contentText: string; board: { name: string; slug: string } };
  attempts: Array<{ id: string; layer: string; status: string; latencyMs: number | null; sanitizedError: string | null }>;
};
type Rule = { id: string; kind: string; pattern: string; severity: number; enabled: boolean; notes: string | null };

function dataOf<T>(payload: unknown): T {
  return ((payload as { data?: T })?.data ?? payload) as T;
}

function pretty(value: unknown) {
  return value ? JSON.stringify(value, null, 2) : "자료 없음";
}

export default function ModerationConsole() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState("ACTIVE");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [ruleKind, setRuleKind] = useState("TERM");
  const [rulePattern, setRulePattern] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const query = state === "ACTIVE" ? "" : `?state=${encodeURIComponent(state)}`;
    const response = await fetch(`/api/admin/moderation${query}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      window.location.href = "/admin/login";
      return;
    }
    if (!response.ok) {
      setMessage(payload?.error?.message || "이중망 운영 자료를 불러오지 못했습니다.");
    } else {
      const data = dataOf<{ submissions: Submission[]; rules: Rule[] }>(payload);
      setSubmissions(data.submissions);
      setRules(data.rules);
      setSelectedId((current) => current && data.submissions.some((item) => item.id === current) ? current : data.submissions[0]?.id ?? null);
    }
    setLoading(false);
  }, [state]);

  useEffect(() => { void load(); }, [load]);
  const selected = submissions.find((item) => item.id === selectedId) ?? null;

  async function act(action: "APPROVE" | "REJECT" | "HIDE" | "RETRY" | "SANCTION") {
    if (!selected || reason.trim().length < 2) return setMessage("처리 사유를 2자 이상 입력하세요.");
    const response = await fetch(`/api/admin/moderation/${selected.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason, sanctionType: "WARNING" }),
    });
    const payload = await response.json().catch(() => null);
    setMessage(response.ok ? `${action} 처리가 감사 로그에 기록되었습니다.` : payload?.error?.message || "처리하지 못했습니다.");
    if (response.ok) { setReason(""); await load(); }
  }

  async function createRule() {
    if (!rulePattern.trim()) return setMessage("규칙 패턴을 입력하세요.");
    const response = await fetch("/api/admin/moderation/rules", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: ruleKind, pattern: rulePattern, severity: 80, enabled: false, notes: "운영자 검토 후 추가" }),
    });
    const payload = await response.json().catch(() => null);
    setMessage(response.ok ? "비활성 규칙으로 추가했습니다. 검토 후 활성화하세요." : payload?.error?.message || "규칙을 추가하지 못했습니다.");
    if (response.ok) { setRulePattern(""); await load(); }
  }

  async function toggleRule(rule: Rule) {
    const why = window.prompt(`${rule.pattern} 규칙을 ${rule.enabled ? "비활성화" : "활성화"}하는 사유를 입력하세요.`);
    if (!why || why.trim().length < 2) return;
    const response = await fetch(`/api/admin/moderation/rules/${rule.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !rule.enabled, reason: why }),
    });
    if (response.ok) await load();
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center bg-emerald-700"><ShieldCheck className="h-5 w-5" /></span>
            <div><h1 className="font-bold">이중망 Moderation</h1><p className="text-xs font-bold tracking-[0.12em] text-slate-400">LOCAL FORENSICS + CODEX LUNA</p></div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> 새로고침</Button>
            <Link href="/admin" className="inline-flex h-9 items-center gap-2 border border-white/20 px-3 text-xs font-bold"><ArrowLeft className="h-4 w-4" /> 운영 콘솔</Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1800px] gap-4 p-4 sm:p-6 xl:grid-cols-[360px_minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="심사 큐" description="불일치와 수동 검토 건을 우선 확인합니다." action={<Select value={state} onChange={(event) => setState(event.target.value)} className="w-36"><option value="ACTIVE">진행 중</option><option value="NEEDS_REVIEW">검토 필요</option><option value="ALLOWED">허용</option><option value="BLOCKED">차단</option><option value="SUPERSEDED">교체됨</option></Select>} />
          <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
            {loading ? <p className="p-4 text-sm text-slate-500">불러오는 중…</p> : submissions.length === 0 ? <p className="p-4 text-sm text-slate-500">해당 심사 건이 없습니다.</p> : submissions.map((item) => (
              <button key={item.id} onClick={() => setSelectedId(item.id)} className={`block w-full border-b p-4 text-left ${selectedId === item.id ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-2"><Badge tone={item.state === "NEEDS_REVIEW" ? "amber" : item.state === "BLOCKED" ? "red" : item.state === "ALLOWED" ? "green" : "slate"}>{item.state}</Badge><span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString("ko-KR")}</span></div>
                <p className="mt-2 truncate text-sm font-bold">{item.candidateTitle}</p><p className="mt-1 text-xs text-slate-500">{item.author.nickname} · {item.post.board.name}</p>
              </button>
            ))}
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          {!selected ? <Card className="p-8 text-center text-sm text-slate-500">심사 건을 선택하세요.</Card> : <>
            <Card><CardHeader title={selected.candidateTitle} description={`${selected.author.realName || selected.author.nickname} · ${selected.isNewPost ? "새 게시물" : "공개본 수정"}`} action={<div className="flex gap-2"><Badge>{selected.state}</Badge>{selected.evasionDetected ? <Badge tone="red">우회 탐지</Badge> : null}</div>} />
              <div className="grid gap-0 md:grid-cols-2"><section className="border-b p-4 md:border-b-0 md:border-r"><h3 className="text-xs font-bold text-slate-500">현재 공개본</h3><p className="mt-2 text-sm font-bold">{selected.post.title}</p><pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{selected.post.contentText}</pre></section><section className="p-4"><h3 className="text-xs font-bold text-emerald-700">심사 후보 원문</h3><p className="mt-2 text-sm font-bold">{selected.candidateTitle}</p><pre className="mt-2 whitespace-pre-wrap text-xs leading-5">{selected.candidateContentText}</pre></section></div>
            </Card>
            {selected.candidateAttachmentIds.length ? <Card><CardHeader title="재인코딩 이미지 증거" description="관리자 화면에도 메타데이터를 제거한 사본만 표시합니다." /><div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-4">{selected.candidateAttachmentIds.map((id) => <Image key={id} src={`/api/admin/moderation/images/${id}`} alt="심사 이미지" width={320} height={320} unoptimized className="aspect-square w-full border object-cover" />)}</div></Card> : null}
            <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader title="복원 텍스트 / OCR" /><div className="space-y-4 p-4"><div><h3 className="text-xs font-bold text-slate-500">복원</h3><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap bg-slate-950 p-3 text-xs text-slate-100">{selected.normalizedText}</pre></div><div><h3 className="text-xs font-bold text-slate-500">OCR</h3><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap bg-slate-50 p-3 text-xs">{selected.ocrText || "OCR 텍스트 없음"}</pre></div></div></Card><Card><CardHeader title="계층 판정 비교" description="불일치는 자동 게시되지 않습니다." /><div className="grid gap-3 p-4"><details open><summary className="cursor-pointer text-xs font-bold">LOCAL</summary><pre className="mt-2 max-h-64 overflow-auto bg-slate-950 p-3 text-xs text-slate-100">{pretty(selected.localSignals)}</pre></details><details open><summary className="cursor-pointer text-xs font-bold">LUNA</summary><pre className="mt-2 max-h-64 overflow-auto bg-slate-950 p-3 text-xs text-slate-100">{pretty(selected.lunaResult)}</pre></details></div></Card></div>
            <Card><CardHeader title="운영자 결정" description="모든 작업은 사유와 함께 감사 로그에 남습니다." /><div className="space-y-3 p-4"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="판단 근거와 적용 규정을 기록하세요." rows={3} /><div className="flex flex-wrap gap-2"><Button onClick={() => void act("APPROVE")}>승인</Button><Button variant="danger" onClick={() => void act("REJECT")}>수정안 거절</Button><Button variant="danger" onClick={() => void act("HIDE")}>게시물 숨김</Button><Button variant="secondary" onClick={() => void act("RETRY")}>재검사</Button><Button variant="secondary" onClick={() => void act("SANCTION")}>경고 제재</Button></div></div></Card>
          </>}
        </div>

        <Card><CardHeader title="검토된 규칙" description="Luna 제안만으로 활성화되지 않습니다." /><div className="space-y-3 border-b p-4"><Select value={ruleKind} onChange={(event) => setRuleKind(event.target.value)}><option>TERM</option><option>REGEX</option><option>ALLOWLIST</option><option>TARGET_ALIAS</option><option>IMAGE_HASH</option></Select><Input value={rulePattern} onChange={(event) => setRulePattern(event.target.value)} placeholder="표현, 별칭, 정규식 또는 pHash" /><Button className="w-full" variant="secondary" onClick={() => void createRule()}>비활성 규칙으로 추가</Button></div><div className="max-h-[calc(100vh-390px)] overflow-y-auto">{rules.map((rule) => <div key={rule.id} className="border-b p-3"><div className="flex items-start justify-between gap-2"><div><Badge tone={rule.enabled ? "green" : "slate"}>{rule.kind}</Badge><p className="mt-2 break-all text-xs font-bold">{rule.pattern}</p><p className="mt-1 text-xs text-slate-500">위험도 {rule.severity}</p></div><button onClick={() => void toggleRule(rule)} className={`px-2 py-1 text-xs font-bold ${rule.enabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{rule.enabled ? "끄기" : "검토 후 켜기"}</button></div></div>)}</div></Card>
      </div>
      {message ? <button onClick={() => setMessage("")} className="fixed bottom-4 right-4 max-w-md border border-slate-700 bg-slate-950 px-4 py-3 text-left text-xs font-bold text-white shadow-xl">{message}</button> : null}
    </main>
  );
}
