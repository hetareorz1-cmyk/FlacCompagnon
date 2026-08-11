// The empty-state screen. The drop itself is handled at app level by Tauri's
// native window event (the webview's own HTML5 drag-and-drop is disabled when
// `dragDropEnabled` is on), so this only renders the invitation and the
// highlight the app-level handler asks for.

import { Download } from "lucide-react";
import "./Dropzone.css";

export interface DropzoneProps {
  dragOver: boolean;
}

export function Dropzone({ dragOver }: DropzoneProps) {
  return (
    <section className={dragOver ? "dropzone drag-over" : "dropzone"}>
      <div className="dropzone-inner">
        <div className="drop-icon">
          <Download />
        </div>
        <p>
          <strong>Drop a folder or audio files here</strong>
        </p>
        <p className="muted">
          Drop more anytime to add them to the list; use Reset to start over. Analyzing a file
          never modifies it — nothing on disk changes unless you explicitly edit tags or cover
          art, rename or renumber tracks, save a report, export a playlist, or generate
          spectrograms. You can also drop a previously-saved <code>.json</code> report here to
          reload it without re-analyzing.
        </p>
      </div>
    </section>
  );
}
