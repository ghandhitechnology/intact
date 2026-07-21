"use client";

import { X } from "lucide-react";

export default function PreviewCloseButton() {
  function closePreview() {
    if (window.opener) {
      window.close();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign("/");
  }

  return (
    <button
      type="button"
      onClick={closePreview}
      className="grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-white/5 transition-all hover:border-white hover:bg-white hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      aria-label="미리보기 닫기"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
