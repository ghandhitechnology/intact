// Canonical profile API used by the portal UI. /api/profile remains as a
// backwards-compatible alias for early clients.
export { GET, PATCH } from '../../profile/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
