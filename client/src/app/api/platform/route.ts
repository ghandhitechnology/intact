import { json, jsonError } from '@/lib/server/http';
import { getPlatformMode } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (process.env.PORTAL_DEMO_MODE === 'true') {
      return json(
        { bSideEnabled: false, maintenanceEnabled: false, version: 'demo' },
        200,
        { 'Cache-Control': 'no-store' },
      );
    }
    const mode = await getPlatformMode();
    return json(
      {
        bSideEnabled: mode.bSideEnabled,
        maintenanceEnabled: mode.maintenanceEnabled,
        version: `${mode.bSideEpoch}:${mode.updatedAt.getTime()}`,
      },
      200,
      { 'Cache-Control': 'no-store' },
    );
  } catch (error) {
    return jsonError(error);
  }
}
