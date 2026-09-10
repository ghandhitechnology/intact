/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, X } from "lucide-react";
import { cx } from "./CommunityUI";
import type { GalleryAttachment } from "./AttachmentGallery";

function previewUrl(id: string) {
  return `/api/uploads/${encodeURIComponent(id)}`;
}

function thumbnailUrl(id: string) {
  return `${previewUrl(id)}?variant=thumb&w=320`;
}

function previewPageUrl(attachment: GalleryAttachment) {
  const query = new URLSearchParams({
    name: attachment.originalName,
    type: attachment.mimeType,
  });
  return `/preview/${encodeURIComponent(attachment.id)}?${query.toString()}`;
}

export default function AttachmentLightbox({
  images,
  onClose,
}: {
  images: GalleryAttachment[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const current = images[Math.min(selected, images.length - 1)] ?? images[0];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") {
        setSelected((value) => Math.min(images.length - 1, value + 1));
      }
      if (event.key === "ArrowLeft") {
        setSelected((value) => Math.max(0, value - 1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [images.length, onClose]);

  if (!current) return null;

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-[120] flex bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="사진 미리보기"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex min-h-0 w-full flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 bg-black px-4 text-white sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{current.originalName}</p>
            <p className="mt-0.5 text-xs tabular-nums text-white/55">
              {selected + 1} / {images.length} · {(current.sizeBytes / 1_048_576).toFixed(1)}MB
            </p>
          </div>
          <a
            href={previewPageUrl(current)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 px-3 text-xs font-bold transition-colors duration-200 hover:bg-white/10"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">새 탭</span>
          </a>
          <a
            href={`${previewUrl(current.id)}?download=1`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 px-3 text-xs font-bold transition-colors duration-200 hover:bg-white/10"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">원본 받기</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 transition-colors duration-150 hover:bg-white/10"
            aria-label="미리보기 닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-black md:flex-row">
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-3 sm:p-6">
            <img
              key={current.id}
              src={previewUrl(current.id)}
              alt={current.originalName}
              decoding="async"
              width={current.width || undefined}
              height={current.height || undefined}
              className="anim-fade max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
          <aside className="max-h-32 shrink-0 overflow-auto border-t border-white/10 bg-black p-3 md:max-h-none md:w-64 md:border-l md:border-t-0">
            <div className="flex gap-2 md:grid md:grid-cols-2">
              {images.map((attachment, index) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => setSelected(index)}
                  className={cx(
                    "h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 bg-slate-900 transition-colors duration-150 md:w-full",
                    index === selected
                      ? "border-emerald-400"
                      : "border-transparent opacity-60 hover:opacity-100",
                  )}
                  aria-label={`${index + 1}번째 사진 보기`}
                >
                  <img
                    src={thumbnailUrl(attachment.id)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={attachment.width || undefined}
                    height={attachment.height || undefined}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
