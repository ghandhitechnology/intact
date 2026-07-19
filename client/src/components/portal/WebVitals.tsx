'use client';

import { useReportWebVitals } from 'next/web-vitals';

function shouldSample() {
  const key = 'intact:perf-sample:v1';
  const saved = sessionStorage.getItem(key);
  if (saved) return saved === '1';
  const sampled = Math.random() < 0.1;
  sessionStorage.setItem(key, sampled ? '1' : '0');
  return sampled;
}

function report(metric: Parameters<Parameters<typeof useReportWebVitals>[0]>[0]) {
  if (!shouldSample()) return;
  const payload = JSON.stringify({
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    navigationType: metric.navigationType,
    path: window.location.pathname,
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/performance/vitals', new Blob([payload], { type: 'application/json' }));
  } else {
    void fetch('/api/performance/vitals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    });
  }
}

export default function WebVitals() {
  useReportWebVitals(report);
  return null;
}
