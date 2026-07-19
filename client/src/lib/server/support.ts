import type { SupportStatus } from '@prisma/client';
import { ApiError } from './http';

export const SUPPORT_STATUSES: SupportStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

const STATUS_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: ['OPEN'],
};

export function canAccessSupportTicket(input: {
  requesterId: string;
  viewerId: string;
  isAdmin?: boolean;
}) {
  return input.isAdmin === true || input.requesterId === input.viewerId;
}

export function assertSupportTicketAccess<T extends { requesterId: string }>(
  ticket: T | null,
  viewerId: string,
  isAdmin = false,
): asserts ticket is T {
  if (!ticket || !canAccessSupportTicket({ requesterId: ticket.requesterId, viewerId, isAdmin })) {
    // Do not reveal whether another requester's ticket exists.
    throw new ApiError(404, 'SUPPORT_TICKET_NOT_FOUND', '문의를 찾을 수 없습니다.');
  }
}

export function canTransitionSupportStatus(from: SupportStatus, to: SupportStatus) {
  return from === to || STATUS_TRANSITIONS[from].includes(to);
}

export function assertSupportStatusTransition(from: SupportStatus, to: SupportStatus) {
  if (!canTransitionSupportStatus(from, to)) {
    throw new ApiError(409, 'INVALID_STATUS_TRANSITION', `${from} 상태에서 ${to} 상태로 변경할 수 없습니다.`);
  }
}

export function statusAfterRequesterReply(status: SupportStatus): SupportStatus {
  if (status === 'CLOSED') {
    throw new ApiError(409, 'SUPPORT_TICKET_CLOSED', '종료된 문의에는 답글을 추가할 수 없습니다.');
  }
  return status === 'RESOLVED' ? 'OPEN' : status;
}

export function supportTicketHref(ticketId: string, admin = false) {
  const base = admin ? '/admin/support' : '/support';
  return `${base}?ticket=${encodeURIComponent(ticketId)}`;
}

export function supportReplyDedupeKey(ticketId: string, authorId: string, clientMessageId: string) {
  return `support-reply:${ticketId}:${authorId}:${clientMessageId}`;
}
