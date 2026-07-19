// The admin cookie is deliberately scoped to /api/admin. Keep board mutations
// under that boundary while sharing the validated implementation.
export { POST } from '../../boards/route';

export const runtime = 'nodejs';
