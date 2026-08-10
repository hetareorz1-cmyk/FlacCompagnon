// Renumbers a multi-file selection: Track becomes 1..n in the order given,
// Track Total becomes n on every file. This is the one tag-writing flow that
// needs a *distinct* value per file — unlike the tag panel's bulk edit, which
// deliberately applies one shared value to the whole selection (see
// `useTagEditor`'s doc comment) — so it calls `write_tags_batch` once per
// file instead of once for the whole batch: there's no backend command for
// "different edits per path" yet, and this is a rare-enough action that N
// small round-trips isn't worth adding one for.

import { useCallback, useState } from "react";

import type { TagEdits } from "../types";
import * as api from "../api";
import { emptyTagEdits } from "./useTagEditor";

export interface UseRenumberTracksArgs {
  /// Invalidates the caller's cached tags for these paths and re-reads them —
  /// the same callback the tag panel's Save passes as `onSaved`.
  onSaved: (paths: string[]) => void;
  onToast: (msg: string, kind?: "info" | "error") => void;
}

export function useRenumberTracks({ onSaved, onToast }: UseRenumberTracksArgs) {
  const [busy, setBusy] = useState(false);

  /// `orderedPaths` must already be in the order the tracks should end up
  /// numbered in (the table's display order among the selection, not
  /// necessarily click order — see `useSelection`'s doc comment) — this only
  /// assigns 1..n to whatever order it's handed.
  const renumber = useCallback(
    async (orderedPaths: string[]) => {
      if (orderedPaths.length < 2 || busy) return;
      setBusy(true);
      const total = orderedPaths.length;
      let written = 0;
      let failed = 0;
      try {
        for (let i = 0; i < orderedPaths.length; i++) {
          const edits: TagEdits = {
            ...emptyTagEdits(),
            track: { Set: String(i + 1) },
            track_total: { Set: String(total) },
          };
          try {
            const summary = await api.writeTagsBatch([orderedPaths[i]], edits);
            written += summary.written;
            failed += summary.failed;
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) {
          onToast(`${written}/${total} tracks renumbered — ${failed} failed`, "error");
        } else {
          onToast(`${written} track${written === 1 ? "" : "s"} renumbered 1–${total}`);
        }
        onSaved(orderedPaths);
      } finally {
        setBusy(false);
      }
    },
    [busy, onSaved, onToast],
  );

  return { renumber, busy };
}
