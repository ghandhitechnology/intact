import prisma from '@/lib/prisma';
import { ApiError, json, jsonError, requiredInteger } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const url = new URL(request.url);
    const board = url.searchParams.get('board')?.trim();
    if (board && board.length > 64) {
      throw new ApiError(400, 'VALIDATION_ERROR', '게시판 값이 너무 깁니다.');
    }
    const limit = requiredInteger(url.searchParams.get('limit') ?? 20, 'limit', 1, 50);
    const drafts = await prisma.post.findMany({
      where: {
        authorId: session.user.id,
        status: 'DRAFT',
        ...(board ? { board: { slug: board, status: 'ACTIVE' } } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        title: true,
        content: true,
        tags: true,
        board: { select: { slug: true, name: true } },
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            scanStatus: true,
          },
        },
      },
    });
    return json({ drafts });
  } catch (error) {
    return jsonError(error);
  }
}
