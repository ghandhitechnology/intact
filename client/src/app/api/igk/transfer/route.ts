import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { verifyPassword } from '@/lib/server/crypto';
import { levelForLifetime, lockIgkAccounts } from '@/lib/server/igk';
import {
  ApiError,
  assertSameOrigin,
  json,
  jsonError,
  readJson,
  requiredInteger,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

interface TransferBody {
  recipient?: unknown;
  amount?: unknown;
  note?: unknown;
  password?: unknown;
}

function seoulDayStart() {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 9 * 60 * 60 * 1000);
}

function isRetryableTransactionError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2034';
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<TransferBody>(request, 8_192);
    const recipientIdentifier = requiredString(body.recipient, '받는 사람', { min: 2, max: 32 });
    const amount = requiredInteger(body.amount, '선물할 IGK', 1, 500);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null;
    const requestKey = request.headers.get('idempotency-key')?.trim().slice(0, 100) || randomUUID();
    const recipient = await prisma.user.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [
          { loginId: recipientIdentifier },
          { nickname: recipientIdentifier },
          { studentIdentity: { studentCode: recipientIdentifier } },
        ],
      },
      include: { studentIdentity: { select: { studentCode: true } } },
    });
    if (!recipient) throw new ApiError(404, 'RECIPIENT_NOT_FOUND', '받는 사람을 찾을 수 없습니다.');
    if (recipient.id === session.user.id) {
      throw new ApiError(400, 'SELF_TRANSFER', '자신에게는 IGK를 선물할 수 없습니다.');
    }

    const completed = await prisma.igkLedger.findUnique({
      where: { idempotencyKey: `transfer:sent:${session.user.id}:${requestKey}` },
    });
    if (completed) {
      if (completed.counterpartyId !== recipient.id || completed.amount !== -amount) {
        throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', '같은 요청 키를 다른 IGK 선물에 다시 사용할 수 없습니다.');
      }
      return json({
        transferId: completed.transferId ?? completed.id,
        senderBalance: completed.balanceAfter,
        recipientNickname: recipient.nickname,
      });
    }

    const sentToday = await prisma.igkLedger.aggregate({
      where: {
        userId: session.user.id,
        type: 'TRANSFER_SENT',
        createdAt: { gte: seoulDayStart() },
      },
      _sum: { amount: true },
    });
    const alreadySent = Math.abs(sentToday._sum.amount ?? 0);
    if (alreadySent + amount > 500) {
      throw new ApiError(400, 'DAILY_TRANSFER_LIMIT', '하루에 최대 500 IGK까지 선물할 수 있습니다.');
    }
    let passwordConfirmed = false;
    if (typeof body.password === 'string' && body.password) {
      const password = requiredString(body.password, '비밀번호 확인', {
        min: 1,
        max: 128,
        trim: false,
      });
      const sender = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
      if (!(await verifyPassword(password, sender.passwordHash))) {
        throw new ApiError(401, 'INVALID_PASSWORD', '비밀번호가 올바르지 않습니다.');
      }
      passwordConfirmed = true;
    }
    if (alreadySent + amount >= 100 && !passwordConfirmed) {
      throw new ApiError(401, 'PASSWORD_CONFIRMATION_REQUIRED', '누적 100 IGK 이상 선물하려면 비밀번호를 확인해 주세요.');
    }

    const transferId = randomUUID();
    let result: { transferId: string; senderBalance: number; recipientNickname: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await prisma.$transaction(
          async (tx) => {
            await lockIgkAccounts(tx, [session.user.id, recipient.id]);
            const existing = await tx.igkLedger.findUnique({
              where: { idempotencyKey: `transfer:sent:${session.user.id}:${requestKey}` },
            });
            if (existing) {
              if (existing.counterpartyId !== recipient.id || existing.amount !== -amount) {
                throw new ApiError(
                  409,
                  'IDEMPOTENCY_KEY_REUSED',
                  '같은 요청 키를 다른 IGK 선물에 다시 사용할 수 없습니다.',
                );
              }
              return {
                transferId: existing.transferId ?? transferId,
                senderBalance: existing.balanceAfter,
                recipientNickname: recipient.nickname,
              };
            }
            const concurrentTotal = await tx.igkLedger.aggregate({
              where: {
                userId: session.user.id,
                type: 'TRANSFER_SENT',
                createdAt: { gte: seoulDayStart() },
              },
              _sum: { amount: true },
            });
            const sentInsideTransaction = Math.abs(concurrentTotal._sum.amount ?? 0);
            if (sentInsideTransaction + amount > 500) {
              throw new ApiError(400, 'DAILY_TRANSFER_LIMIT', '하루에 최대 500 IGK까지 선물할 수 있습니다.');
            }
            if (sentInsideTransaction + amount >= 100 && !passwordConfirmed) {
              throw new ApiError(
                401,
                'PASSWORD_CONFIRMATION_REQUIRED',
                '누적 100 IGK 이상 선물하려면 비밀번호를 확인해 주세요.',
              );
            }
            const debited = await tx.user.updateMany({
              where: { id: session.user.id, status: 'ACTIVE', currentIgk: { gte: amount } },
              data: { currentIgk: { decrement: amount } },
            });
            if (debited.count !== 1) {
              throw new ApiError(400, 'INSUFFICIENT_IGK', '보유 IGK가 부족합니다.');
            }
            const sender = await tx.user.findUniqueOrThrow({ where: { id: session.user.id } });
            const recipientBefore = await tx.user.findUnique({
              where: { id: recipient.id },
              select: { status: true, igkDebt: true },
            });
            if (!recipientBefore || recipientBefore.status !== 'ACTIVE') {
              throw new ApiError(409, 'RECIPIENT_UNAVAILABLE', '받는 사람의 계정이 현재 이용할 수 없습니다.');
            }
            const receiverDebtPayment = Math.min(recipientBefore.igkDebt, amount);
            const receiver = await tx.user.update({
              where: { id: recipient.id },
              data: {
                currentIgk: { increment: amount - receiverDebtPayment },
                lifetimeIgk: { increment: amount },
                igkDebt: { decrement: receiverDebtPayment },
              },
            });
            const receiverLevel = await levelForLifetime(tx, receiver.lifetimeIgk);
            if (receiver.level !== receiverLevel) {
              await tx.user.update({
                where: { id: receiver.id },
                data: { level: receiverLevel },
              });
            }
            await tx.igkLedger.createMany({
              data: [
                {
                  userId: sender.id,
                  counterpartyId: receiver.id,
                  type: 'TRANSFER_SENT',
                  amount: -amount,
                  balanceAfter: sender.currentIgk,
                  lifetimeAfter: sender.lifetimeIgk,
                  transferId,
                  idempotencyKey: `transfer:sent:${sender.id}:${requestKey}`,
                  note,
                },
                {
                  userId: receiver.id,
                  counterpartyId: sender.id,
                  type: 'TRANSFER_RECEIVED',
                  amount,
                  balanceAfter: receiver.currentIgk,
                  lifetimeAfter: receiver.lifetimeIgk,
                  transferId,
                  idempotencyKey: `transfer:received:${receiver.id}:${requestKey}`,
                  note,
                  metadata: receiverDebtPayment ? { debtPayment: receiverDebtPayment } : undefined,
                },
              ],
            });
            await tx.notification.create({
              data: {
                userId: receiver.id,
                actorId: sender.id,
                type: 'SYSTEM',
                title: `${sender.nickname}님이 ${amount} IGK를 선물했습니다.`,
                body: note,
                href: '/igk',
                metadata: { transferId, amount },
              },
            });
            return {
              transferId,
              senderBalance: sender.currentIgk,
              recipientNickname: receiver.nickname,
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
