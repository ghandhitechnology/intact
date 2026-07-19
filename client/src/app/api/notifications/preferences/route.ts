import type { NotificationType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { ApiError, assertSameOrigin, json, jsonError, readJson } from '@/lib/server/http';
import {
  DEFAULT_QUIET_HOURS,
  NOTIFICATION_TYPES,
  effectiveChannels,
  parseQuietHours,
} from '@/lib/server/notifications';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PreferenceInput = {
  type?: unknown;
  inAppEnabled?: unknown;
  pushEnabled?: unknown;
};

function normalizedPreferences(
  rows: Array<{ type: NotificationType; inAppEnabled: boolean; pushEnabled: boolean }>,
) {
  const byType = new Map(rows.map((row) => [row.type, row]));
  return NOTIFICATION_TYPES.map((type) => ({ type, ...effectiveChannels(type, byType.get(type)) }));
}

function quietHoursFromSetting(setting: {
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timeZone: string;
} | null) {
  return setting
    ? {
        enabled: setting.quietHoursEnabled,
        start: setting.quietHoursStart,
        end: setting.quietHoursEnd,
        timeZone: setting.timeZone,
      }
    : DEFAULT_QUIET_HOURS;
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const [preferences, setting] = await Promise.all([
      prisma.notificationPreference.findMany({
        where: { userId: session.user.id },
        select: { type: true, inAppEnabled: true, pushEnabled: true },
        orderBy: { type: 'asc' },
      }),
      prisma.notificationSetting.findUnique({
        where: { userId: session.user.id },
        select: {
          quietHoursEnabled: true,
          quietHoursStart: true,
          quietHoursEnd: true,
          timeZone: true,
        },
      }),
    ]);
    return json({
      preferences: normalizedPreferences(preferences),
      quietHours: quietHoursFromSetting(setting),
      quietHoursPersistent: true,
      mandatoryTypes: ['SANCTION'],
      mandatorySystemCategory: 'SECURITY',
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ preferences?: unknown; quietHours?: unknown }>(request, 32_768);
    if (!Array.isArray(body.preferences)) {
      throw new ApiError(400, 'INVALID_PREFERENCES', '알림 설정 목록이 필요합니다.');
    }
    const byType = new Map<NotificationType, { inAppEnabled: boolean; pushEnabled: boolean }>();
    for (const raw of body.preferences.slice(0, NOTIFICATION_TYPES.length)) {
      const item = raw as PreferenceInput;
      if (!NOTIFICATION_TYPES.includes(item.type as NotificationType)) {
        throw new ApiError(400, 'INVALID_NOTIFICATION_TYPE', '알림 유형이 올바르지 않습니다.');
      }
      if (typeof item.inAppEnabled !== 'boolean' || typeof item.pushEnabled !== 'boolean') {
        throw new ApiError(400, 'INVALID_NOTIFICATION_CHANNEL', '알림 채널 설정이 올바르지 않습니다.');
      }
      const type = item.type as NotificationType;
      byType.set(type, effectiveChannels(type, {
        inAppEnabled: item.inAppEnabled,
        pushEnabled: item.pushEnabled,
      } as { inAppEnabled: boolean; pushEnabled: boolean }));
    }
    const quietHours = body.quietHours === undefined
      ? DEFAULT_QUIET_HOURS
      : parseQuietHours(body.quietHours);
    await prisma.$transaction(
      [
        ...Array.from(byType, ([type, channels]) =>
          prisma.notificationPreference.upsert({
            where: { userId_type: { userId: session.user.id, type } },
            update: channels,
            create: { userId: session.user.id, type, ...channels },
          }),
        ),
        prisma.notificationSetting.upsert({
          where: { userId: session.user.id },
          update: {
            quietHoursEnabled: quietHours.enabled,
            quietHoursStart: quietHours.start,
            quietHoursEnd: quietHours.end,
            timeZone: quietHours.timeZone,
          },
          create: {
            userId: session.user.id,
            quietHoursEnabled: quietHours.enabled,
            quietHoursStart: quietHours.start,
            quietHoursEnd: quietHours.end,
            timeZone: quietHours.timeZone,
          },
        }),
      ],
    );
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: session.user.id },
      select: { type: true, inAppEnabled: true, pushEnabled: true },
      orderBy: { type: 'asc' },
    });
    return json({
      preferences: normalizedPreferences(preferences),
      quietHours,
      quietHoursPersistent: true,
      mandatoryTypes: ['SANCTION'],
      mandatorySystemCategory: 'SECURITY',
    });
  } catch (error) {
    return jsonError(error);
  }
}
