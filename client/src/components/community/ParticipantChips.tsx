"use client";

import { cn } from "@/components/operations/ui";
import {
  CHAT_MAX_OTHER_MEMBERS,
  chatTooManyMembersMessage,
  takeCompletedParticipantCodes,
} from "@/lib/chat-limits";
import { isValidStudentCode, STUDENT_CODE_REQUIREMENTS } from "@/lib/student-code";
import { X } from "lucide-react";
import { KeyboardEvent } from "react";

function isParticipantCode(value: string, bSideEnabled: boolean) {
  return bSideEnabled ? /^#[A-F0-9]{8}$/i.test(value) : isValidStudentCode(value);
}

export function ParticipantChips({
  chips,
  draft,
  onChipsChange,
  onDraftChange,
  bSideEnabled,
  currentStudentCode,
  disabled,
}: {
  chips: string[];
  draft: string;
  onChipsChange: (chips: string[]) => void;
  onDraftChange: (draft: string) => void;
  bSideEnabled: boolean;
  currentStudentCode?: string;
  disabled?: boolean;
}) {
  const invalidDraft = Boolean(draft.trim()) && !isParticipantCode(draft.trim(), bSideEnabled);
  const atLimit = chips.length >= CHAT_MAX_OTHER_MEMBERS;

  function commit(raw: string) {
    const next = raw.trim();
    if (!next) return;
    if (currentStudentCode && next === currentStudentCode) return;
    if (!isParticipantCode(next, bSideEnabled)) return;
    if (chips.includes(next) || chips.length >= CHAT_MAX_OTHER_MEMBERS) return;
    onChipsChange([...chips, next]);
    onDraftChange("");
  }

  function handleChange(value: string) {
    const normalized = bSideEnabled ? value.toUpperCase() : value;
    const { completed, rest } = takeCompletedParticipantCodes(normalized);
    if (!completed.length) {
      onDraftChange(normalized);
      return;
    }
    const accepted: string[] = [];
    for (const code of completed) {
      if (currentStudentCode && code === currentStudentCode) continue;
      if (!isParticipantCode(code, bSideEnabled)) continue;
      if (chips.includes(code) || accepted.includes(code)) continue;
      if (chips.length + accepted.length >= CHAT_MAX_OTHER_MEMBERS) break;
      accepted.push(code);
    }
    if (accepted.length) onChipsChange([...chips, ...accepted]);
    onDraftChange(rest);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && !draft && chips.length) {
      onChipsChange(chips.slice(0, -1));
    }
  }

  return (
    <div>
      <div
        className={cn(
          "flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-2xl border bg-slate-50/80 px-2.5 py-2 transition-colors focus-within:border-emerald-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-600/10",
          invalidDraft ? "border-red-300" : "border-slate-200",
        )}
      >
        {chips.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-800 shadow-[var(--shadow-xs)]"
          >
            {code}
            <button
              type="button"
              disabled={disabled}
              aria-label={`${code} 제거`}
              onClick={() => onChipsChange(chips.filter((item) => item !== code))}
              className="grid h-4 w-4 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          inputMode={bSideEnabled ? "text" : "numeric"}
          value={draft}
          disabled={disabled || atLimit}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={handleKeyDown}
          placeholder={
            chips.length
              ? ""
              : bSideEnabled
                ? "#A1B2C3D4"
                : "331108"
          }
          className="min-w-[7rem] flex-1 bg-transparent px-1.5 py-1 text-sm outline-none disabled:text-slate-400"
        />
      </div>
      <span className="mt-2 block text-xs leading-5 text-slate-500">
        {atLimit
          ? chatTooManyMembersMessage()
          : bSideEnabled
            ? `화면에 표시된 해시 · 쉼표/공백으로 추가 · ${chips.length}/${CHAT_MAX_OTHER_MEMBERS}명`
            : `학번 입력 후 쉼표나 스페이스 · ${chips.length}/${CHAT_MAX_OTHER_MEMBERS}명`}
      </span>
      {invalidDraft ? (
        <p role="alert" className="mt-1 text-xs font-bold text-red-600">
          {bSideEnabled ? "#으로 시작하는 8자리 익명 해시를 확인하세요." : STUDENT_CODE_REQUIREMENTS}
        </p>
      ) : null}
    </div>
  );
}
