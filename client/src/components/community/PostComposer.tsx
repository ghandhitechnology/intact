"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bold,
  CheckCircle2,
  ChevronDown,
  Code2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  Lock,
  Paperclip,
  Quote,
  Save,
  Send,
  X,
} from "lucide-react";
import {
  Avatar,
  BoardMark,
  LevelBadge,
  cx,
} from "./CommunityUI";
import {
  boards,
  getBoard,
  members,
  type BoardDefinition,
  type BoardSlug,
  type Member,
} from "./demo-data";
import SafeMarkdown from "./SafeMarkdown";

type EditorMode = "write" | "preview";

type ComposerAttachment = {
  key: string;
  file?: File;
  name: string;
  size: number;
  mimeType?: string;
  previewUrl?: string;
  id?: string;
  uploading?: boolean;
};

type LocalDraft = {
  userId: string;
  board: BoardSlug;
  title: string;
  content: string;
  tags: string[];
  savedAt: string;
};

type ServerDraft = {
  id: string;
  updatedAt: string;
  title: string;
  content: string;
  tags: string[];
  board: { slug: BoardSlug; name: string };
  attachments: Array<{
    id: string;
    originalName: string;
    sizeBytes: string | number;
    mimeType: string;
  }>;
};

const LEGACY_DRAFT_STORAGE_KEY = "igwak:post-composer-draft";
const PHOTO_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const draftStorageKeyFor = (userId: string) =>
  `igwak:post-composer-draft:${userId}`;
const draftFingerprint = (
  board: BoardSlug,
  title: string,
  content: string,
  tags: string[],
) => JSON.stringify([board, title, content, tags]);

const toolbar = [
  {
    label: "굵게",
    icon: Bold,
    before: "**",
    after: "**",
    placeholder: "굵은 글씨",
  },
  {
    label: "기울임",
    icon: Italic,
    before: "*",
    after: "*",
    placeholder: "기울임 글씨",
  },
  {
    label: "링크",
    icon: Link2,
    before: "[",
    after: "](https://)",
    placeholder: "링크 제목",
  },
  {
    label: "목록",
    icon: List,
    before: "- ",
    after: "",
    placeholder: "목록 항목",
  },
  {
    label: "인용",
    icon: Quote,
    before: "> ",
    after: "",
    placeholder: "인용문",
  },
  { label: "코드", icon: Code2, before: "`", after: "`", placeholder: "코드" },
];

export default function PostComposer({
  initialBoard,
}: {
  initialBoard: BoardDefinition;
}) {
  const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true";
  const [selectedSlug, setSelectedSlug] = useState<BoardSlug>(
    initialBoard.slug,
  );
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<EditorMode>("write");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState("아직 저장되지 않음");
  const [published, setPublished] = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [author, setAuthor] = useState<Member | null>(
    demoMode ? members[5] : null,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRestoredRef = useRef(false);
  const draftStorageKeyRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const serverSavedFingerprintRef = useRef<string | null>(null);
  const board = getBoard(selectedSlug) ?? initialBoard;
  const photoMode = selectedSlug === "photos";
  const attachmentLimit = photoMode ? 12 : 5;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function restoreDraft() {
      try {
        const sessionResponse = await fetch("/api/auth/session", {
          cache: "no-store",
          signal: controller.signal,
        });
        const sessionBody = await sessionResponse.json().catch(() => null);
        const user = sessionBody?.data?.authenticated
          ? sessionBody.data.user
          : null;
        if (!active || !sessionResponse.ok || !user?.id) return;

        const nickname = String(user.realName || user.nickname || "사용자");
        setAuthor({
          nickname,
          studentId: String(user.studentCode || user.studentId || "------"),
          level: Number(user.level || 1),
          initials: nickname.slice(0, 1),
          profileImage: user.profileImage || null,
          accent: "emerald",
        });
        const storageKey = draftStorageKeyFor(String(user.id));
        draftStorageKeyRef.current = storageKey;
        currentUserIdRef.current = String(user.id);
        const saved = window.localStorage.getItem(storageKey);
        let localDraft: Partial<LocalDraft> | null = null;
        if (saved) {
          try {
            localDraft = JSON.parse(saved) as Partial<LocalDraft>;
          } catch {
            window.localStorage.removeItem(storageKey);
          }
        }
        // The old shared key could expose one student's draft to the next user
        // on a shared device, so it must never be restored into another account.
        window.localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);

        const localBoard =
          typeof localDraft?.board === "string" &&
          getBoard(localDraft.board as BoardSlug)
            ? (localDraft.board as BoardSlug)
            : initialBoard.slug;
        const draftResponse = await fetch(
          `/api/posts/drafts?board=${encodeURIComponent(localBoard)}&limit=1`,
          { cache: "no-store", signal: controller.signal },
        );
        const draftBody = await draftResponse.json().catch(() => null);
        const serverDraft = draftResponse.ok
          ? (draftBody?.data?.drafts?.[0] as ServerDraft | undefined)
          : undefined;
        if (!active) return;

        const localSavedAt =
          typeof localDraft?.savedAt === "string"
            ? new Date(localDraft.savedAt).getTime()
            : 0;
        const serverSavedAt = serverDraft
          ? new Date(serverDraft.updatedAt).getTime()
          : 0;
        const useServer = Boolean(
          serverDraft && (!localDraft || serverSavedAt > localSavedAt),
        );
        const localMatchesServer = Boolean(
          serverDraft &&
            localDraft &&
            draftFingerprint(
              localBoard,
              typeof localDraft.title === "string" ? localDraft.title : "",
              typeof localDraft.content === "string" ? localDraft.content : "",
              Array.isArray(localDraft.tags)
                ? localDraft.tags.filter(
                    (tag): tag is string => typeof tag === "string",
                  )
                : [],
            ) ===
              draftFingerprint(
                serverDraft.board.slug,
                serverDraft.title,
                serverDraft.content,
                serverDraft.tags,
              ),
        );
        if (serverDraft) {
          setDraftId(serverDraft.id);
          setAttachments(
            serverDraft.attachments.map((attachment) => ({
              key: `server-${attachment.id}`,
              id: attachment.id,
              name: attachment.originalName,
              size: Number(attachment.sizeBytes),
              mimeType: attachment.mimeType,
            })),
          );
        }
        if (useServer && serverDraft) {
          setTitle(serverDraft.title.slice(0, 180));
          setContent(serverDraft.content.slice(0, 50_000));
          setTags(serverDraft.tags.slice(0, 8));
          setSelectedSlug(serverDraft.board.slug);
          serverSavedFingerprintRef.current = draftFingerprint(
            serverDraft.board.slug,
            serverDraft.title,
            serverDraft.content,
            serverDraft.tags,
          );
          setSavedAt("서버 임시저장에서 복구됨");
        } else if (localDraft) {
          if (typeof localDraft.title === "string")
            setTitle(localDraft.title.slice(0, 180));
          if (typeof localDraft.content === "string")
            setContent(localDraft.content.slice(0, 50_000));
          if (Array.isArray(localDraft.tags)) {
            setTags(
              localDraft.tags
                .filter((tag): tag is string => typeof tag === "string")
                .slice(0, 8),
            );
          }
          setSelectedSlug(localBoard);
          if (localMatchesServer && serverDraft) {
            serverSavedFingerprintRef.current = draftFingerprint(
              serverDraft.board.slug,
              serverDraft.title,
              serverDraft.content,
              serverDraft.tags,
            );
            setSavedAt("서버 임시저장에서 복구됨");
          } else {
            setSavedAt(
              serverDraft
                ? "이 기기의 최신 내용으로 복구됨"
                : "이 기기에서 복구됨",
            );
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setSubmitError(
            "저장된 초안을 불러오지 못했습니다. 새로 작성한 내용은 이 기기에 자동 저장됩니다.",
          );
        }
      } finally {
        if (active) draftRestoredRef.current = true;
      }
    }
    void restoreDraft();
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialBoard.slug]);

  useEffect(() => {
    if (
      !draftRestoredRef.current ||
      published ||
      (!title && !content && tags.length === 0)
    )
      return undefined;
    const timer = window.setTimeout(() => {
      const draft: LocalDraft = {
        userId: currentUserIdRef.current ?? "",
        board: selectedSlug,
        title,
        content,
        tags,
        savedAt: new Date().toISOString(),
      };
      try {
        const storageKey = draftStorageKeyRef.current;
        if (!storageKey) return;
        window.localStorage.setItem(storageKey, JSON.stringify(draft));
        const fingerprint = draftFingerprint(
          selectedSlug,
          title,
          content,
          tags,
        );
        if (fingerprint !== serverSavedFingerprintRef.current) {
          setSavedAt("이 기기에 자동 저장됨");
        }
      } catch {
        // Server-side draft saving remains available when browser storage is unavailable.
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [content, published, selectedSlug, tags, title]);

  function insertMarkup(before: string, after: string, placeholder: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      setContent((value) => `${value}${before}${placeholder}${after}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = content.slice(start, end) || placeholder;
    const next = `${content.slice(0, start)}${before}${selection}${after}${content.slice(end)}`;
    setContent(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selection.length,
      );
    });
  }

  function addTag() {
    const tag = tagInput.trim().replace(/^#/, "").replace(/\s+/g, "");
    if (!tag || tags.includes(tag) || tags.length >= 5) return;
    setTags((items) => [...items, tag]);
    setTagInput("");
  }

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const incoming = Array.from(files);
    const available = attachmentLimit - attachments.length;
    if (available <= 0) {
      setSubmitError(`첨부 파일은 최대 ${attachmentLimit}개까지예요.`);
      return;
    }
    const accepted = incoming.slice(0, available).filter((file) => {
      if (file.size > 20 * 1024 * 1024) {
        setSubmitError(`${file.name}: 20MB보다 커서 못 올려요.`);
        return false;
      }
      if (photoMode && !PHOTO_MIME_TYPES.has(file.type.toLowerCase())) {
        setSubmitError(`${file.name}: JPG, PNG, GIF, WebP, AVIF 사진만 올릴 수 있어요.`);
        return false;
      }
      return file.size > 0;
    });
    setAttachments((current) => [
      ...current,
      ...accepted.map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        previewUrl: photoMode ? URL.createObjectURL(file) : undefined,
      })),
    ]);
  }

  async function uploadAttachments() {
    const next = [...attachments];
    for (let index = 0; index < next.length; index += 1) {
      const item = next[index];
      if (!item || item.id) continue;
      if (!item.file)
        throw new Error(`${item.name} 파일을 다시 선택해 주세요.`);
      next[index] = { ...item, uploading: true };
      setAttachments([...next]);
      const form = new FormData();
      form.append("file", item.file);
      const response = await fetch("/api/uploads", {
        method: "POST",
        body: form,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.data?.attachment?.id) {
        next[index] = { ...item, uploading: false };
        setAttachments([...next]);
        throw new Error(
          body?.error?.message || `${item.name} 업로드에 실패했어요.`,
        );
      }
      next[index] = { ...item, id: body.data.attachment.id, uploading: false };
      setAttachments([...next]);
    }
    return next.flatMap((item) => (item.id ? [item.id] : []));
  }

  async function removeAttachment(item: ComposerAttachment) {
    if (item.uploading) return;
    if (item.id) {
      const response = await fetch(
        `/api/uploads/${encodeURIComponent(item.id)}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setSubmitError(body?.error?.message || "파일을 지우지 못했어요.");
        return;
      }
    }
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setAttachments((current) =>
      current.filter((candidate) => candidate.key !== item.key),
    );
  }

  async function persistPost(status: "DRAFT" | "PUBLISHED") {
    const attachmentIds = await uploadAttachments();
    const response = await fetch(
      draftId ? `/api/posts/${encodeURIComponent(draftId)}` : "/api/posts",
      {
        method: draftId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          board: selectedSlug,
          title: title.trim(),
          content: content.trim(),
          tags,
          status,
          attachmentIds,
        }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        body?.error?.message || body?.message || "저장하지 못했습니다.",
      );
    }
    const post = body?.data?.post || body?.post;
    if (post?.id) setDraftId(post.id);
    return post;
  }

  async function saveDraft() {
    if (!title.trim() && !content.trim() && attachments.length === 0) {
      setSubmitError("임시저장할 제목이나 내용을 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const post = await persistPost("DRAFT");
      serverSavedFingerprintRef.current = draftFingerprint(
        selectedSlug,
        title,
        content,
        tags,
      );
      setSavedAt("서버에 임시저장됨");
      if (post?.id) setDraftId(post.id);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "임시저장에 실패했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim().length < (photoMode ? 2 : 5)) {
      setSubmitError(`게시하려면 제목을 ${photoMode ? 2 : 5}자 이상 입력해 주세요.`);
      return;
    }
    if (!photoMode && content.trim().length < 20) {
      setSubmitError("게시하려면 본문을 20자 이상 작성해 주세요.");
      return;
    }
    if (photoMode && attachments.length === 0) {
      setSubmitError("사진을 한 장 이상 골라 주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const post = await persistPost("PUBLISHED");
      setPublishedId(post?.id || null);
      setPublished(true);
      if (draftStorageKeyRef.current)
        window.localStorage.removeItem(draftStorageKeyRef.current);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "게시글을 올리지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (published) {
    return (
      <div className="min-h-screen bg-[#f6f8f8] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl border border-slate-200 bg-white px-6 py-12 text-center  sm:px-12">
          <span className="mx-auto flex h-14 w-14 items-center justify-center border border-emerald-200 bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-2xl font-black tracking-[-0.035em] text-slate-950">게시 완료</h1>
          <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setPublished(false)}
              className="inline-flex h-11 items-center justify-center border border-slate-300 bg-white px-5 text-sm font-bold text-slate-600 hover:border-slate-500"
            >
              계속 수정하기
            </button>
            <Link
              href={
                publishedId ? `/post/${publishedId}` : `/boards/${board.slug}`
              }
              className="inline-flex h-11 items-center justify-center border border-emerald-700 bg-emerald-700 px-5 text-sm font-extrabold text-white hover:bg-emerald-800"
            >
              {publishedId ? "게시글 확인하기" : "게시판으로 가기"}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8f8] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <form onSubmit={submitPost} className="mx-auto max-w-[1220px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/boards/${initialBoard.slug}`}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {initialBoard.title}으로 돌아가기
          </Link>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {savedAt}
          </span>
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_290px]">
          <section className="border border-slate-200 bg-white ">
            <header className="border-b border-slate-200 px-5 py-6 sm:px-7">
              <div className="flex items-start gap-4">
                <BoardMark board={board} />
                <div>
                  <h1 className="text-2xl font-black tracking-[-0.035em] text-slate-950">
                    새 글 작성
                  </h1>
                </div>
              </div>
            </header>

            <div className="space-y-6 p-5 sm:p-7">
              <div className="grid gap-5 sm:grid-cols-[190px_minmax(0,1fr)]">
                <label className="block">
                  <span className="mb-2 block text-xs font-extrabold text-slate-700">
                    게시판 <span className="text-rose-500">*</span>
                  </span>
                  <span className="relative block">
                    <select
                      value={selectedSlug}
                      onChange={(event) =>
                        setSelectedSlug(event.target.value as BoardSlug)
                      }
                      className="h-11 w-full appearance-none border border-slate-300 bg-white px-3 pr-9 text-sm font-bold text-slate-700 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                    >
                      {boards.map((item) => (
                        <option key={item.slug} value={item.slug}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 flex items-center justify-between gap-3 text-xs font-extrabold text-slate-700">
                    <span>
                      제목 <span className="text-rose-500">*</span>
                    </span>
                    <span className="font-normal tabular-nums text-slate-400">
                      {title.length} / 80
                    </span>
                  </span>
                  <input
                    value={title}
                    onChange={(event) =>
                      setTitle(event.target.value.slice(0, 80))
                    }
                    placeholder="제목"
                    className="h-11 w-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                    required
                  />
                </label>
              </div>

              {!photoMode ? <div>
                <div className="mb-2 flex items-center justify-between gap-4">
                  <span className="text-xs font-extrabold text-slate-700">
                    내용 <span className="text-rose-500">*</span>
                  </span>
                  <div
                    className="flex border border-slate-200 bg-slate-50 p-0.5"
                    role="group"
                    aria-label="편집 방식"
                  >
                    {(["write", "preview"] as EditorMode[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setMode(item)}
                        aria-pressed={mode === item}
                        className={cx(
                          "px-3 py-1.5 text-[11px] font-bold",
                          mode === item
                            ? "bg-white text-slate-800 "
                            : "text-slate-400",
                        )}
                      >
                        {item === "write" ? "작성" : "미리보기"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-slate-300 focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600">
                  <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 p-2">
                    {toolbar.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() =>
                            insertMarkup(
                              item.before,
                              item.after,
                              item.placeholder,
                            )
                          }
                          title={item.label}
                          aria-label={item.label}
                          className="inline-flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      );
                    })}
                    <span
                      className="mx-1 h-5 w-px bg-slate-200"
                      aria-hidden="true"
                    />
                    <label
                      className="inline-flex h-8 cursor-pointer items-center gap-1.5 px-2 text-xs font-bold text-slate-500 hover:bg-white hover:text-slate-900"
                      title="이미지 첨부"
                    >
                      <ImageIcon className="h-4 w-4" aria-hidden="true" />
                      <span className="hidden sm:inline">이미지</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        onChange={(event) => {
                          addFiles(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>

                  {mode === "write" ? (
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={(event) =>
                        setContent(event.target.value.slice(0, 10000))
                      }
                      rows={17}
                      placeholder={selectedSlug === "question" ? "시도한 방법과 막힌 지점" : "내용"}
                      className="block w-full resize-y border-0 bg-white p-4 text-sm leading-7 text-slate-800 placeholder:text-slate-400 focus:ring-0"
                      required
                    />
                  ) : (
                    <div className="min-h-[428px] bg-white p-5">
                      {content.trim() ? (
                        <SafeMarkdown content={content} compact />
                      ) : (
                        <p className="text-sm text-slate-400">
                          미리 볼 내용이 아직 없습니다.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
                    <span>Markdown 지원</span>
                    <span className="tabular-nums">
                      {content.length} / 10,000
                    </span>
                  </div>
                </div>
              </div> : null}

              <div className="grid gap-5 lg:grid-cols-2">
                {!photoMode ? <div>
                  <label
                    htmlFor="post-tags"
                    className="mb-2 flex items-center justify-between gap-3 text-xs font-extrabold text-slate-700"
                  >
                    <span>태그</span>
                    <span className="font-normal text-slate-400">최대 5개</span>
                  </label>
                  <div className="flex border border-slate-300 bg-white focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600">
                    <input
                      id="post-tags"
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === ",") {
                          event.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder="태그 입력 후 Enter"
                      className="h-10 min-w-0 flex-1 border-0 px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-0"
                    />
                    <button
                      type="button"
                      onClick={addTag}
                      disabled={!tagInput.trim() || tags.length >= 5}
                      className="border-l border-slate-200 px-3 text-xs font-bold text-slate-500 disabled:text-slate-300"
                    >
                      추가
                    </button>
                  </div>
                  <div className="mt-2 flex min-h-[30px] flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700"
                      >
                        #{tag}
                        <button
                          type="button"
                          onClick={() =>
                            setTags((items) =>
                              items.filter((item) => item !== tag),
                            )
                          }
                          aria-label={`${tag} 태그 삭제`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div> : null}

                <div className={photoMode ? "lg:col-span-2" : undefined}>
                  <span className="mb-2 flex items-center justify-between gap-3 text-xs font-extrabold text-slate-700">
                    <span>{photoMode ? "사진" : "첨부 파일"}</span>
                    <span className="font-normal text-slate-400">
                      최대 {attachmentLimit}개 · 각 20MB
                    </span>
                  </span>
                  <label className={cx(
                    "flex cursor-pointer items-center justify-center gap-2 border border-dashed bg-slate-50 text-xs font-bold hover:bg-emerald-50",
                    photoMode ? "min-h-24 border-violet-300 text-violet-700 hover:border-violet-500" : "h-10 border-slate-300 text-slate-600 hover:border-emerald-500 hover:text-emerald-700",
                  )}>
                    {photoMode ? <ImageIcon className="h-5 w-5" aria-hidden="true" /> : <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />}
                    {photoMode ? "여러 사진 한 번에 고르기" : "파일 고르기"}
                    <input
                      type="file"
                      accept={photoMode ? "image/jpeg,image/png,image/gif,image/webp,image/avif" : undefined}
                      multiple
                      className="sr-only"
                      onChange={(event) => {
                        addFiles(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {attachments.length ? (
                    <ul className={photoMode ? "mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" : "mt-2 space-y-1.5"}>
                      {attachments.map((item) => (
                        <li
                          key={item.key}
                          className={cx(
                            "relative border border-slate-200 bg-white text-[11px]",
                            photoMode ? "overflow-hidden" : "flex items-center gap-2 px-2.5 py-2",
                          )}
                        >
                          {photoMode ? (
                            <>
                              <div
                                className="aspect-[4/3] bg-slate-100 bg-cover bg-center"
                                style={{ backgroundImage: `url(${item.previewUrl || (item.id ? `/api/uploads/${encodeURIComponent(item.id)}` : "")})` }}
                                role="img"
                                aria-label={item.name}
                              />
                              <div className="flex items-center gap-2 p-2">
                                <span className="min-w-0 flex-1 truncate font-bold text-slate-700">{item.name}</span>
                                <span className="shrink-0 text-slate-400">{item.uploading ? "올리는 중…" : item.id ? "저장됨" : `${(item.size / 1_048_576).toFixed(1)}MB`}</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                              <span className="min-w-0 flex-1 truncate font-bold text-slate-700">{item.name}</span>
                              <span className="shrink-0 text-slate-400">{item.uploading ? "올리는 중…" : item.id ? "저장됨" : `${(item.size / 1024 / 1024).toFixed(1)}MB`}</span>
                            </>
                          )}
                          {!item.uploading ? (
                            <button
                              type="button"
                              onClick={() => void removeAttachment(item)}
                              aria-label={`${item.name} 제거`}
                              className={photoMode ? "absolute right-2 top-2 grid h-7 w-7 place-items-center  bg-slate-950/70 text-white hover:bg-rose-600" : "text-slate-400 hover:text-rose-600"}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </div>

            <footer className="flex flex-col gap-4 border-t border-slate-200 bg-slate-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div>
                {submitError && (
                  <p
                    role="alert"
                    className="mt-2 text-xs font-bold text-rose-600"
                  >
                    {submitError}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={submitting}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 border border-slate-300 bg-white px-4 text-xs font-extrabold text-slate-600 hover:border-slate-500 sm:flex-none"
                >
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  임시저장
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 border border-emerald-700 bg-emerald-700 px-5 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 sm:flex-none"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  {submitting ? "저장 중…" : "게시하기"}
                </button>
              </div>
            </footer>
          </section>

          <aside className="grid gap-4 sm:grid-cols-2 xl:sticky xl:top-6 xl:grid-cols-1">
            <section className="border border-slate-200 bg-white p-5">
              <p className="text-xs font-bold text-slate-500">
                작성 계정
              </p>
              {author ? (
                <div className="mt-4 flex items-center gap-3">
                  <Avatar member={author} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-black text-slate-800">
                        {author.nickname}
                      </p>
                      <LevelBadge level={author.level} />
                    </div>
                    <p className="mt-1 text-[11px] tabular-nums text-slate-400">
                      학번 {author.studentId}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-xs text-slate-400">
                  작성 계정을 확인하는 중…
                </p>
              )}
              <div className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-4">
                <Lock
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400"
                  aria-hidden="true"
                />
                <p className="text-[11px] leading-5 text-slate-500">
                  학번 공개
                </p>
              </div>
            </section>

          </aside>
        </div>
      </form>
    </div>
  );
}
