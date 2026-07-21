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
import { igkLevelLabel, type IgkStanding } from "@/lib/igk-levels";

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
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const sizes = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-7 w-7 text-xs",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  };
  const rank = member.standing?.rank ?? member.igkRank ?? null;
  const initials = member.initials === '#'
    ? member.nickname.replace(/^#/, '').slice(0, 1)
    : member.initials;

  return (
    <span
      className="relative inline-flex shrink-0"
      aria-label={rank ? `${member.nickname}, ${rank}짱` : member.nickname}
    >
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex items-center justify-center rounded-full border bg-cover bg-center font-bold",
          sizes[size],
          avatarStyles[member.accent],
          member.level >= 10 && "top-level-avatar",
          Boolean(rank) && "ring-1 ring-blue-600 ring-offset-1 ring-offset-white",
          member.cosmetics?.avatarRing,
        )}
        style={
          member.profileImage
            ? { backgroundImage: `url(${member.profileImage})` }
            : undefined
        }
      >
        {member.profileImage ? null : initials}
      </span>
      {rank ? (
        <span
          className={cx(
            "absolute -bottom-1 -right-1 grid min-w-3.5 place-items-center rounded-full border-2 border-white bg-blue-700 px-0.5 font-black leading-none text-white shadow-sm",
            size === "xs" ? "h-3.5 text-[8px]" : "h-4 text-[9px]",
          )}
          aria-hidden="true"
        >
          {rank}
        </span>
      ) : null}
    </span>
  );
}

export function LevelBadge({ level, standing }: { level: number; standing?: IgkStanding | null; igkRank?: number | null }) {
  const tierLabel = standing?.tierLabel ?? igkLevelLabel(level);
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-800">{tierLabel}</span>
  );
}

export function MemberLine({
  member,
  compact = false,
}: {
  member: Member;
  compact?: boolean;
}) {
  const name = (
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
  );

  if (compact) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2 text-xs text-slate-500">
        <Avatar member={member} size="xs" />
        <span className="min-w-0 leading-none">
          <span className="block min-w-0 truncate leading-4">{name}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 leading-4">
            {member.studentId !== '------' ? (
              <span className="shrink-0 tabular-nums text-slate-400">{member.studentId}</span>
            ) : null}
            {member.studentId === "ADMIN" ? (
              <span className="font-semibold text-slate-700">운영자</span>
            ) : (
              <span className="truncate font-semibold text-emerald-800">
                {member.standing?.tierLabel ?? igkLevelLabel(member.level)}
              </span>
            )}
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
      <Avatar member={member} size="sm" />
      {name}
      {member.studentId !== '------' ? (
        <span className="shrink-0 tabular-nums text-slate-400">
          {member.studentId}
        </span>
      ) : null}
      {member.studentId === "ADMIN" ? (
        <span className="inline-flex h-5 items-center rounded-full bg-slate-900 px-2 text-[11px] font-semibold text-white">
          운영자
        </span>
      ) : (
        <LevelBadge level={member.level} standing={member.standing} igkRank={member.igkRank} />
      )}
      {member.cosmetics?.title ? (
        <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-amber-50 px-2 text-[11px] font-semibold text-amber-800">
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
    sm: "h-8 w-8",
    md: "h-9 w-9",
    lg: "h-11 w-11",
  };

  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50/70 text-emerald-800",
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
      className="inline-flex h-6 items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-600 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
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
    <div className="anim-rise flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-slate-950 sm:text-[30px]">
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
        <h2 className="text-base font-bold tracking-[-0.02em] text-slate-900 sm:text-lg">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        )}
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-emerald-700"
        >
          전체 보기
        </Link>
      )}
    </div>
  );
}

export function DeadlineBadge({ deadline }: { deadline: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
      <CalendarDays className="h-3 w-3" aria-hidden="true" />
      {deadline}
    </span>
  );
}

export function SolvedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
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
