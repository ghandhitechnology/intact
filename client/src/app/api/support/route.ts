import type { Prisma, SupportCategory } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  json,
  jsonError,
  paginationMeta,
  parsePagination,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const url = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(url);
    const where = { requesterId: session.user.id };
    const [tickets, total] = await prisma.$transaction([
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          category: true,
          status: true,
          subject: true,
          description: true,
          resolution: true,
          resolvedAt: true,
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);
    return json({ tickets, pagination: paginationMeta(page, pageSize, total) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`support:${session.user.id}`, { limit: 10, windowMs: 24 * 60 * 60 * 1_000 });
    const body = await readJson<Record<string, unknown>>(request, 32 * 1024);
    const categories: SupportCategory[] = ['BUG', 'FEATURE', 'ACCOUNT', 'CONTENT', 'OTHER'];
    const legacyCategoryMap: Record<string, SupportCategory> = {
      BUG: 'BUG',
      SUGGESTION: 'FEATURE',
      CONTENT: 'CONTENT',
      HARASSMENT: 'CONTENT',
      PRIVACY: 'CONTENT',
    };
    const category = categories.includes(body.category as SupportCategory)
      ? (body.category as SupportCategory)
      : typeof body.reason === 'string'
        ? legacyCategoryMap[body.reason]
        : undefined;
    if (!category) {
      throw new ApiError(400, 'INVALID_CATEGORY', '문의 유형이 올바르지 않습니다.');
    }
    const subject =
      body.subject === undefined
        ? `${category} 문의`
        : requiredString(body.subject, '문의 제목', { min: 2, max: 180 });
    const description = requiredString(body.description, '문의 내용', { min: 10, max: 10_000, trim: false }).trim();
    const metadata: Prisma.InputJsonObject = {
      ...(typeof (body.pageUrl ?? body.targetUrl) === 'string'
        ? { pageUrl: String(body.pageUrl ?? body.targetUrl).slice(0, 2_048) }
        : {}),
      userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? 'unknown',
    };
    const ticket = await prisma.supportTicket.create({
      data: {
        requesterId: session.user.id,
        category,
        subject,
        description,
        metadata,
      },
    });
    return json({ ticket }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
