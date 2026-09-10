/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, type ComponentType } from "react";
import { Image as ImageIcon } from "lucide-react";
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

type LightboxProps = {
  images: GalleryAttachment[];
  onClose: () => void;
};

let lightboxImport: Promise<{ default: ComponentType<LightboxProps> }> | null = null;

function loadLightbox() {
  if (!lightboxImport) {
    lightboxImport = import("./AttachmentLightbox").catch((cause) => {
      lightboxImport = null;
      throw cause;
    });
  }
  return lightboxImport;
}

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
  const [Lightbox, setLightbox] = useState<ComponentType<LightboxProps> | null>(null);
  const [lightboxFailed, setLightboxFailed] = useState(false);

  if (!images.length) return null;
  const visible = images.slice(0, compact ? 4 : 6);

  function warmLightbox() {
    void loadLightbox().catch(() => undefined);
  }

  function openLightbox() {
    setOpen(true);
    setLightboxFailed(false);
    if (Lightbox) return;
    void loadLightbox()
      .then((module) => setLightbox(() => module.default))
      .catch(() => setLightboxFailed(true));
  }

  return (
    <>
      <button
        type="button"
        onClick={openLightbox}
        onPointerEnter={warmLightbox}
        onFocus={warmLightbox}
        onTouchStart={warmLightbox}
        className={cx(
          "group relative grid w-full overflow-hidden rounded-2xl bg-slate-100 text-left shadow-[var(--shadow-xs)] transition-shadow duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
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
              loading={!compact && index === 0 ? "eager" : "lazy"}
              fetchPriority={!compact && index === 0 ? "high" : "auto"}
              decoding="async"
              width={attachment.width || undefined}
              height={attachment.height || undefined}
              style={attachment.blurDataUrl ? { backgroundImage: `url(${attachment.blurDataUrl})`, backgroundSize: "cover" } : undefined}
              className="h-full w-full object-cover transition-opacity duration-150"
            />
            {index === visible.length - 1 && images.length > visible.length ? (
              <span className="absolute inset-0 grid place-items-center bg-slate-950/55 text-2xl font-bold text-white backdrop-blur-[1px]">
                +{images.length - visible.length}
              </span>
            ) : null}
          </span>
        ))}
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-slate-950/70 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm transition-colors duration-150 group-hover:bg-slate-950/85">
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          {images.length}장 펼쳐 보기
        </span>
      </button>

      {open && Lightbox ? (
        <Lightbox images={images} onClose={() => setOpen(false)} />
      ) : null}
      {open && lightboxFailed ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
          role="alert"
        >
          <span className="font-semibold">사진 뷰어를 열지 못했습니다.</span>
          <button
            type="button"
            onClick={openLightbox}
            className="font-bold text-amber-900 underline underline-offset-2"
          >
            다시 시도
          </button>
          <a
            href={previewPageUrl(images[0])}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-blue-700 underline underline-offset-2"
          >
            새 탭으로 열기
          </a>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto font-semibold text-slate-500"
          >
            닫기
          </button>
        </div>
      ) : null}
    </>
  );
}
