import prisma from '@/lib/prisma';
import {
  STREAK_FREEZE_ITEM_ID,
  attendanceRewardForStreak,
} from '@/lib/igk-shop';
import { awardIgk, lockIgkAccounts, seoulCalendarDate, seoulDateKey } from '@/lib/server/igk';
import { ApiError, assertSameOrigin, json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { isRetryableTransactionError } from '@/lib/server/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayDifference(today: Date, last: Date | null) {
  if (!last) return null;
  return Math.round((today.getTime() - last.getTime()) / DAY_MS);
}

async function freezeQuantity(client: Pick<typeof prisma, 'userItem'>, userId: string) {
  const freeze = await client.userItem.findUnique({
    where: { userId_itemId: { userId, itemId: STREAK_FREEZE_ITEM_ID } },
    select: { quantity: true },
  });
  return freeze?.quantity ?? 0;
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const [user, freezeCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { attendanceStreak: true, bestAttendanceStreak: true, lastAttendanceDate: true },
      }),
      freezeQuantity(prisma, session.user.id),
    ]);
    const today = seoulCalendarDate();
    const gap = dayDifference(today, user.lastAttendanceDate);
    const claimedToday = gap === 0;
    const nextStreak = claimedToday
      ? user.attendanceStreak
      : gap === 1 || (gap === 2 && freezeCount > 0)
        ? user.attendanceStreak + 1
        : 1;
    return json({
      streak: user.attendanceStreak,
      bestStreak: user.bestAttendanceStreak,
      claimedToday,
      todayReward: attendanceRewardForStreak(nextStreak),
      freezeCount,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const today = seoulCalendarDate();
    const dateKey = seoulDateKey();

    let result: {
      streak: number;
      bestStreak: number;
      reward: number;
      balance: number;
      freezeUsed: boolean;
      freezeCount: number;
    } | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await prisma.$transaction(
          async (tx) => {
            await lockIgkAccounts(tx, [session.user.id]);
            const user = await tx.user.findUniqueOrThrow({
              where: { id: session.user.id },
              select: {
                attendanceStreak: true,
                bestAttendanceStreak: true,
                lastAttendanceDate: true,
              },
            });
            const gap = dayDifference(today, user.lastAttendanceDate);
            if (gap === 0) {
              throw new ApiError(409, 'ALREADY_CLAIMED', '오늘은 이미 출석했습니다.');
            }

            let freezeUsed = false;
            let streak = 1;
            if (gap === 1) {
              streak = user.attendanceStreak + 1;
            } else if (gap === 2) {
              // Missed exactly one day: consume a streak freeze if available.
              const consumed = await tx.userItem.updateMany({
                where: {
                  userId: session.user.id,
                  itemId: STREAK_FREEZE_ITEM_ID,
                  quantity: { gte: 1 },
                },
                data: { quantity: { decrement: 1 } },
              });
              if (consumed.count === 1) {
                freezeUsed = true;
                streak = user.attendanceStreak + 1;
              }
            }

            const reward = attendanceRewardForStreak(streak);
            await awardIgk(tx, {
              userId: session.user.id,
              amount: reward,
              type: 'ATTENDANCE_REWARD',
              idempotencyKey: `attendance:${session.user.id}:${dateKey}`,
              sourceType: 'attendance',
              sourceId: dateKey,
              dailyCap: 1_000,
              note: `${streak}일 연속 출석 보상`,
            });

            const bestStreak = Math.max(user.bestAttendanceStreak, streak);
            const updated = await tx.user.update({
              where: { id: session.user.id },
              data: {
                attendanceStreak: streak,
                bestAttendanceStreak: bestStreak,
                lastAttendanceDate: today,
              },
              select: { currentIgk: true },
            });
            const freezeCount = await freezeQuantity(tx, session.user.id);
            return {
              streak,
              bestStreak,
              reward,
              balance: updated.currentIgk,
              freezeUsed,
              freezeCount,
            };
          },
          { isolationLevel: 'Serializable' },
        );
        break;
      } catch (error) {
        if (attempt < 2 && isRetryableTransactionError(error)) continue;
        throw error;
      }
    }
    return json(result!);
  } catch (error) {
    return jsonError(error);
  }
}
