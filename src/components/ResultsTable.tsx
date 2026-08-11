// The results table: header, rows, selection clicks and drag-to-reorder.
//
// Two columns are conditional rather than always-present-but-empty: MD5 only
// means something when the analysis actually included FLAC files, and Quality
// only when at least one file earned a badge.

import { useMemo, useRef } from "react";

import type { CoverArt, FileAnalysis } from "../types";
import { ResultRow } from "./ResultRow";
import { useRowDrag } from "./useRowDrag";
import type { SelectionModifiers } from "./useSelection";
import "./ResultsTable.css";

// Mp3tag/Finder-style "click twice on the name to rename": a real double
// click still just selects (browsers fire two separate click events for one,
// ~tens of ms apart), so a rename only fires once *more* than this many ms
// have passed since the previous click landed on the same row's name cell —
// comfortably above every OS's own double-click speed setting, default or
// fast.
const RENAME_CLICK_GAP_MS = 500;

export interface ResultsTableProps {
  files: FileAnalysis[];
  covers: Map<string, CoverArt | null>;
  nowPlaying: { path: string; requestId: number } | null;
  selectedPaths: string[];
  /// Which rows to actually render; `null` means "everything" (no filter
  /// active). This only decides what's *drawn* — `files` itself stays the
  /// full list, so `orderedPaths` (drag-reorder) and the parent's playback/
  /// selection/export state, all of which are computed from the full list
  /// upstream, never see a shrunk table. Hiding a row here can't lose it.
  visiblePaths: Set<string> | null;
  /// The one row currently showing an editable name field, or `null`.
  editingPath: string | null;
  renameBusy: boolean;
  onSelectRow: (path: string, ev: SelectionModifiers) => void;
  /// Opens the rename field for `path` — only ever called for the sole
  /// selected row, well after the click that selected it (see
  /// `RENAME_CLICK_GAP_MS`).
  onStartRename: (path: string) => void;
  onCancelRename: () => void;
  onSubmitRename: (path: string, newStem: string) => void;
  onReorder: (order: string[]) => void;
  onReveal: (path: string) => void;
  onTogglePlay: (path: string) => void;
  onDelete: (path: string, isSelected: boolean) => void;
}

export function ResultsTable({
  files,
  covers,
  nowPlaying,
  selectedPaths,
  visiblePaths,
  editingPath,
  renameBusy,
  onSelectRow,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onReorder,
  onReveal,
  onTogglePlay,
  onDelete,
}: ResultsTableProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const orderedPaths = useMemo(() => files.map((f) => f.path), [files]);
  const visibleFiles = useMemo(
    () => (visiblePaths == null ? files : files.filter((f) => visiblePaths.has(f.path))),
    [files, visiblePaths],
  );

  // Tracks only the most recent click on *a* name cell — clicking a
  // different row's name in between resets eligibility for both, same as
  // Finder: the "second click" has to be the second click on that same row.
  const lastNameClick = useRef<{ path: string; time: number } | null>(null);

  const { dragState, onRowMouseDown, consumeClickSuppression } = useRowDrag({
    tableRef,
    orderedPaths,
    selectedPaths,
    onReorder,
  });

  const showMd5 = files.some((f) => f.flac_md5 != null);
  const showBadge = files.some((f) => f.badge != null);

  const headers = [
    "", // reveal button
    "", // thumbnail / play button
    "File",
    "Format",
    ...(showBadge ? ["Quality"] : []),
    "Rate",
    "Bits",
    "Real bits",
    "Length",
    "Size",
    "Detections",
    "Cutoff",
    "Ch",
    "Stereo",
    "Clipping",
    "True Peak",
    "Dynamics",
    ...(showMd5 ? ["MD5"] : []),
    "", // delete button
  ];

  const selected = new Set(selectedPaths);
  const dragging = new Set(dragState.active ? dragState.paths : []);

  return (
    <div className="table-wrap">
      <table ref={tableRef}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={`${h}-${i}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleFiles.length === 0 && files.length > 0 ? (
            <tr>
              <td className="no-matches muted" colSpan={headers.length}>
                No files match the filter.
              </td>
            </tr>
          ) : (
            visibleFiles.map((f) => (
              <ResultRow
                key={f.path}
                file={f}
                cover={covers.get(f.path)}
                playing={nowPlaying?.path === f.path}
                playingRequestId={nowPlaying?.path === f.path ? nowPlaying.requestId : null}
                selected={selected.has(f.path)}
                dragging={dragging.has(f.path)}
                dropEdge={
                  dragState.dropTarget?.path === f.path
                    ? dragState.dropTarget.before
                      ? "before"
                      : "after"
                    : null
                }
                columnCount={headers.length}
                showMd5={showMd5}
                showBadge={showBadge}
                editing={editingPath === f.path}
                renameBusy={renameBusy}
                onReveal={() => onReveal(f.path)}
                onTogglePlay={() => onTogglePlay(f.path)}
                onDelete={() => onDelete(f.path, selected.has(f.path))}
                onCancelRename={onCancelRename}
                onSubmitRename={(newStem) => onSubmitRename(f.path, newStem)}
                onMouseDown={(ev) => onRowMouseDown(f.path, ev)}
                onRowClick={(ev) => {
                  if (consumeClickSuppression()) return;

                  const clickedName = (ev.target as HTMLElement).closest(".fname") != null;
                  const now = ev.timeStamp;
                  const prev = lastNameClick.current;
                  const secondClick =
                    prev != null && prev.path === f.path && now - prev.time > RENAME_CLICK_GAP_MS;
                  lastNameClick.current = clickedName ? { path: f.path, time: now } : null;

                  const sole = selected.has(f.path) && selectedPaths.length === 1;
                  if (clickedName && sole && secondClick && editingPath !== f.path) {
                    onStartRename(f.path);
                    return;
                  }
                  onSelectRow(f.path, ev);
                }}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
