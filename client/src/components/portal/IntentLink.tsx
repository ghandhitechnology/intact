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
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: IntentLinkProps) {
  const router = useRouter();
  const destination = typeof href === 'string' ? href : href.pathname || '';

  const warm = () => {
    if (!destination) return;
    router.prefetch(destination);
    if (destination.startsWith('/messages') && canWarmData()) {
      void import('socket.io-client');
      void fetch('/api/chat/rooms').catch(() => undefined);
    }
  };

  return (
    <NextLink
      href={href}
      {...props}
      onPointerEnter={(event) => { onPointerEnter?.(event); warm(); }}
      onFocus={(event) => { onFocus?.(event); warm(); }}
      onTouchStart={(event) => { onTouchStart?.(event); warm(); }}
    />
  );
}
