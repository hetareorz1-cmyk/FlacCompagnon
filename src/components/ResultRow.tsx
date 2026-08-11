// One row of the results table.
//
// The thumbnail is `undefined` until its tags load in the background, which
// renders the same placeholder as "no cover at all" — so the row appears
// immediately and fills in later without needing a distinct loading state.

import { useEffect, useRef, useState } from "react";
import { Music, Play, Search, Square, Trash2 } from "lucide-react";

import type { CoverArt, FileAnalysis } from "../types";
import { coverDataUrl, fmtCutoff, fmtDuration, fmtSize, splitStem } from "../format";
import { IconButton } from "./IconButton";
import { LiveEqualizerBars } from "./LiveEqualizerBars";
import "./ResultRow.css";
import {
  ClippingCell,
  DetectionsCell,
  DynamicRangeCell,
  Md5Cell,
  QualityBadgeCell,
  RealBitsCell,
  StereoCell,
  TruePeakCell,
} from "./ResultCells";

export interface ResultRowProps {
  file: FileAnalysis;
  cover: CoverArt | null | undefined;
  playing: boolean;
  /// Set together with `playing` — identifies which `playback://level` events
  /// belong to this row's track (see `LiveEqualizerBars`).
  playingRequestId: number | null;
  selected: boolean;
  /// Faded placeholder look while this row is being dragged elsewhere.
  dragging: boolean;
  /// Insertion marker during a drag.
  dropEdge: "before" | "after" | null;
  columnCount: number;
  showMd5: boolean;
  showBadge: boolean;
  /// Shows an editable field instead of plain text — ResultsTable decides
  /// when this turns on (a second, well-spaced click on an already-sole-
  /// selected row's name; see its `RENAME_CLICK_GAP_MS`).
  editing: boolean;
  /// True while a submitted rename is still in flight — the field goes
  /// read-only (not `disabled`: a disabled input forces a blur in most
  /// browsers, which would fire `onCancelRename` mid-request).
  renameBusy: boolean;
  onReveal: () => void;
  onTogglePlay: () => void;
  onDelete: () => void;
  /// Escape, or clicking anywhere else (the field's blur) — discards
  /// whatever was typed.
  onCancelRename: () => void;
  onSubmitRename: (newStem: string) => void;
  onMouseDown: (ev: React.MouseEvent) => void;
  onRowClick: (ev: React.MouseEvent) => void;
}

/// Row buttons must not also start a drag or change the selection, so they
/// swallow both events before they reach the row.
function stop(ev: React.MouseEvent) {
  ev.stopPropagation();
}

function rowClass(selected: boolean, dragging: boolean, dropEdge: "before" | "after" | null) {
  const parts: string[] = [];
  if (selected) parts.push("selected");
  if (dragging) parts.push("dragging");
  if (dropEdge) parts.push(dropEdge === "before" ? "drop-before" : "drop-after");
  return parts.join(" ");
}

export function ResultRow({
  file: f,
  cover,
  playing,
  playingRequestId,
  selected,
  dragging,
  dropEdge,
  columnCount,
  showMd5,
  showBadge,
  editing,
  renameBusy,
  onReveal,
  onTogglePlay,
  onDelete,
  onCancelRename,
  onSubmitRename,
  onMouseDown,
  onRowClick,
}: ResultRowProps) {
  const url = cover ? coverDataUrl(cover) : null;

  const [draftName, setDraftName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Re-seeds from the current name (not just once on mount) every time
  // editing turns on, and focuses + selects it so typing immediately
  // replaces the whole stem — the extension after it stays plain text,
  // never part of the selection or the value submitted.
  useEffect(() => {
    if (!editing) return;
    setDraftName(splitStem(f.file_name).stem);
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [editing, f.file_name]);

  const revealCell = (
    <td className="reveal">
      <IconButton
        icon={<Search size={14} strokeWidth={1.8} />}
        title="Reveal in file browser"
        onMouseDown={stop}
        onClick={(ev) => {
          stop(ev);
          onReveal();
        }}
      />
    </td>
  );

  const thumbCell = (
    <td className="thumb">
      <button
        className={playing ? "play-btn playing" : "play-btn"}
        title={playing ? "Stop" : "Play"}
        onMouseDown={stop}
        onClick={(ev) => {
          stop(ev);
          onTogglePlay();
        }}
      >
        {url ? (
          <img className="thumb-img" src={url} alt="" />
        ) : (
          <span className="thumb-img thumb-placeholder">
            <Music size={14} strokeWidth={1.4} />
          </span>
        )}
        <span className="play-overlay">
          {playing && playingRequestId != null ? (
            <>
              {/* Shown while playing; swapped for the stop icon on hover
                  (see .play-btn.playing:hover in ResultRow.css) so the row
                  reads "now playing" at rest and "click to stop" on hover. */}
              <span className="play-overlay-idle">
                <LiveEqualizerBars requestId={playingRequestId} />
              </span>
              <span className="play-overlay-hover">
                <Square size={13} fill="currentColor" stroke="none" />
              </span>
            </>
          ) : (
            <Play size={13} fill="currentColor" stroke="none" />
          )}
        </span>
      </button>
    </td>
  );

  const { ext } = splitStem(f.file_name);
  // Mouse events inside the field are stopped the same way the row's own
  // buttons already are (`stop`, above) — without it, clicking to place the
  // caret would also arm `onRowMouseDown`'s drag session, and dragging to
  // select text inside the field would try to reorder rows instead.
  const nameCell = editing ? (
    <td className="fname fname-editing">
      <input
        ref={nameInputRef}
        type="text"
        className="fname-input"
        value={draftName}
        readOnly={renameBusy}
        onMouseDown={stop}
        onClick={stop}
        onChange={(ev) => setDraftName(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") {
            ev.preventDefault();
            onCancelRename();
          } else if (ev.key === "Enter") {
            ev.preventDefault();
            onSubmitRename(draftName);
          }
        }}
        onBlur={onCancelRename}
      />
      {ext && <span className="fname-ext">{ext}</span>}
    </td>
  ) : (
    <td className="fname has-tip" title={f.path}>
      {f.file_name}
    </td>
  );

  const deleteCell = (
    <td className="rowdel">
      <IconButton
        icon={<Trash2 size={14} strokeWidth={1.6} />}
        title="Remove this row"
        variant="danger"
        onMouseDown={stop}
        onClick={(ev) => {
          stop(ev);
          onDelete();
        }}
      />
    </td>
  );

  if (f.error) {
    // reveal + thumbnail + name precede, delete trails.
    return (
      <tr
        data-path={f.path}
        className={rowClass(selected, dragging, dropEdge)}
        onMouseDown={onMouseDown}
        onClick={onRowClick}
      >
        {revealCell}
        <td className="thumb" />
        {nameCell}
        <td colSpan={columnCount - 4} className="c-bad">
          Error: {f.error}
        </td>
        {deleteCell}
      </tr>
    );
  }

  return (
    <tr
      data-path={f.path}
      className={rowClass(selected, dragging, dropEdge)}
      onMouseDown={onMouseDown}
      onClick={onRowClick}
    >
      {revealCell}
      {thumbCell}
      {nameCell}
      {f.ext_mismatch ? (
        <td
          className="c-bad has-tip"
          title={`Real container is ${f.format}, which does not match the file extension`}
        >
          {f.format}
        </td>
      ) : (
        <td>{f.format}</td>
      )}
      {showBadge && <QualityBadgeCell badge={f.badge} />}
      <td>{(f.sample_rate / 1000).toFixed(1)}k</td>
      <td>{f.declared_bits != null ? `${f.declared_bits}-bit` : "float"}</td>
      <RealBitsCell f={f} />
      <td>{fmtDuration(f.duration_secs)}</td>
      <td className="size has-tip" title={`${f.size_bytes.toLocaleString()} bytes`}>
        {fmtSize(f.size_bytes)}
      </td>
      <DetectionsCell d={f.detections} />
      <td>{fmtCutoff(f)}</td>
      <td>{f.channels}</td>
      <StereoCell f={f} />
      <ClippingCell c={f.clipping} />
      <TruePeakCell dbtp={f.clipping.true_peak_dbtp} />
      <DynamicRangeCell dr={f.dr_db} />
      {showMd5 && <Md5Cell m={f.flac_md5} />}
      {deleteCell}
    </tr>
  );
}
