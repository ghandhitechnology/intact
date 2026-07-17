import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  FileText,
  HelpCircle,
  MessageCircle,
  Microscope,
  Image as ImageIcon,
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
import { igkLevelLabel, igkRankLabel, type IgkStanding } from "@/lib/igk-levels";

const avatarStyles: Record<Member["accent"], string> = {
  emerald: "border-emerald-300 bg-white text-emerald-800",
  blue: "border-blue-300 bg-white text-blue-800",
  slate: "border-slate-300 bg-white text-slate-700",
  violet: "border-violet-300 bg-white text-violet-800",
  amber: "border-amber-300 bg-white text-amber-800",
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
    icon: "border-slate-200 bg-slate-50 text-emerald-700",
    soft: "bg-slate-100 text-slate-700",
    line: "border-t-emerald-500",
    text: "text-emerald-700",
  },
  teal: {
    icon: "border-slate-200 bg-slate-50 text-emerald-700",
    soft: "bg-slate-100 text-slate-700",
    line: "border-t-emerald-500",
    text: "text-emerald-700",
  },
  indigo: {
    icon: "border-slate-200 bg-slate-50 text-emerald-700",
    soft: "bg-slate-100 text-slate-700",
    line: "border-t-emerald-500",
    text: "text-emerald-700",
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
    sm: "h-7 w-7 text-xs",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  };
  const initials = member.initials === '#'
    ? member.nickname.replace(/^#/, '').slice(0, 1)
    : member.initials;

  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full border bg-cover bg-center font-bold",
        sizes[size],
        avatarStyles[member.accent],
        member.level >= 10 && "top-level-avatar",
        member.cosmetics?.avatarRing,
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
        initials
      )}
    </span>
  );
}

export function LevelBadge({ level, standing, igkRank }: { level: number; standing?: IgkStanding | null; igkRank?: number | null }) {
  const tierLabel = standing?.tierLabel ?? igkLevelLabel(level);
  const rankLabel = standing?.rankLabel ?? igkRankLabel(igkRank);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex h-5 items-center border-l-2 border-emerald-700 pl-1.5 text-xs font-semibold text-emerald-800">{tierLabel}</span>
      {rankLabel ? <span className="inline-flex h-5 items-center border-l-2 border-blue-700 pl-1.5 text-xs font-semibold text-blue-800">{rankLabel}</span> : null}
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
      <span
        className={cx(
          "truncate font-medium text-slate-700",
          member.nickname.startsWith('#') && "font-mono tracking-wide",
        )}
        style={
          member.cosmetics?.nicknameColor
            ? { color: member.cosmetics.nicknameColor }
            : undefined
        }
      >
        {member.nickname}
      </span>
      {member.studentId !== '------' ? (
        <span className="shrink-0 tabular-nums text-slate-400">
          {member.studentId}
        </span>
      ) : null}
      {member.studentId === "ADMIN" ? (
        <span className="inline-flex h-5 items-center rounded-sm bg-slate-900 px-1.5 text-xs font-semibold text-white">
          운영자
        </span>
      ) : (
        <LevelBadge level={member.level} standing={member.standing} igkRank={member.igkRank} />
      )}
      {member.cosmetics?.title ? (
        <span className="inline-flex h-5 shrink-0 items-center border-l-2 border-amber-500 pl-1.5 text-xs font-semibold text-amber-800">
          {member.cosmetics.title}
        </span>
      ) : null}
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
    photos: <ImageIcon className={iconClassName} strokeWidth={1.8} />,
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
    sm: "h-7 w-7",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };

  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center text-emerald-800",
        sizes[size],
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
      className="inline-flex h-6 items-center border-b border-slate-300 text-xs font-semibold text-slate-600 transition-colors hover:border-emerald-700 hover:text-emerald-800"
    >
      {board.shortTitle}
    </Link>
  );
}

export function PostMetrics({ post }: { post: PostSummary }) {
  return (
    <span className="inline-flex items-center gap-3 text-xs tabular-nums text-slate-400">
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
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-300 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 sm:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
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
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-base font-bold tracking-[-0.015em] text-slate-900 sm:text-lg">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-slate-600">{description}</p>
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
    <span className="inline-flex items-center gap-1 border-l-2 border-blue-600 pl-1.5 text-xs font-semibold text-blue-800">
      <CalendarDays className="h-3 w-3" aria-hidden="true" />
      {deadline}
    </span>
  );
}

export function SolvedBadge() {
  return (
    <span className="inline-flex items-center border-l-2 border-emerald-700 pl-1.5 text-xs font-semibold text-emerald-800">
      해결됨
    </span>
  );
}

export function EditorialRule() {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-500">
      <BookOpen className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      인증 계정
    </span>
  );
}

export { boardStyles };
