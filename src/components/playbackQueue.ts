// What plays after a given track, given the current selection — shared by
// `usePlayback`'s natural end-of-track auto-advance and `usePlaybackQueue`'s
// Previous/Next buttons. Both need the same answer, or a track ending on its
// own would walk a different order than the buttons do, which is confusing
// in a way neither half would ever surface on its own.
//
// - No selection: the full list, in display order.
// - More than one row selected: just the selection, still in display order
//   (not click order) — so a "hole" of unselected rows in between is skipped
//   rather than played.
// - Exactly one row selected: `null` — a deliberate one-off preview, not a
//   queue to step through or auto-advance out of once it ends.
export function effectiveQueue(orderedPaths: string[], selectedPaths: string[]): string[] | null {
  if (selectedPaths.length === 1) return null;
  if (selectedPaths.length > 1) {
    const selected = new Set(selectedPaths);
    return orderedPaths.filter((p) => selected.has(p));
  }
  return orderedPaths;
}
