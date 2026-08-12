// The conversion panel's drop target — sits where the tag panel's cover art
// does, full-bleed at the top of the panel, but takes audio files/folders
// instead of a single image. Purely presentational: drag state, the imported
// count and the busy animation are all handed in.

// `FileAudio`, not `Upload` — `Upload` is already CoverArt.tsx's icon for
// *extracting* a cover to disk; reusing it here for the opposite direction
// (dropping audio files in) reads as the wrong action once both are visible
// side by side.
import { ArrowDownToLine, FileAudio } from "lucide-react";

import { dropZone } from "./dropZones";
import "./ConvertDropzone.css";

const PLACEHOLDER_ICON_SIZE = 32;

export interface ConvertDropzoneProps {
  /// A file is being dragged over this box specifically (not just the
  /// window) — see useNativeDrop's `overConvert`.
  dragOver: boolean;
  /// A conversion batch is running — swaps the prompt for a spinner and
  /// per-file progress text, the "animation" requested for this state.
  busy: boolean;
  progressLabel: string;
  itemCount: number;
}

export function ConvertDropzone({
  dragOver,
  busy,
  progressLabel,
  itemCount,
}: ConvertDropzoneProps) {
  const frameClass = dragOver ? "convert-drop-frame drag-over" : "convert-drop-frame";

  return (
    <div className={frameClass} {...dropZone("convert")}>
      {busy ? (
        <>
          <span className="spinner" />
          <p className="convert-drop-text">{progressLabel}</p>
        </>
      ) : (
        <>
          {/* Same icon swap as the main dropzone: at rest it names what the
              box takes, under a drag it says "release here". */}
          {dragOver ? (
            <ArrowDownToLine size={PLACEHOLDER_ICON_SIZE} strokeWidth={1.4} />
          ) : (
            <FileAudio size={PLACEHOLDER_ICON_SIZE} strokeWidth={1.4} />
          )}
          <p className="convert-drop-text">
            {dragOver
              ? "Release to import"
              : itemCount === 0
                ? "Drop audio files or folders to convert"
                : `${itemCount} track${itemCount === 1 ? "" : "s"} imported — drop more anytime`}
          </p>
        </>
      )}
    </div>
  );
}
