// The conversion panel's own session: which tracks/folders were imported
// into it (entirely separate from the main results table — dropping a file
// here never analyzes it), the chosen output format/bitrate/copy-others
// setting, and the busy/progress state of a running batch.
//
// Mirrors useAnalysis's shape (targets list, busy flag, progress label/
// percent) deliberately — the two features already read as siblings in the
// UI (a right-hand panel next to a left-hand one, both driven by a native
// file drop), so their hooks should feel like siblings too.

import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import type { ConvertFormat, ConvertSettings, Progress } from "../types";
import * as api from "../api";

export interface UseConvertPanelArgs {
  onToast: (msg: string, kind?: "info" | "error") => void;
  /// Called right before a batch starts — the caller uses this to pause
  /// playback, since this hook has no idea whether anything is playing.
  onBeforeStart: () => void;
}

export function useConvertPanel({ onToast, onBeforeStart }: UseConvertPanelArgs) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<ConvertFormat>("flac");
  const [bitrateKbps, setBitrateKbps] = useState<number | null>(null);
  const [copyOthers, setCopyOthers] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  /// Imports `paths` — audio files, folders, or a mix — into the panel's list.
  ///
  /// Folders are expanded by the backend first (`api.listConvertSources`)
  /// rather than kept as one row. Keeping them whole made the panel's own
  /// count a lie the moment a folder was dropped ("1 track imported" for an
  /// album), and left the tracks inside it unselectable and unremovable
  /// individually. Everything in `targets` is therefore a real file.
  const addTargets = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      // Walking a deep folder takes long enough to notice, and until it
      // returns nothing on screen has changed — which reads as a drop the app
      // missed. `importing` gives the drop zone something to say meanwhile.
      setImporting(true);
      let files: string[];
      try {
        files = await api.listConvertSources(paths);
      } catch (e) {
        onToast(String(e), "error");
        return;
      } finally {
        setImporting(false);
      }
      if (files.length === 0) {
        onToast("No supported audio files in what you dropped.", "error");
        return;
      }
      setTargets((prev) => {
        const next = [...prev];
        for (const p of files) if (!next.includes(p)) next.push(p);
        return next;
      });
    },
    [onToast],
  );

  const removeTarget = useCallback((path: string) => {
    setTargets((prev) => prev.filter((p) => p !== path));
    setSelected((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const clearTargets = useCallback(() => {
    setTargets([]);
    setSelected(new Set());
  }, []);

  const toggleSelected = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const updateProgress = useCallback((p: Progress) => {
    setProgressPercent(p.total > 0 ? Math.round((p.current / p.total) * 100) : 0);
    setProgressLabel(
      p.file ? `Converting ${p.current + 1}/${p.total} — ${p.file}` : `Converting ${p.total}/${p.total}`,
    );
  }, []);

  const cancel = useCallback(async () => {
    if (!busy) return;
    setCancelling(true);
    setProgressLabel("Cancelling…");
    try {
      await api.cancelTask();
    } catch {
      /* ignore */
    }
  }, [busy]);

  /// Converts every imported track, or just the selected ones if any are
  /// selected — no explicit selection means "convert everything imported",
  /// per the panel's own "one click converts every title" design.
  const convert = useCallback(async () => {
    if (busy || targets.length === 0) return;
    const effectiveTargets = selected.size > 0 ? [...selected] : targets;

    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;

    onBeforeStart();
    setBusy(true);
    setCancelling(false);
    setProgressLabel("Converting…");
    setProgressPercent(0);
    try {
      const settings: ConvertSettings = { format, bitrate_kbps: bitrateKbps };
      const summary = await api.convertFiles(effectiveTargets, dir, settings, copyOthers);
      onToast(
        `Converted ${summary.converted}/${summary.total}` +
          (summary.copied > 0 ? `, ${summary.copied} file(s) copied` : "") +
          (summary.failed > 0 ? ` — ${summary.failed} failed` : "") +
          ` → ${summary.output_root}`,
        summary.failed > 0 ? "error" : "info",
      );
    } catch (e) {
      if (String(e).includes("cancelled")) {
        onToast("Conversion cancelled.");
      } else {
        onToast(String(e), "error");
      }
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  }, [busy, targets, selected, format, bitrateKbps, copyOthers, onBeforeStart, onToast]);

  return {
    open: panelOpen,
    openPanel,
    closePanel,
    targets,
    selected,
    format,
    bitrateKbps,
    copyOthers,
    importing,
    busy,
    cancelling,
    progressLabel,
    progressPercent,
    setFormat,
    setBitrateKbps,
    setCopyOthers,
    addTargets,
    removeTarget,
    clearTargets,
    toggleSelected,
    updateProgress,
    convert,
    cancel,
  };
}
