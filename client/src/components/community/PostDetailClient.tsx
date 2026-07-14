"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileText,
  Flag,
  Gift,
  Lock,
  MessageCircle,
  Paperclip,
  Pencil,
  Reply,
  Send,
  Share2,
  ShieldCheck,
  ThumbsUp,
  Trash2,
  User,
} from "lucide-react";
import {
  Avatar,
  BoardBadge,
  DeadlineBadge,
  LevelBadge,
  MemberLine,
  SolvedBadge,
  cx,
} from "./CommunityUI";
import {
  comments as initialComments,
  formatNumber,
  getBoard,
  members,
  posts,
  type Member,
  type PostSummary,
} from "./demo-data";
import SafeMarkdown from "./SafeMarkdown";

type CommentItem = {
  id: string;
  parentId?: string | null;
  author: Member;
  createdAt: string;
  createdAtRaw?: number;
  likes: number;
  viewerRecommended?: boolean;
  accepted: boolean;
  content: string;
};

function BodyContent({
  post,
  isNotice,
}: {
  post: PostSummary;
  isNotice: boolean;
}) {
  if (post.content) {
    return <SafeMarkdown content={post.content} />;
  }

  if (isNotice) {
    return (
      <div className="space-y-5 text-[15px] leading-8 text-slate-700">
        <p>안녕하세요. 인텍트 운영팀입니다.</p>
        <p>
          인텍트는 학번이 표시되는 재학생 커뮤니티입니다. 자유롭게
          질문하고 정보를 나누되, 화면 밖에도 실제 학교생활이 이어진다는 점을
          기억해 주세요.
        </p>
        <div className="border-l-4 border-emerald-600 bg-emerald-50 px-5 py-4">
          <p className="font-extrabold text-slate-900">
            함께 지킬 네 가지 원칙
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
            <li>사람을 향한 비난보다 의견과 근거에 집중합니다.</li>
            <li>개인정보와 타인의 사진을 허락 없이 공유하지 않습니다.</li>
            <li>자료를 공유할 때는 출처와 저작권을 확인합니다.</li>
            <li>
              이상한 글은 맞저격하지 말고 신고합니다. 운영자가 보고 지웁니다.
            </li>
          </ol>
        </div>
        <p>
          신고는 운영자만 봅니다. 그런데 신고할 일을 안 만드는 게 제일 좋습니다.
          서로 선은 지킵시다.
        </p>
      </div>
    );
  }

  if (post.id === "q-1042") {
    return (
      <div className="space-y-5 text-[15px] leading-8 text-slate-700">
        <p>
          라그랑주 승수법을 복습하다가 제약식의 gradient와 목적함수의 gradient가
          평행해야 한다는 부분에서 막혔습니다.
        </p>
        <p>
          계산 절차 자체는 이해했습니다. 예를 들어 <strong>f(x, y)</strong>를
          최대화하면서 <strong>g(x, y) = c</strong>를 만족해야 할 때 아래 식을
          세우는 것까지는 괜찮습니다.
        </p>
        <div className="border border-slate-200 bg-slate-50 px-5 py-6 text-center font-mono text-lg font-bold text-slate-800">
          ∇f(x, y) = λ∇g(x, y)
        </div>
        <p>
          다만 “최적점에서는 두 gradient가 평행하다”는 설명이 결과를 다시 말하는
          것처럼 느껴집니다. 제약 곡면 위에서 움직일 수 있는 방향과 연결해서
          직관적으로 설명해 주실 수 있을까요?
        </p>
        <p className="text-sm text-slate-500">
          가능하면 등고선 관점과 접선 공간 관점을 함께 알려 주시면
          감사하겠습니다.
        </p>
      </div>
    );
  }

  if (post.board === "contest") {
    return (
      <div className="space-y-5 text-[15px] leading-8 text-slate-700">
        <p>{post.excerpt}</p>
        <div className="grid border border-slate-200 bg-slate-50 sm:grid-cols-2">
          <div className="border-b border-slate-200 p-4 sm:border-b-0 sm:border-r">
            <p className="text-xs font-bold text-slate-400">모집 분야</p>
            <p className="mt-1 text-sm font-extrabold text-slate-800">
              데이터 분석 · 시각화
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs font-bold text-slate-400">모집 마감</p>
            <p className="mt-1 text-sm font-extrabold text-blue-700">
              {post.deadline ?? "협의"}
            </p>
          </div>
        </div>
        <p>
          주제는 환경 센서 데이터에서 도시 열섬 현상을 찾는 것입니다. 기본적인
          Python 데이터 처리 경험이 있으면 좋지만, 끝까지 같이 배울 의지가
          있다면 경험이 많지 않아도 괜찮습니다.
        </p>
        <p>
          관심 있는 분은 댓글로 가능한 시간과 해 보고 싶은 역할을 남겨 주세요.
          세부 기획서는 팀이 모인 뒤 공유하겠습니다.
        </p>
      </div>
    );
  }

  if (post.board === "resources") {
    return (
      <div className="space-y-5 text-[15px] leading-8 text-slate-700">
        <p>{post.excerpt}</p>
        <p>
          수업 내용을 다시 볼 때 흐름을 한눈에 확인할 수 있도록 핵심 개념 사이의
          관계를 먼저 정리했습니다. 시험 직전에는 아래 오답 체크리스트만 빠르게
          훑어도 좋습니다.
        </p>
        <div className="border border-blue-200 bg-blue-50 p-5">
          <p className="font-extrabold text-slate-900">첨부 자료 사용 안내</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            개인 학습과 교내 스터디에서 자유롭게 사용할 수 있습니다. 외부
            재배포나 수정본 공유 전에는 작성자에게 먼저 물어봐 주세요.
          </p>
        </div>
        <p>
          오류나 보완할 부분을 발견하면 댓글로 알려 주세요. 다음 버전에
          반영하겠습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-[15px] leading-8 text-slate-700">
      <p>{post.excerpt}</p>
      <p>
        오늘 학교에서 이 이야기를 나누다가 다른 친구들 생각도 궁금해졌습니다.
        비슷한 경험이 있거나 좋은 아이디어가 있다면 편하게 댓글로 남겨 주세요.
      </p>
      <p>서로의 취향은 존중하면서 즐겁게 이야기해 봅시다!</p>
    </div>
  );
}

function CommentCard({
  comment,
  onReply,
  onAccept,
  viewerStudentId,
  onDeleted,
}: {
  comment: CommentItem;
  onReply: (comment: CommentItem) => void;
  onAccept?: (commentId: string) => Promise<void>;
  viewerStudentId?: string;
  onDeleted: (commentId: string) => void;
}) {
  const initiallyLiked = Boolean(comment.viewerRecommended);
  const [liked, setLiked] = useState(initiallyLiked);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(comment.content);
  const [savedContent, setSavedContent] = useState(comment.content);
  const [editError, setEditError] = useState("");
  const isOwner = Boolean(
    viewerStudentId && viewerStudentId === comment.author.studentId,
  );

  async function toggleLike() {
    setPending(true);
    try {
      const response = await fetch("/api/recommendations", {
        method: liked ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commentId: comment.id }),
      });
      if (response.ok) setLiked((value) => !value);
    } finally {
      setPending(false);
    }
  }

  async function saveEdit() {
    const next = content.trim();
    if (!next) return;
    setPending(true);
    setEditError("");
    try {
      const response = await fetch(
        `/api/comments/${encodeURIComponent(comment.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: next }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(body?.error?.message || "댓글을 수정하지 못했습니다.");
      setContent(next);
      setSavedContent(next);
      setEditing(false);
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "댓글을 수정하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  async function deleteComment() {
    if (
      !window.confirm("이 댓글을 삭제할까요? 삭제한 댓글은 복구할 수 없습니다.")
    )
      return;
    setPending(true);
    setEditError("");
    try {
      const response = await fetch(
        `/api/comments/${encodeURIComponent(comment.id)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(body?.error?.message || "댓글을 삭제하지 못했습니다.");
      onDeleted(comment.id);
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "댓글을 삭제하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      id={`comment-${comment.id}`}
      className={cx(
        "scroll-mt-32 border-b border-slate-100 px-5 py-5 target:bg-blue-50 sm:px-7",
        comment.accepted && "bg-emerald-50/60",
      )}
    >
      {comment.accepted && (
        <div className="mb-4 inline-flex items-center gap-1.5 border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-extrabold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          채택된 답변
        </div>
      )}
      <div className="flex items-start gap-3">
        <Avatar member={comment.author} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-extrabold text-slate-800">
              {comment.author.nickname}
            </span>
            <span className="text-xs tabular-nums text-slate-400">
              {comment.author.studentId}
            </span>
            <LevelBadge level={comment.author.level} />
            <span className="text-[11px] text-slate-400">
              {comment.createdAt}
            </span>
          </div>
          {editing ? (
            <div className="mt-3">
              <textarea
                value={content}
                onChange={(event) =>
                  setContent(event.target.value.slice(0, 3000))
                }
                rows={4}
                className="w-full border border-slate-300 p-3 text-sm leading-6 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setContent(savedContent);
                    setEditing(false);
                    setEditError("");
                  }}
                  className="h-8 border border-slate-300 px-3 text-[11px] font-bold text-slate-500"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={pending || !content.trim()}
                  onClick={saveEdit}
                  className="h-8 border border-emerald-700 bg-emerald-700 px-3 text-[11px] font-bold text-white"
                >
                  수정 저장
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {savedContent}
            </p>
          )}
          {editError && (
            <p role="alert" className="mt-2 text-xs font-bold text-rose-600">
              {editError}
            </p>
          )}
          <div className="mt-4 flex items-center gap-4">
            <button
              type="button"
              onClick={toggleLike}
              disabled={pending}
              aria-pressed={liked}
              className={cx(
                "inline-flex items-center gap-1.5 text-xs font-bold",
                liked
                  ? "text-emerald-700"
                  : "text-slate-400 hover:text-slate-700",
              )}
            >
              <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
              도움돼요 {comment.likes + Number(liked) - Number(initiallyLiked)}
            </button>
            <button
              type="button"
              onClick={() => onReply(comment)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-700"
            >
              <Reply className="h-3.5 w-3.5" aria-hidden="true" />
              답글
            </button>
            {onAccept && !comment.accepted && (
              <button
                type="button"
                disabled={pending}
                onClick={() => onAccept(comment.id)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:underline disabled:text-slate-300"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> 답변 채택
              </button>
            )}
            {isOwner && !editing && (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setContent(savedContent);
                    setEditing(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-blue-700"
                >
                  <Pencil className="h-3 w-3" />
                  수정
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={deleteComment}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="h-3 w-3" />
                  삭제
                </button>
              </>
            )}
            <Link
              href={`/support?targetType=COMMENT&targetId=${encodeURIComponent(comment.id)}`}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-slate-300 hover:text-rose-600"
            >
              <Flag className="h-3.5 w-3.5" /> 신고
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function PostDetailClient({
  post,
  isNotice = false,
}: {
  post: PostSummary;
  isNotice?: boolean;
}) {
  const router = useRouter();
  const demoMode = process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true";
  const initiallyLiked = Boolean(post.viewerRecommended);
  const [liked, setLiked] = useState(initiallyLiked);
  const [bookmarked, setBookmarked] = useState(Boolean(post.viewerBookmarked));
  const [copied, setCopied] = useState(false);
  const [following, setFollowing] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [commentSort, setCommentSort] = useState<"recommended" | "latest">(
    "recommended",
  );
  const [actionError, setActionError] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [editingPost, setEditingPost] = useState(false);
  const [displayTitle, setDisplayTitle] = useState(post.title);
  const [displayContent, setDisplayContent] = useState(
    post.content || post.excerpt,
  );
  const [editTitle, setEditTitle] = useState(post.title);
  const [editContent, setEditContent] = useState(post.content || post.excerpt);
  const [commentItems, setCommentItems] = useState<CommentItem[]>(
    post.commentItems ??
      (process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true" && !isNotice
        ? (initialComments as CommentItem[])
        : []),
  );
  const board = getBoard(post.board);
  const isPostOwner = Boolean(
    !isNotice &&
      post.viewer?.studentId &&
      post.viewer.studentId === post.author.studentId,
  );

  const [relatedPosts, setRelatedPosts] = useState<PostSummary[]>(
    demoMode
      ? posts
          .filter((item) => item.board === post.board && item.id !== post.id)
          .slice(0, 4)
      : [],
  );

  useEffect(() => {
    if (demoMode) return;
    let active = true;
    fetch(
      `/api/posts?board=${encodeURIComponent(post.board)}&sort=recommended&pageSize=5`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error("related posts failed");
        return body?.data?.posts || body?.posts || [];
      })
      .then((items) => {
        if (!active || !Array.isArray(items)) return;
        setRelatedPosts(
          items
            .filter((item) => item.id !== post.id)
            .slice(0, 4)
            .map((item) => {
              const nickname =
                item?.author?.realName ||
                item?.author?.nickname ||
                "알 수 없음";
              return {
                id: item.id,
                board: post.board,
                title: item.title,
                excerpt: item.contentText || "",
                author: {
                  nickname,
                  studentId:
                    item?.author?.studentIdentity?.studentCode || "------",
                  level: Number(item?.author?.level || 1),
                  initials: nickname.slice(0, 1),
                  profileImage: item?.author?.profileImage || null,
                  accent: "emerald" as const,
                },
                createdAt: new Date(
                  item.publishedAt || item.createdAt,
                ).toLocaleString("ko-KR"),
                comments: Number(item.commentCount || 0),
                views: Number(item.viewCount || 0),
                likes: Number(item.recommendationCount || 0),
                tags: Array.isArray(item.tags) ? item.tags : [],
              } satisfies PostSummary;
            }),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [demoMode, post.board, post.id]);

  const sortedCommentItems = useMemo(
    () =>
      [...commentItems].sort((left, right) => {
        if (left.accepted !== right.accepted) return left.accepted ? -1 : 1;
        if (commentSort === "latest")
          return (right.createdAtRaw || 0) - (left.createdAtRaw || 0);
        return (
          right.likes - left.likes ||
          (left.createdAtRaw || 0) - (right.createdAtRaw || 0)
        );
      }),
    [commentItems, commentSort],
  );

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = commentText.trim();
    if (!content) return;
    setActionPending(true);
    setActionError("");
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          postId: post.id,
          parentId: replyTo?.id,
          content: replyTo ? `@${replyTo.author.nickname} ${content}` : content,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(body?.error?.message || "댓글을 저장하지 못했습니다.");
      const created = body?.data?.comment || body?.comment;
      const createdNickname =
        created?.author?.realName ||
        created?.author?.nickname ||
        post.viewer?.nickname ||
        (demoMode ? members[5].nickname : "나");
      setCommentItems((items) => [
        ...items,
        {
          id: created?.id || `new-${Date.now()}`,
          parentId: created?.parentId || replyTo?.id || null,
          author: created?.author
            ? {
                nickname: createdNickname,
                studentId:
                  created?.author?.studentIdentity?.studentCode ||
                  post.viewer?.studentId ||
                  "------",
                level: Number(
                  created?.author?.level || post.viewer?.level || 1,
                ),
                initials: createdNickname.slice(0, 1),
                accent: "emerald",
              }
            : (post.viewer ??
              (demoMode
                ? members[5]
                : {
                    nickname: createdNickname,
                    studentId: "------",
                    level: 1,
                    initials: createdNickname.slice(0, 1),
                    accent: "emerald",
                  })),
          createdAt: "방금",
          createdAtRaw: Date.now(),
          likes: 0,
          viewerRecommended: false,
          accepted: false,
          content: replyTo ? `@${replyTo.author.nickname} ${content}` : content,
        },
      ]);
      setCommentText("");
      setReplyTo(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "댓글 작성에 실패했습니다.",
      );
    } finally {
      setActionPending(false);
    }
  }

  async function toggleRecommendation() {
    setActionPending(true);
    setActionError("");
    try {
      const response = await fetch("/api/recommendations", {
        method: liked ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId: post.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(body?.error?.message || "추천을 반영하지 못했습니다.");
      setLiked((value) => !value);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "추천을 반영하지 못했습니다.",
      );
    } finally {
      setActionPending(false);
    }
  }

  async function toggleBookmark() {
    setActionPending(true);
    setActionError("");
    try {
      const response = await fetch("/api/bookmarks", {
        method: bookmarked ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId: post.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          body?.error?.message || "스크랩을 반영하지 못했습니다.",
        );
      setBookmarked((value) => !value);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "스크랩을 반영하지 못했습니다.",
      );
    } finally {
      setActionPending(false);
    }
  }

  async function acceptAnswer(commentId: string) {
    setActionPending(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/posts/${encodeURIComponent(post.id)}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commentId }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok)
        throw new Error(body?.error?.message || "답변을 채택하지 못했습니다.");
      setCommentItems((items) =>
        items.map((item) => ({ ...item, accepted: item.id === commentId })),
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "답변을 채택하지 못했습니다.",
      );
    } finally {
      setActionPending(false);
    }
  }

  async function savePostEdit() {
    if (editTitle.trim().length < 2 || !editContent.trim()) return;
    setActionPending(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/posts/${encodeURIComponent(post.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: editTitle.trim(),
            content: editContent.trim(),
          }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          body?.error?.message || "게시글을 수정하지 못했습니다.",
        );
      setDisplayTitle(editTitle.trim());
      setDisplayContent(editContent.trim());
      setEditingPost(false);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "게시글을 수정하지 못했습니다.",
      );
    } finally {
      setActionPending(false);
    }
  }

  async function deletePost() {
    if (
      !window.confirm(
        "이 게시글을 삭제할까요? 작성 보상과 이 글이 받은 추천 보상이 회수됩니다.",
      )
    )
      return;
    setActionPending(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/posts/${encodeURIComponent(post.id)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          body?.error?.message || "게시글을 삭제하지 못했습니다.",
        );
      router.replace(`/boards/${post.board}`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "게시글을 삭제하지 못했습니다.",
      );
      setActionPending(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f8f8] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-[1220px]">
        <nav
          className="mb-5 flex items-center gap-2 text-xs text-slate-400"
          aria-label="현재 위치"
        >
          <Link
            href="/"
            className="inline-flex items-center gap-1 font-bold hover:text-emerald-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />홈
          </Link>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          {isNotice ? (
            <span className="bg-slate-900 px-2 py-1 text-[10px] font-extrabold text-white">
              관리자 공지
            </span>
          ) : (
            <BoardBadge slug={post.board} />
          )}
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span className="truncate">게시글</span>
        </nav>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_290px]">
          <div className="min-w-0">
            <article className="border border-slate-200 bg-white shadow-[0_3px_12px_rgba(15,23,42,0.03)]">
              <header className="border-b border-slate-200 px-5 py-6 sm:px-8 sm:py-8">
                <div className="flex flex-wrap items-center gap-2">
                  {post.notice && (
                    <span className="bg-slate-950 px-2.5 py-1.5 text-[10px] font-extrabold text-white">
                      관리자 공지
                    </span>
                  )}
                  {post.solved && <SolvedBadge />}
                  {post.deadline && <DeadlineBadge deadline={post.deadline} />}
                  {post.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/search?q=${encodeURIComponent(tag)}`}
                      className="bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-200"
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
                {editingPost ? (
                  <input
                    value={editTitle}
                    onChange={(event) =>
                      setEditTitle(event.target.value.slice(0, 180))
                    }
                    className="mt-4 h-12 w-full border border-slate-300 px-3 text-xl font-black text-slate-950 focus:border-emerald-600"
                    aria-label="게시글 제목 수정"
                  />
                ) : (
                  <h1 className="mt-4 break-keep text-2xl font-black leading-[1.38] tracking-[-0.04em] text-slate-950 sm:text-[2rem]">
                    {displayTitle}
                  </h1>
                )}
                <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <MemberLine member={post.author} />
                  <div className="flex flex-wrap items-center gap-3 text-[11px] tabular-nums text-slate-400">
                    <span>{post.createdAt}</span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatNumber(post.views)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      {commentItems.length}
                    </span>
                  </div>
                </div>
              </header>

              <div className="px-5 py-8 sm:px-8 sm:py-10">
                {editingPost ? (
                  <div>
                    <textarea
                      value={editContent}
                      onChange={(event) =>
                        setEditContent(event.target.value.slice(0, 50_000))
                      }
                      rows={16}
                      className="w-full border border-slate-300 p-4 text-sm leading-7 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                      aria-label="게시글 본문 수정"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={() => {
                          setEditTitle(displayTitle);
                          setEditContent(displayContent);
                          setEditingPost(false);
                          setActionError("");
                        }}
                        className="h-9 border border-slate-300 px-4 text-xs font-bold text-slate-600"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        disabled={
                          actionPending ||
                          editTitle.trim().length < 2 ||
                          !editContent.trim()
                        }
                        onClick={savePostEdit}
                        className="h-9 border border-emerald-700 bg-emerald-700 px-4 text-xs font-bold text-white"
                      >
                        수정 저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <BodyContent
                    post={{
                      ...post,
                      title: displayTitle,
                      content: displayContent,
                    }}
                    isNotice={isNotice}
                  />
                )}

                {(Boolean(post.attachments?.length) ||
                  (demoMode && Boolean(post.attachmentCount))) && (
                  <section
                    className="mt-8 border border-slate-200"
                    aria-labelledby="attachments-heading"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <h2
                        id="attachments-heading"
                        className="inline-flex items-center gap-2 text-xs font-extrabold text-slate-700"
                      >
                        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                        첨부 파일 {post.attachmentCount}개
                      </h2>
                    </div>
                    {post.attachments?.length ? (
                      post.attachments.map((attachment) => (
                        <a
                          key={attachment.id}
                          href={`/api/uploads/${encodeURIComponent(attachment.id)}`}
                          className="flex w-full items-center gap-3 border-b border-slate-100 p-4 text-left last:border-b-0 hover:bg-slate-50"
                        >
                          <span className="flex h-9 w-9 items-center justify-center border border-blue-200 bg-blue-50 text-blue-700">
                            <FileText className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-extrabold text-slate-700">
                              {attachment.originalName}
                            </span>
                            <span className="mt-1 block text-[10px] text-slate-400">
                              {attachment.mimeType} ·{" "}
                              {(attachment.sizeBytes / 1024 / 1024).toFixed(1)}{" "}
                              MB
                            </span>
                          </span>
                          <span className="text-xs font-bold text-blue-700">
                            받기
                          </span>
                        </a>
                      ))
                    ) : (
                      <div className="flex items-center gap-3 p-4 text-xs text-slate-500">
                        데모 첨부 파일입니다.
                      </div>
                    )}
                  </section>
                )}
              </div>

              <footer className="flex flex-col gap-5 border-t border-slate-100 bg-slate-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleRecommendation}
                    disabled={actionPending}
                    aria-pressed={liked}
                    className={cx(
                      "inline-flex h-10 items-center gap-2 border px-4 text-xs font-extrabold",
                      liked
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:border-emerald-600 hover:text-emerald-700",
                    )}
                  >
                    <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                    도움돼요{" "}
                    {post.likes + Number(liked) - Number(initiallyLiked)}
                  </button>
                  <button
                    type="button"
                    onClick={toggleBookmark}
                    disabled={actionPending}
                    aria-pressed={bookmarked}
                    className={cx(
                      "inline-flex h-10 w-10 items-center justify-center border",
                      bookmarked
                        ? "border-blue-700 bg-blue-700 text-white"
                        : "border-slate-300 bg-white text-slate-500 hover:text-blue-700",
                    )}
                    aria-label={bookmarked ? "스크랩 취소" : "스크랩"}
                  >
                    <Bookmark className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  {isPostOwner && !editingPost && (
                    <>
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={() => setEditingPost(true)}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-700"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        수정
                      </button>
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={deletePost}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        삭제
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={copyLink}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Share2 className="h-3.5 w-3.5" />
                    )}
                    {copied ? "주소 복사됨" : "공유"}
                  </button>
                  <Link
                    href={`/support?targetType=POST&targetId=${encodeURIComponent(post.id)}`}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-rose-600"
                  >
                    <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                    신고
                  </Link>
                </div>
                {actionError && (
                  <p
                    role="alert"
                    className="text-xs font-bold text-rose-600 sm:basis-full"
                  >
                    {actionError}
                  </p>
                )}
              </footer>
            </article>

            <section
              className="mt-6 border border-slate-200 bg-white shadow-[0_3px_12px_rgba(15,23,42,0.03)]"
              aria-labelledby="comments-heading"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-5 sm:px-7">
                <h2
                  id="comments-heading"
                  className="text-base font-black text-slate-900"
                >
                  댓글{" "}
                  <span className="text-emerald-700">
                    {commentItems.length}
                  </span>
                </h2>
                <div className="flex gap-3 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setCommentSort("recommended")}
                    aria-pressed={commentSort === "recommended"}
                    className={
                      commentSort === "recommended"
                        ? "text-emerald-700"
                        : "text-slate-400 hover:text-slate-700"
                    }
                  >
                    추천순
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentSort("latest")}
                    aria-pressed={commentSort === "latest"}
                    className={
                      commentSort === "latest"
                        ? "text-emerald-700"
                        : "text-slate-400 hover:text-slate-700"
                    }
                  >
                    최신순
                  </button>
                </div>
              </div>

              {commentItems.length > 0 ? (
                sortedCommentItems.map((comment) => (
                  <CommentCard
                    key={comment.id}
                    comment={comment}
                    onReply={setReplyTo}
                    onAccept={
                      post.board === "question" &&
                      post.viewer?.studentId === post.author.studentId
                        ? acceptAnswer
                        : undefined
                    }
                    viewerStudentId={post.viewer?.studentId}
                    onDeleted={(commentId) =>
                      setCommentItems((items) =>
                        items.filter((item) => item.id !== commentId),
                      )
                    }
                  />
                ))
              ) : (
                <div className="px-5 py-12 text-center text-sm text-slate-400">
                  댓글 없음
                </div>
              )}

              <form onSubmit={submitComment} className="bg-slate-50 p-5 sm:p-7">
                <div className="mb-3 flex items-center justify-between gap-3">
                  {post.viewer || demoMode ? (
                    <MemberLine member={post.viewer ?? members[5]} compact />
                  ) : (
                    <span className="text-xs text-slate-400">
                      계정 정보를 확인하는 중…
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400">
                    {commentText.length} / 2,000
                  </span>
                </div>
                {replyTo && (
                  <div className="flex items-center justify-between border border-blue-200 border-b-0 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    <span>
                      <strong>@{replyTo.author.nickname}</strong>님에게 답글
                      작성 중
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="font-bold underline"
                    >
                      취소
                    </button>
                  </div>
                )}
                <textarea
                  value={commentText}
                  onChange={(event) =>
                    setCommentText(event.target.value.slice(0, 2000))
                  }
                  rows={4}
                  placeholder="댓글 작성 · 학번 공개"
                  className="w-full resize-y border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-800 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
                <div className="mt-3 flex items-center justify-between gap-4">
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    댓글 작성 시 2 IGK
                  </span>
                  <button
                    type="submit"
                    disabled={actionPending || !commentText.trim()}
                    className="inline-flex h-9 items-center gap-2 border border-emerald-700 bg-emerald-700 px-4 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    댓글 등록
                  </button>
                </div>
              </form>
            </section>
          </div>

          <aside className="grid gap-4 sm:grid-cols-2 xl:sticky xl:top-6 xl:grid-cols-1">
            <section className="border border-slate-200 bg-white p-5">
              <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">
                작성자
              </p>
              <div className="flex items-center gap-3">
                <Avatar member={post.author} size="lg" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-black text-slate-900">
                      {post.author.nickname}
                    </p>
                    {isNotice ? (
                      <span className="bg-slate-900 px-2 py-1 text-[10px] font-extrabold text-white">
                        운영자
                      </span>
                    ) : (
                      <LevelBadge level={post.author.level} />
                    )}
                  </div>
                  {!isNotice ? <p className="mt-1 text-[11px] tabular-nums text-slate-400">학번 {post.author.studentId}</p> : null}
                </div>
              </div>
              {isNotice ? (
                <Link
                  href="/search?q=이용+원칙"
                  className="mt-5 inline-flex h-9 w-full items-center justify-center gap-1.5 border border-slate-300 text-xs font-bold text-slate-600 hover:border-slate-500"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  운영 원칙 보기
                </Link>
              ) : demoMode ? (
                <>
                  <dl className="mt-5 grid grid-cols-2 border-y border-slate-100 py-4 text-center">
                    <div className="border-r border-slate-100">
                      <dt className="text-[10px] text-slate-400">받은 추천</dt>
                      <dd className="mt-1 text-sm font-black tabular-nums text-slate-800">
                        1,248
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-slate-400">보유 IGK</dt>
                      <dd className="mt-1 text-sm font-black tabular-nums text-blue-700">
                        2,915
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center gap-1.5 border border-slate-300 text-xs font-bold text-slate-600 hover:border-slate-500"
                    >
                      <User className="h-3.5 w-3.5" aria-hidden="true" />
                      프로필
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center gap-1.5 border border-blue-200 bg-blue-50 text-xs font-bold text-blue-700 hover:border-blue-400"
                    >
                      <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                      IGK 선물
                    </button>
                  </div>
                </>
              ) : null}
            </section>

            {relatedPosts.length > 0 && (
              <section className="border border-slate-200 bg-white p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-black text-slate-900">
                    같이 읽으면 좋은 글
                  </h2>
                  {board && (
                    <Link
                      href={`/boards/${board.slug}`}
                      className="text-[10px] font-bold text-slate-400 hover:text-emerald-700"
                    >
                      더보기
                    </Link>
                  )}
                </div>
                <div className="divide-y divide-slate-100 border-t border-slate-900">
                  {relatedPosts.map((item) => (
                    <Link
                      key={item.id}
                      href={`/post/${item.id}`}
                      className="group block py-3.5"
                    >
                      <p className="line-clamp-2 text-xs font-bold leading-5 text-slate-700 group-hover:text-emerald-700">
                        {item.title}
                      </p>
                      <span className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400">
                        <MessageCircle className="h-3 w-3" aria-hidden="true" />
                        {item.comments}
                        <span>·</span>
                        {item.createdAt}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {demoMode && (
              <section className="border border-emerald-200 bg-emerald-50 p-5 sm:col-span-2 xl:col-span-1">
                <div className="flex items-start gap-3">
                  <Bell
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700"
                    aria-hidden="true"
                  />
                  <div>
                    <h2 className="text-sm font-black text-slate-900">
                      새 댓글 알림 받기
                    </h2>
                    <button
                      type="button"
                      onClick={() => setFollowing((value) => !value)}
                      className={cx(
                        "mt-3 inline-flex h-8 items-center gap-1.5 border px-3 text-[11px] font-extrabold",
                        following
                          ? "border-emerald-700 bg-emerald-700 text-white"
                          : "border-emerald-700 bg-white text-emerald-800",
                      )}
                    >
                      {following ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Bell className="h-3 w-3" />
                      )}
                      {following ? "알림 받는 중" : "알림 받기"}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
