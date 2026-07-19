/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Image as ImageIcon, X } from "lucide-react";
import { cx } from "./CommunityUI";

export type GalleryAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  blurDataUrl?: string | null;
};

function previewUrl(id: string) {
  return `/api/uploads/${encodeURIComponent(id)}`;
}

function thumbnailUrl(id: string, width: 320 | 640 | 1280 = 640) {
  return `${previewUrl(id)}?variant=thumb&w=${width}`;
}

function previewPageUrl(attachment: GalleryAttachment) {
  const query = new URLSearchParams({
    name: attachment.originalName,
    type: attachment.mimeType,
  });
  return `/preview/${encodeURIComponent(attachment.id)}?${query.toString()}`;
}

function downloadUrl(id: string) {
  return `${previewUrl(id)}?download=1`;
}

export default function AttachmentGallery({
  attachments,
  compact = false,
}: {
  attachments: GalleryAttachment[];
  compact?: boolean;
}) {
  const images = attachments.filter((attachment) =>
    ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(
      attachment.mimeType.toLowerCase(),
    ),
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowRight")
        setSelected((value) => Math.min(images.length - 1, value + 1));
      if (event.key === "ArrowLeft")
        setSelected((value) => Math.max(0, value - 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [images.length, open]);

  if (!images.length) return null;
  const visible = images.slice(0, compact ? 4 : 6);
  const current = images[Math.min(selected, images.length - 1)] ?? images[0];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSelected(0);
          setOpen(true);
        }}
        className={cx(
          "group relative grid w-full overflow-hidden bg-slate-100 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
          compact ? "h-52 grid-cols-2" : "min-h-72 grid-cols-2 sm:h-[460px]",
          visible.length === 1 && "grid-cols-1",
        )}
        aria-label={`${images.length}장의 사진 펼쳐 보기`}
      >
        {visible.map((attachment, index) => (
          <span
            key={attachment.id}
            className={cx(
              "relative min-h-0 overflow-hidden border-white bg-slate-100",
              index % 2 === 0 ? "border-r" : "",
              index < visible.length - 2 ? "border-b" : "",
              visible.length === 3 && index === 0 && "row-span-2",
            )}
          >
            <img
              src={thumbnailUrl(attachment.id)}
              srcSet={`${thumbnailUrl(attachment.id, 320)} 320w, ${thumbnailUrl(attachment.id, 640)} 640w, ${thumbnailUrl(attachment.id, 1280)} 1280w`}
              sizes={compact ? "50vw" : "(max-width: 640px) 50vw, 640px"}
              alt={attachment.originalName}
              loading="lazy"
              decoding="async"
              width={attachment.width || undefined}
              height={attachment.height || undefined}
              style={attachment.blurDataUrl ? { backgroundImage: `url(${attachment.blurDataUrl})`, backgroundSize: "cover" } : undefined}
              className="h-full w-full object-cover"
            />
            {index === visible.length - 1 && images.length > visible.length ? (
              <span className="absolute inset-0 grid place-items-center bg-slate-950/55 text-2xl font-bold text-white">
                +{images.length - visible.length}
              </span>
            ) : null}
          </span>
        ))}
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 bg-black px-3 py-2 text-xs font-bold text-white">
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          {images.length}장 펼쳐 보기
        </span>
      </button>

      {open && current ? (
        <div
          className="fixed inset-0 z-[120] flex bg-black"
          role="dialog"
          aria-modal="true"
          aria-label="사진 미리보기"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="flex min-h-0 w-full flex-col">
            <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/20 bg-black px-4 text-white sm:px-6">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{current.originalName}</p>
                <p className="mt-0.5 text-xs text-white/55">
                  {selected + 1} / {images.length} · {(current.sizeBytes / 1_048_576).toFixed(1)}MB
                </p>
              </div>
              <a
                href={previewPageUrl(current)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2  border border-white/20 px-3 text-xs font-bold hover:bg-white/10"
              >
                <ExternalLink className="h-4 w-4" />
                <span className="hidden sm:inline">새 탭</span>
              </a>
              <a
                href={downloadUrl(current.id)}
                className="inline-flex h-10 items-center gap-2  border border-white/20 px-3 text-xs font-bold hover:bg-white/10"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">원본 받기</span>
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-10 w-10 place-items-center  border border-white/20 hover:bg-white/10"
                aria-label="미리보기 닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col bg-black md:flex-row">
              <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-3 sm:p-6">
                <img
                  src={previewUrl(current.id)}
                  alt={current.originalName}
                  decoding="async"
                  width={current.width || undefined}
                  height={current.height || undefined}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <aside className="max-h-32 shrink-0 overflow-auto border-t border-white/20 bg-black p-3 md:max-h-none md:w-64 md:border-l md:border-t-0">
                <div className="flex gap-2 md:grid md:grid-cols-2">
                  {images.map((attachment, index) => (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={() => setSelected(index)}
                      className={cx(
                        "h-20 w-20 shrink-0 overflow-hidden  border-2 bg-slate-900 md:w-full",
                        index === selected ? "border-violet-400" : "border-transparent opacity-60 hover:opacity-100",
                      )}
                      aria-label={`${index + 1}번째 사진 보기`}
                    >
                      <img
                        src={thumbnailUrl(attachment.id, 320)}
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
        </div>
      ) : null}
    </>
  );
}
