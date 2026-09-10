'use client';

import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';

type IntentLinkProps = ComponentProps<typeof NextLink>;

function canWarmData() {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return !connection?.saveData && connection?.effectiveType !== '2g' && connection?.effectiveType !== 'slow-2g';
}

export default function IntentLink({
  href,
  prefetch = false,
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: IntentLinkProps) {
  const router = useRouter();
  const destination = typeof href === 'string' ? href : href.pathname || '';

  const warm = () => {
    if (!destination.startsWith('/')) return;
    router.prefetch(destination);
    if (destination.startsWith('/messages') && canWarmData()) {
      void import('socket.io-client').catch(() => undefined);
    }
  };

  return (
    <NextLink
      href={href}
      {...props}
      prefetch={prefetch}
      onPointerEnter={(event) => { onPointerEnter?.(event); warm(); }}
      onFocus={(event) => { onFocus?.(event); warm(); }}
      onTouchStart={(event) => { onTouchStart?.(event); warm(); }}
    />
  );
}
