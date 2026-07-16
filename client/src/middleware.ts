import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = new Set([
  '/',
  '/login',
  '/register',
  '/reset-password',
  '/privacy',
  '/rules',
  '/terms',
  '/offline',
  '/admin/login',
]);

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname === '/og.png' ||
    /\.(?:png|jpg|jpeg|webp|gif|ico|css|js|map|woff2?)$/i.test(pathname)
  );
}

function redirectUrl(request: NextRequest, pathname: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(pathname, new URL(configured).origin);
    } catch {
      // Fall back to the request URL so a bad setting does not create an open redirect.
    }
  }
  if (process.env.TRUST_PROXY === 'true') {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    if ((proto === 'https' || proto === 'http') && host && /^[A-Za-z0-9.:[\]-]+$/.test(host)) {
      return new URL(pathname, `${proto}://${host}`);
    }
  }
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  return url;
}

// Maintenance-mode gate ------------------------------------------------------
// The flag lives in PlatformSetting and is read through the public
// /api/platform endpoint (edge middleware cannot use Prisma directly).
// Failures fail-open so a broken lookup never takes the whole site down.

const MAINTENANCE_CACHE_TTL_MS = 5_000;
const ADMIN_VERIFY_CACHE_TTL_MS = 10_000;

let maintenanceCache: { enabled: boolean; expiresAt: number } | null = null;
let pendingMaintenance: Promise<boolean> | null = null;
const adminVerifyCache = new Map<string, { ok: boolean; expiresAt: number }>();

function internalUrl(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  return url;
}

// Self-calls must hit this same Next.js process, not the public hostname the
// proxy forwarded (which may not resolve from inside the container).
function selfApiUrl(request: NextRequest, pathname: string) {
  const base = process.env.INTERNAL_API_URL;
  if (base) {
    try {
      return new URL(pathname, base);
    } catch {
      // Ignore a malformed value and fall back to the request origin.
    }
  }
  return internalUrl(request, pathname);
}

async function maintenanceEnabled(request: NextRequest) {
  if (maintenanceCache && Date.now() < maintenanceCache.expiresAt) {
    return maintenanceCache.enabled;
  }
  if (pendingMaintenance) return pendingMaintenance;
  pendingMaintenance = fetch(selfApiUrl(request, '/api/platform'), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
    .then(async (response) => {
      if (!response.ok) return maintenanceCache?.enabled ?? false;
      const payload = await response.json().catch(() => null);
      const enabled = Boolean(payload?.data?.maintenanceEnabled ?? payload?.maintenanceEnabled);
      maintenanceCache = { enabled, expiresAt: Date.now() + MAINTENANCE_CACHE_TTL_MS };
      return enabled;
    })
    .catch(() => maintenanceCache?.enabled ?? false)
    .finally(() => {
      pendingMaintenance = null;
    });
  return pendingMaintenance;
}

async function verifiedAdmin(request: NextRequest) {
  const token = request.cookies.get('igwak_admin_session')?.value;
  if (!token) return false;
  const cached = adminVerifyCache.get(token);
  if (cached && Date.now() < cached.expiresAt) return cached.ok;
  try {
    const response = await fetch(selfApiUrl(request, '/api/admin/auth/verify'), {
      headers: { cookie: `igwak_admin_session=${token}` },
      cache: 'no-store',
    });
    const ok = response.status === 204;
    adminVerifyCache.set(token, { ok, expiresAt: Date.now() + ADMIN_VERIFY_CACHE_TTL_MS });
    if (adminVerifyCache.size > 100) {
      const now = Date.now();
      for (const [key, entry] of adminVerifyCache) {
        if (entry.expiresAt <= now) adminVerifyCache.delete(key);
      }
    }
    return ok;
  } catch {
    return false;
  }
}

function maintenanceExempt(pathname: string) {
  return (
    pathname === '/maintenance' ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/admin/') ||
    pathname === '/api/platform' ||
    pathname === '/api/health'
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (process.env.PORTAL_DEMO_MODE === 'true' || isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  // Exempt paths must never trigger the /api/platform self-fetch: the nested
  // middleware run for that fetch would await the same in-flight promise and
  // deadlock. They are checked before any maintenance lookup happens.
  if (!maintenanceExempt(pathname)) {
    if ((await maintenanceEnabled(request)) && !(await verifiedAdmin(request))) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { ok: false, error: { code: 'MAINTENANCE', message: '서버 점검 중입니다. 잠시 후 다시 이용해 주세요.' } },
          { status: 503, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      return NextResponse.rewrite(internalUrl(request, '/maintenance'));
    }
  } else if (pathname === '/maintenance' && !(await maintenanceEnabled(request))) {
    return NextResponse.redirect(redirectUrl(request, '/'));
  }

  if (PUBLIC_ROUTES.has(pathname) || pathname === '/maintenance' || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/admin')) {
    if (request.cookies.has('igwak_admin_session')) return NextResponse.next();
    const url = redirectUrl(request, '/admin/login');
    url.searchParams.set('returnTo', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (request.cookies.has('igwak_session')) return NextResponse.next();
  const url = redirectUrl(request, '/login');
  url.searchParams.set('returnTo', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
