'use client';

import { useEffect, useState } from 'react';

export default function NetworkStatus() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[200] border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-bold text-amber-950" role="status" aria-live="polite">
      인터넷 연결 없음 · 저장되지 않은 입력은 화면에 유지됩니다.
    </div>
  );
}
