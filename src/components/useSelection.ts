// Finder/Explorer-style row selection.
//
// The selection keeps click order, not display order: building a playlist from
// a selection follows the order you picked the tracks in. Every other consumer
// (the tag panel's bulk edit) only cares about membership.

import { useCallback, useState } from "react";

export interface SelectionModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export function useSelection(orderedPaths: string[]) {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  // The last row clicked without a modifier — Shift+click extends from here.
  const [anchor, setAnchor] = useState<string | null>(null);

  const selectRow = useCallback(
    (path: string, ev: SelectionModifiers) => {
      if (ev.shiftKey && anchor) {
        const a = orderedPaths.indexOf(anchor);
        const b = orderedPaths.indexOf(path);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setSelectedPaths(orderedPaths.slice(lo, hi + 1));
          return;
        }
        setSelectedPaths([path]);
        setAnchor(path);
        return;
      }
      if (ev.metaKey || ev.ctrlKey) {
        setSelectedPaths((prev) =>
          prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
        );
        setAnchor(path);
        return;
      }
      setSelectedPaths([path]);
      setAnchor(path);
    },
    [anchor, orderedPaths],
  );

  const clearSelection = useCallback(() => {
    setSelectedPaths([]);
    setAnchor(null);
  }, []);

  /// Selects every row currently in `orderedPaths` — the whole list, not just
  /// whatever the search filter happens to be showing (that filter is
  /// display-only, see App.tsx's `visiblePaths`, and never reaches this far).
  const selectAll = useCallback(() => {
    setSelectedPaths(orderedPaths);
    setAnchor(orderedPaths.length > 0 ? orderedPaths[orderedPaths.length - 1] : null);
  }, [orderedPaths]);

  /// Selects everything currently unselected and drops everything currently
  /// selected — same "whole list, not just the filtered view" scope as
  /// `selectAll` above, for the same reason (the search filter is
  /// display-only).
  const invertSelection = useCallback(() => {
    const selected = new Set(selectedPaths);
    const next = orderedPaths.filter((p) => !selected.has(p));
    setSelectedPaths(next);
    setAnchor(next.length > 0 ? next[next.length - 1] : null);
  }, [orderedPaths, selectedPaths]);

  /// Drops paths that no longer exist (a deleted row, a fresh analysis).
  const pruneSelection = useCallback((present: Set<string>) => {
    setSelectedPaths((prev) => prev.filter((p) => present.has(p)));
    setAnchor((a) => (a && present.has(a) ? a : null));
  }, []);

  /// A renamed file's identity changes mid-selection — without this, the
  /// pruning above (run right after, once the file list catches up) would
  /// just drop `oldPath` as "no longer present" instead of following it to
  /// `newPath`, silently closing the tag panel on the file the user was
  /// looking at the moment they renamed it.
  const replacePath = useCallback((oldPath: string, newPath: string) => {
    setSelectedPaths((prev) => prev.map((p) => (p === oldPath ? newPath : p)));
    setAnchor((a) => (a === oldPath ? newPath : a));
  }, []);

  return {
    selectedPaths,
    selectRow,
    selectAll,
    invertSelection,
    clearSelection,
    pruneSelection,
    replacePath,
  };
}
