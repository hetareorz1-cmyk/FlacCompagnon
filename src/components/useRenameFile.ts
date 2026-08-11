// Inline "click twice on the name" rename, from the results table.
//
// Kept separate from `useAnalysis`'s own `renameFile` (which only updates the
// in-memory file list once the disk write already happened) because this one
// owns the actual write plus its toast/error handling — the same split as
// `useRenumberTracks` versus `write_tags_batch`.

import { useCallback, useState } from "react";

import * as api from "../api";

export interface UseRenameFileArgs {
  /// Called once the file has actually been renamed on disk, with its old and
  /// new path plus the new file name — everything that needs to follow the
  /// identity change (the file list, the selection, the tag cache) reacts to
  /// this rather than to `rename` itself.
  onRenamed: (oldPath: string, newPath: string, newFileName: string) => void;
  onToast: (msg: string, kind?: "info" | "error") => void;
}

export function useRenameFile({ onRenamed, onToast }: UseRenameFileArgs) {
  const [busy, setBusy] = useState(false);

  const rename = useCallback(
    async (path: string, newStem: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const result = await api.renameFile(path, newStem);
        // Same path back out means the trimmed stem matched what the file
        // was already called (e.g. Enter pressed without changing anything)
        // — nothing actually changed on disk, so nothing downstream needs
        // telling either.
        if (result.path !== path) onRenamed(path, result.path, result.file_name);
      } catch (e) {
        onToast(String(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [busy, onRenamed, onToast],
  );

  return { rename, busy };
}
