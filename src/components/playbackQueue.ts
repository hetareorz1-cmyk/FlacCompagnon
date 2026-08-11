// What plays after a given track, given the selection at the moment a
// playback session started — shared by `usePlayback`'s natural end-of-track
// auto-advance/Previous/Next and `usePlaybackQueue`'s "what starts on a bare
// Play press" logic. Both need the same answer, or a track ending on its own
// would walk a different order than the buttons do, which is confusing in a
// way neither half would ever surface on its own.
//
// - No selection, or exactly one row selected: the full list, in display
//   order. A single selection only changes *where* playback starts — the
//   caller plays that one path first, but this function still returns the
//   whole table so playback then continues on to the end rather than
//   stopping after one track.
// - More than one row selected: just the selection, still in display order
//   (not click order) — so a "hole" of unselected rows in between is skipped
//   rather than played.
//
// This is deliberately only ever read once per playback session, at the
// moment it starts (see `usePlayback`'s `activeQueue`) — a selection change
// made while a track is already playing must not retroactively change what
// that session was queued to play next.
export function effectiveQueue(orderedPaths: string[], selectedPaths: string[]): string[] {
  if (selectedPaths.length > 1) {
    const selected = new Set(selectedPaths);
    return orderedPaths.filter((p) => selected.has(p));
  }
  return orderedPaths;
}
