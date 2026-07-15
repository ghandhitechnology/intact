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

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (
    process.env.PORTAL_DEMO_MODE === 'true' ||
    isPublicAsset(pathname) ||
    PUBLIC_ROUTES.has(pathname) ||
    pathname.startsWith('/api/')
  ) {
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
