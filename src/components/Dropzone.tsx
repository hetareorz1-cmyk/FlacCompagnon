// The empty-state screen. The drop itself is handled at app level by Tauri's
// native window event (the webview's own HTML5 drag-and-drop is disabled when
// `dragDropEnabled` is on), so this only renders the invitation and the
// highlight the app-level handler asks for.

import { ArrowDownToLine, Download } from "lucide-react";

import { dropZone } from "./dropZones";
import "./Dropzone.css";

export interface DropzoneProps {
  dragOver: boolean;
}

export function Dropzone({ dragOver }: DropzoneProps) {
  return (
    // This box *is* the list while the list is empty, so it claims the same
    // drop zone the results table claims once there's something in it.
    <section className={dragOver ? "dropzone drag-over" : "dropzone"} {...dropZone("list")}>
      <div className="dropzone-inner">
        {/* Swapping the icon on hover, not just recolouring the box: the
            arrow-into-line reads as "release here", which is the thing the
            user is deciding at that moment. */}
        <div className="drop-icon">{dragOver ? <ArrowDownToLine /> : <Download />}</div>
        <p>
          <strong>Drop a folder or audio files here</strong>
        </p>
        <p className="muted">
          Drop more anytime to add them to this list — files already in it are skipped, and
          dropping outside it does nothing. Use Reset to start over. Analyzing a file
          never modifies it — nothing on disk changes unless you explicitly edit tags or cover
          art, rename or renumber tracks, save a report, export a playlist, or generate
          spectrograms. You can also drop a previously-saved <code>.json</code> report here to
          reload it without re-analyzing.
        </p>
      </div>
    </section>
  );
}
