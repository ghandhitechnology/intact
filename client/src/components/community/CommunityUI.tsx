import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  FileText,
  HelpCircle,
  MessageCircle,
  Microscope,
  ThumbsUp,
  Users,
} from "lucide-react";
import type {
  BoardDefinition,
  BoardSlug,
  Member,
  PostSummary,
} from "./demo-data";
import { formatNumber, getBoard } from "./demo-data";

const avatarStyles: Record<Member["accent"], string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
};

const boardStyles: Record<
  BoardDefinition["accent"],
  { icon: string; soft: string; line: string; text: string }
> = {
  emerald: {
    icon: "border-emerald-200 bg-emerald-50 text-emerald-700",
    soft: "bg-emerald-50 text-emerald-800",
    line: "border-t-emerald-500",
    text: "text-emerald-700",
  },
  blue: {
    icon: "border-blue-200 bg-blue-50 text-blue-700",
    soft: "bg-blue-50 text-blue-800",
    line: "border-t-blue-500",
    text: "text-blue-700",
  },
  teal: {
    icon: "border-teal-200 bg-teal-50 text-teal-700",
    soft: "bg-teal-50 text-teal-800",
    line: "border-t-teal-500",
    text: "text-teal-700",
  },
  indigo: {
    icon: "border-indigo-200 bg-indigo-50 text-indigo-700",
    soft: "bg-indigo-50 text-indigo-800",
    line: "border-t-indigo-500",
    text: "text-indigo-700",
  },
};

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Avatar({
  member,
  size = "md",
}: {
  member: Member;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-7 w-7 text-[11px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  };

  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full border bg-cover bg-center font-bold",
        sizes[size],
        avatarStyles[member.accent],
      )}
      style={
        member.profileImage
          ? { backgroundImage: `url(${member.profileImage})` }
          : undefined
      }
    >
      {member.profileImage ? (
        <span className="sr-only">{member.nickname} 프로필 이미지</span>
      ) : (
        member.initials
      )}
    </span>
  );
}

export function LevelBadge({ level }: { level: number }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-extrabold tracking-tight text-emerald-700">
      LV.{level}
    </span>
  );
}

export function MemberLine({
  member,
  compact = false,
}: {
  member: Member;
  compact?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
      {!compact && <Avatar member={member} size="sm" />}
      <span className="truncate font-semibold text-slate-700">
        {member.nickname}
      </span>
      <span className="shrink-0 tabular-nums text-slate-400">
        {member.studentId}
      </span>
      {member.studentId === "ADMIN" ? (
        <span className="inline-flex h-5 items-center bg-slate-900 px-1.5 text-[10px] font-extrabold text-white">
          운영자
        </span>
      ) : (
        <LevelBadge level={member.level} />
      )}
    </span>
  );
}

export function BoardIcon({
  board,
  className,
}: {
  board: BoardDefinition;
  className?: string;
}) {
  const iconClassName = className ?? "h-5 w-5";
  const icons = {
    question: <HelpCircle className={iconClassName} strokeWidth={1.8} />,
    contest: <Users className={iconClassName} strokeWidth={1.8} />,
    resources: <FileText className={iconClassName} strokeWidth={1.8} />,
    equipment: <Microscope className={iconClassName} strokeWidth={1.8} />,
    free: <MessageCircle className={iconClassName} strokeWidth={1.8} />,
  };

  return icons[board.icon];
}

export function BoardMark({
  board,
  size = "md",
}: {
  board: BoardDefinition;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-12 w-12",
  };

  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md border",
        sizes[size],
        boardStyles[board.accent].icon,
      )}
    >
      <BoardIcon
        board={board}
        className={size === "lg" ? "h-6 w-6" : "h-5 w-5"}
      />
    </span>
  );
}

export function BoardBadge({ slug }: { slug: BoardSlug }) {
  const board = getBoard(slug);
  if (!board) return null;

  return (
    <Link
      href={`/boards/${board.slug}`}
      className={cx(
        "inline-flex h-6 items-center rounded-full px-2 text-[11px] font-bold transition-opacity hover:opacity-70",
        boardStyles[board.accent].soft,
      )}
    >
      {board.shortTitle}
    </Link>
  );
}

export function PostMetrics({ post }: { post: PostSummary }) {
  return (
    <span className="inline-flex items-center gap-3 text-[11px] tabular-nums text-slate-400">
      <span className="inline-flex items-center gap-1" title="추천">
        <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
        {formatNumber(post.likes)}
      </span>
      <span className="inline-flex items-center gap-1" title="댓글">
        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {formatNumber(post.comments)}
      </span>
    </span>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-slate-200 pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-black tracking-[-0.035em] text-slate-950 sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  href,
}: {
  title: string;
  description?: string;
  href?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-base font-black tracking-[-0.025em] text-slate-900 sm:text-lg">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        )}
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-emerald-700"
        >
          전체 보기
        </Link>
      )}
    </div>
  );
}

export function DeadlineBadge({ deadline }: { deadline: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-blue-50 px-2 py-1 text-[11px] font-extrabold text-blue-700">
      <CalendarDays className="h-3 w-3" aria-hidden="true" />
      {deadline}
    </span>
  );
}

export function SolvedBadge() {
  return (
    <span className="inline-flex items-center bg-emerald-50 px-2 py-1 text-[11px] font-extrabold text-emerald-700">
      해결됨
    </span>
  );
}

export function EditorialRule() {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-500">
      <BookOpen className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      실명·학번 공개
    </span>
  );
}

export { boardStyles };
