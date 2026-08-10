// Application root: owns the state several features share, and wires the
// pieces together. Anything with real logic of its own lives in a hook or a
// component under src/components — this file should stay readable as a
// description of the app's shape.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import type { PlaylistFormat } from "./types";
import * as api from "./api";
import { commonDir, fileSearchText, matchesSearch } from "./format";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Dropzone } from "./components/Dropzone";
import { DropGuard, Progress } from "./components/Progress";
import { PlaylistFormatModal } from "./components/PlaylistFormatModal";
import { ResultsSummary } from "./components/ResultsSummary";
import { ResultsTable } from "./components/ResultsTable";
import { TagPanel, type TagPanelHandle } from "./components/TagPanel";
import { TopBar } from "./components/TopBar";
import { useAnalysis } from "./components/useAnalysis";
import {
  useMenuActions,
  useProgressEvents,
  useRevealWindow,
  useSuppressContextMenu,
} from "./components/useAppEvents";
import { useExports } from "./components/useExports";
import { useNativeDrop } from "./components/useNativeDrop";
import { usePlayback } from "./components/usePlayback";
import {
  useSelection,
  type SelectionModifiers,
} from "./components/useSelection";
import { useRenumberTracks } from "./components/useRenumberTracks";
import { useTagCache, useTagPrefetch } from "./components/useTagCache";
import { useToast } from "./components/useToast";
import "./App.css";

export function App() {
  const { toast, showToast } = useToast();
  const tagPanelRef = useRef<TagPanelHandle>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(false);
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renumberConfirmOpen, setRenumberConfirmOpen] = useState(false);

  const cache = useTagCache();
  const { clear: clearCache, invalidate } = cache;

  // Selection and caches follow the file list: a row that no longer exists
  // can't stay selected, and a cleared list drops its cached tags entirely.
  const [presentPaths, setPresentPaths] = useState<Set<string>>(new Set());
  const onFilesChanged = useCallback(
    (present: Set<string>) => {
      setPresentPaths(present);
      if (present.size === 0) clearCache();
    },
    [clearCache],
  );

  const analysis = useAnalysis({ onToast: showToast, onFilesChanged });
  const orderedPaths = useMemo(
    () => analysis.orderedFiles.map((f) => f.path),
    [analysis.orderedFiles],
  );

  // Search box in the top bar: a pure display filter over the table. Nothing
  // else — playback order, the selection, drag-reorder and every export —
  // reads from `analysis.orderedFiles`/`orderedPaths` directly and never
  // learns this filter exists, so hiding a row here can't skip it during
  // playback or drop it from a CSV/JSON/M3U export.
  //
  // Matches against everything the row actually shows (`fileSearchText`), not
  // just the file name — so "24-bit", "transcoded" or "flac" filters the list
  // too. `matchesSearch` does whole-word matching, not a plain substring
  // search, so a closed word like "16-" (typed for "16-bit") can't match
  // "160 MB" or "116 MB" just because they contain "16".
  const hasSearchQuery = searchQuery.trim().length > 0;
  const visiblePaths = useMemo(() => {
    if (!hasSearchQuery) return null;
    const matches = new Set<string>();
    for (const f of analysis.orderedFiles) {
      if (matchesSearch(fileSearchText(f), searchQuery)) matches.add(f.path);
    }
    return matches;
  }, [analysis.orderedFiles, hasSearchQuery, searchQuery]);

  const selection = useSelection(orderedPaths);
  const { pruneSelection, clearSelection } = selection;
  useEffect(() => pruneSelection(presentPaths), [presentPaths, pruneSelection]);

  // A row click that changes the selection wipes any unsaved tag edit — see
  // `useTagEditor`'s selection-key reset, which runs during render, before
  // there's any chance to step in afterwards. So the confirmation has to
  // happen here, *before* `selection.selectRow` runs, not in the tag panel.
  // A click that doesn't actually change anything (re-clicking the sole
  // selected row, no modifier keys) is let through unprompted.
  const [pendingSelection, setPendingSelection] = useState<{
    path: string;
    ev: SelectionModifiers;
  } | null>(null);
  const guardedSelectRow = useCallback(
    (path: string, ev: SelectionModifiers) => {
      const noopReselect =
        !ev.shiftKey &&
        !ev.metaKey &&
        !ev.ctrlKey &&
        selection.selectedPaths.length === 1 &&
        selection.selectedPaths[0] === path;
      if (!noopReselect && tagPanelRef.current?.isDirty()) {
        setPendingSelection({ path, ev });
        return;
      }
      selection.selectRow(path, ev);
    },
    [selection],
  );
  const confirmPendingSelection = useCallback(() => {
    if (pendingSelection) {
      tagPanelRef.current?.discardEdits();
      selection.selectRow(pendingSelection.path, pendingSelection.ev);
    }
    setPendingSelection(null);
  }, [pendingSelection, selection]);

  const playback = usePlayback(orderedPaths, showToast);
  useTagPrefetch(orderedPaths, cache.fetchMissing);

  const exports = useExports({
    report: analysis.report,
    orderedFiles: analysis.orderedFiles,
    targets: analysis.targets,
    busy: analysis.busy,
    tags: cache.tags,
    onToast: showToast,
  });

  const drop = useNativeDrop({
    busy: analysis.busy,
    tagPanelRef,
    onAnalyze: analysis.analyze,
    onLoadReport: analysis.loadReport,
    onToast: showToast,
  });

  useProgressEvents(analysis.updateProgress);
  useRevealWindow();
  useSuppressContextMenu();

  useEffect(() => {
    api
      .ffmpegAvailable()
      .then(setFfmpegAvailable)
      .catch(() => setFfmpegAvailable(false));
  }, []);

  const menuActions = useMemo(
    () => ({
      exportM3u: () => void exports.exportPlaylist("Simple"),
      exportM3uExtended: () => void exports.exportPlaylist("Extended"),
      exportCsv: () => void exports.exportReport("csv"),
      exportJson: () => void exports.exportReport("json"),
      reset: () => {
        playback.stop();
        analysis.reset();
        setSearchQuery("");
      },
      generateSpectrograms: () => void analysis.generateSpectrograms(),
    }),
    [exports, analysis, playback],
  );
  useMenuActions(menuActions);

  const pickFolder = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") await analysis.analyze([dir]);
  }, [analysis]);

  const deleteSelected = useCallback(() => {
    if (selection.selectedPaths.length === 0) return;
    selection.selectedPaths.forEach((path) => playback.stopIfPlaying(path));
    // One call for every path, not a loop of single removals: `removeFile`
    // in a loop would read the same stale report on each iteration and lose
    // all but the last removal (see `removeFiles`'s doc comment).
    analysis.removeFiles(selection.selectedPaths);
    selection.clearSelection();
  }, [selection, playback, analysis]);

  const deleteRow = useCallback(
    (path: string, isSelected: boolean) => {
      // If the row is part of a multi-selection, delete all selected rows.
      // Otherwise, delete only this row.
      if (isSelected && selection.selectedPaths.length > 1) {
        deleteSelected();
      } else {
        playback.stopIfPlaying(path);
        analysis.removeFile(path);
      }
    },
    [playback, analysis, selection.selectedPaths, deleteSelected],
  );

  // DEL (or Backspace on Mac) removes all selected rows.
  useEffect(() => {
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (!ev || !ev.target) return;

      const target = ev.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      // Every pop-in (cover lightbox, extended tags, online lookup, the
      // confirm dialogs themselves) renders through the shared `Modal`
      // component's `.cover-modal` backdrop. Without this check, Backspace
      // pressed while one is open — e.g. to dismiss a "Discard changes?"
      // prompt out of habit — would delete the whole selection underneath it
      // instead of doing nothing.
      if (document.querySelector(".cover-modal")) return;

      if (
        (ev.key === "Delete" || ev.key === "Backspace") &&
        selection.selectedPaths.length > 0
      ) {
        ev.preventDefault();
        deleteSelected();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selection.selectedPaths, deleteSelected]);

  const onPlaylistConfirm = useCallback(
    (format: PlaylistFormat) => {
      setPlaylistModalOpen(false);
      void exports.exportPlaylist(format);
    },
    [exports],
  );

  const hasResults =
    analysis.report != null && analysis.orderedFiles.length > 0;
  // Memoized, not just computed: this array feeds the tag panel's derived
  // state (distinct covers, extended rows), and a fresh identity on every
  // render would keep resetting the cover carousel to the first image.
  const { tagSetsFor } = cache;
  const selectedTagSets = useMemo(
    () => tagSetsFor(selection.selectedPaths),
    [tagSetsFor, selection.selectedPaths],
  );

  // `selection.selectedPaths` is in click order (see useSelection's doc
  // comment), not display order — renumbering has to follow the table's
  // order instead, or the assigned track numbers wouldn't match what the
  // user sees top to bottom.
  const selectedPathSet = useMemo(
    () => new Set(selection.selectedPaths),
    [selection.selectedPaths],
  );
  const orderedSelectedPaths = useMemo(
    () => analysis.orderedFiles.filter((f) => selectedPathSet.has(f.path)).map((f) => f.path),
    [analysis.orderedFiles, selectedPathSet],
  );

  const renumberTracks = useRenumberTracks({ onSaved: invalidate, onToast: showToast });
  const confirmRenumber = useCallback(() => {
    setRenumberConfirmOpen(false);
    void renumberTracks.renumber(orderedSelectedPaths);
  }, [renumberTracks, orderedSelectedPaths]);

  return (
    <div id="app">
      <TopBar
        busy={analysis.busy}
        hasReport={hasResults}
        canGenerateSpectrograms={analysis.targets.length > 0}
        ffmpegAvailable={ffmpegAvailable}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCount={selection.selectedPaths.length}
        renumberBusy={renumberTracks.busy}
        onRenumberTracks={() => setRenumberConfirmOpen(true)}
        onPick={() => void pickFolder()}
        onSave={() => void exports.saveReport()}
        onExportPlaylist={() => setPlaylistModalOpen(true)}
        onGenerateSpectrograms={() => void analysis.generateSpectrograms()}
        onReset={menuActions.reset}
      />

      <div className="main-row">
        {selection.selectedPaths.length > 0 && (
          <TagPanel
            ref={tagPanelRef}
            selectedPaths={selection.selectedPaths}
            tagSets={selectedTagSets}
            coverDragOver={drop.overCover}
            onClose={clearSelection}
            onSaved={invalidate}
            onToast={showToast}
          />
        )}

        <div className="main-col">
          {!hasResults && !analysis.busy && (
            <Dropzone dragOver={drop.overWindow} />
          )}

          {hasResults &&
            (!analysis.busy || analysis.keepResultsWhileBusy) &&
            analysis.report && (
              <section className="results">
                <ResultsSummary
                  report={analysis.report}
                  rootPath={commonDir(analysis.report.files.map((f) => f.path))}
                  selectedCount={selection.selectedPaths.length}
                  visibleCount={visiblePaths == null ? null : visiblePaths.size}
                  onToast={showToast}
                />
                <ResultsTable
                  files={analysis.orderedFiles}
                  covers={cache.covers}
                  nowPlaying={playback.nowPlaying}
                  selectedPaths={selection.selectedPaths}
                  visiblePaths={visiblePaths}
                  onSelectRow={guardedSelectRow}
                  onReorder={analysis.setDisplayOrder}
                  onReveal={(p) =>
                    api
                      .revealInFolder(p)
                      .catch((e) => showToast(String(e), "error"))
                  }
                  onTogglePlay={playback.togglePlay}
                  onDelete={deleteRow}
                />
              </section>
            )}

          {analysis.busy && (
            <Progress
              label={analysis.progressLabel}
              percent={analysis.progressPercent}
              cancelDisabled={analysis.cancelling}
              onCancel={() => void analysis.cancelTask()}
            />
          )}
        </div>
      </div>

      {drop.blocked && <DropGuard />}

      <PlaylistFormatModal
        open={playlistModalOpen}
        onClose={() => setPlaylistModalOpen(false)}
        onConfirm={onPlaylistConfirm}
      />

      <ConfirmDialog
        open={pendingSelection != null}
        title="Discard changes?"
        message="This track has unsaved tag changes. Selecting another one will discard them."
        confirmLabel="Discard"
        danger
        onConfirm={confirmPendingSelection}
        onCancel={() => setPendingSelection(null)}
      />

      <ConfirmDialog
        open={renumberConfirmOpen}
        title="Renumber tracks?"
        message={`Sets Track to 1–${orderedSelectedPaths.length} and Track Total to ${orderedSelectedPaths.length} for the ${orderedSelectedPaths.length} selected tracks, in the order shown in the table — overwriting any existing values.`}
        confirmLabel="Renumber"
        onConfirm={confirmRenumber}
        onCancel={() => setRenumberConfirmOpen(false)}
      />

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
