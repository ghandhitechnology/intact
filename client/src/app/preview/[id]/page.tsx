/* eslint-disable @next/next/no-img-element */

import { Download } from "lucide-react";
import PreviewCloseButton from "./PreviewCloseButton";

type PreviewPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ name?: string; type?: string }>;
};

const IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const dynamic = "force-dynamic";

export default async function PreviewPage({ params, searchParams }: PreviewPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const mimeType = typeof query.type === "string" ? query.type.toLowerCase() : "application/octet-stream";
  const fileName = typeof query.name === "string" && query.name.trim() ? query.name : "첨부 파일";
  const fileUrl = `/api/uploads/${encodeURIComponent(id)}`;
  const downloadUrl = `${fileUrl}?download=1`;

  return (
    <main id="main-content" className="flex min-h-dvh flex-col bg-black text-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/20 bg-black px-4 sm:px-6">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{fileName}</h1>
        <a
          href={downloadUrl}
          className="inline-flex h-9 items-center gap-2 border border-white/30 px-3 text-xs font-semibold hover:bg-white hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">원본 받기</span>
        </a>
        <PreviewCloseButton />
      </header>

      <section className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black" aria-label="파일 내용">
        {IMAGE_TYPES.has(mimeType) ? (
          <img src={fileUrl} alt={fileName} className="max-h-[calc(100dvh-3.5rem)] max-w-full object-contain" />
        ) : mimeType.startsWith("video/") ? (
          <video src={fileUrl} controls className="max-h-[calc(100dvh-3.5rem)] max-w-full" />
        ) : mimeType.startsWith("audio/") ? (
          <audio src={fileUrl} controls className="w-[min(36rem,calc(100%-2rem))]" />
        ) : (
          <iframe
            src={fileUrl}
            title={`${fileName} 미리보기`}
            className="h-[calc(100dvh-3.5rem)] w-full border-0 bg-black"
          />
        )}
      </section>
    </main>
  );
}
