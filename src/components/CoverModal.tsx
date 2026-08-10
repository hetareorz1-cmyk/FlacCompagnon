// Cover lightbox: the tag panel's artwork at full size, with its dimensions,
// format, weight and picture role underneath.
//
// When the selection has more than one distinct cover, chevrons sit outside
// the image to step through them — unlike the tag panel's own carousel
// (CoverArt.tsx), whose chevrons overlay the artwork because that box has no
// room to spare. The lightbox is full-screen, so there's space to keep them
// off the image entirely. `.cover-modal-body` wraps *only* the image and
// shrinks to its size, with the chevrons absolutely positioned outside it —
// that keeps `.cover-modal-inner`'s own bounding box equal to the image
// alone, which is what `.cover-modal-close` (Modal.tsx) positions itself
// against; a flex row of [chevron, image, chevron] would have widened that
// box and pushed the close button out past the chevron instead of hugging
// the image's corner.

import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { CoverArt } from "../types";
import { coverDataUrl, pictureTypeLabel } from "../format";
import { Modal } from "./Modal";
import "./CoverModal.css";

export interface CoverModalProps {
  /// The full set the current selection's cover came from; empty closes the
  /// lightbox. `index` is which one is shown.
  covers: CoverArt[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

function caption(cover: CoverArt): string {
  const kb = Math.max(1, Math.round(cover.size_bytes / 1024));
  const kind = cover.mime.replace(/^image\//, "").toUpperCase() || "?";
  return `${cover.width}×${cover.height} · ${kind} · ${kb} KB · ${pictureTypeLabel(cover.picture_type)}`;
}

export function CoverModal({ covers, index, onNavigate, onClose }: CoverModalProps) {
  const cover = covers[index] ?? null;
  const url = cover ? coverDataUrl(cover) : null;
  const multiple = covers.length > 1;
  const open = cover != null && url != null;

  // Left/right cycle covers the same way the on-canvas chevrons do; bound
  // only while the lightbox is actually open and there's more than one
  // cover, same guard `Modal`'s own Escape handler uses for the same reason
  // (a closed/absent lightbox shouldn't swallow arrow keys meant for
  // anything else on screen, e.g. the results table).
  useEffect(() => {
    if (!open || !multiple) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowLeft") onNavigate((index - 1 + covers.length) % covers.length);
      else if (ev.key === "ArrowRight") onNavigate((index + 1) % covers.length);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, multiple, index, covers.length, onNavigate]);

  return (
    <Modal open={open} onClose={onClose}>
      {cover && url && (
        <>
          <div className="cover-modal-body">
            <img className="cover-modal-img" src={url} alt="" />
            {multiple && (
              <>
                <button
                  className="cover-modal-nav cover-modal-prev"
                  type="button"
                  title="Previous cover"
                  onClick={() => onNavigate((index - 1 + covers.length) % covers.length)}
                >
                  <ChevronLeft size={20} strokeWidth={2} />
                </button>
                <button
                  className="cover-modal-nav cover-modal-next"
                  type="button"
                  title="Next cover"
                  onClick={() => onNavigate((index + 1) % covers.length)}
                >
                  <ChevronRight size={20} strokeWidth={2} />
                </button>
              </>
            )}
          </div>
          <p className="cover-modal-info">
            {caption(cover)}
            {multiple ? ` · ${index + 1}/${covers.length}` : ""}
          </p>
        </>
      )}
    </Modal>
  );
}
