import { POST as createRoom } from '../rooms/route';

export const runtime = 'nodejs';

/** @deprecated Use POST /api/chat/rooms. */
export const POST = createRoom;
