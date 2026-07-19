'use client';

import { useEffect } from 'react';

export default function PwaRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV === 'production' &&
      'serviceWorker' in navigator &&
      window.isSecureContext
    ) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // PWA support is an enhancement; the portal remains usable without it.
      });
    }
  }, []);

  return null;
}
