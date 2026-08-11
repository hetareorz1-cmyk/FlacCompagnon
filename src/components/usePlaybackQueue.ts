// What the footer's transport controls (Play/Pause, Previous, Next) operate
// over — a concern of its own, separate from `usePlayback` (which only knows
// how to play/pause/seek *a* track, not which one comes before or after):
//
// - No selection: the full table, in display order.
// - More than one row selected: just the selection, still in display order
//   (not click order) — so Next/Previous read the same left-to-right order
//   the eye does, skipping any unselected "hole" in between.
// - Exactly one row selected: no queue at all. That's a deliberate one-off
//   preview, not something to step through, so Previous/Next stay disabled.
//
// `effectiveQueue` (playbackQueue.ts) is the single source of truth for this
// ordering — `usePlayback`'s own natural end-of-track auto-advance uses the
// exact same function, so a track ending on its own walks the same order
// these buttons do rather than a different one.

import { useCallback, useMemo } from "react";

import type { NowPlaying } from "./usePlayback";
import { effectiveQueue } from "./playbackQueue";

export interface UsePlaybackQueueArgs {
  orderedPaths: string[];
  selectedPaths: string[];
  nowPlaying: NowPlaying | null;
  play: (path: string) => void | Promise<void>;
  togglePause: () => void;
}

export function usePlaybackQueue({
  orderedPaths,
  selectedPaths,
  nowPlaying,
  play,
  togglePause,
}: UsePlaybackQueueArgs) {
  const queue = useMemo(
    () => effectiveQueue(orderedPaths, selectedPaths),
    [orderedPaths, selectedPaths],
  );

  const index = queue && nowPlaying ? queue.indexOf(nowPlaying.path) : -1;
  const canGoPrevious = queue != null && index > 0;
  const canGoNext = queue != null && index !== -1 && index < queue.length - 1;

  // Doubles as "start": with nothing loaded, the button plays the sole
  // selected track, the first of the selection, or the first of the table —
  // whichever `queue`/`selectedPaths` currently call for. Once something is
  // loaded, it's a plain pause/resume regardless of the selection.
  const onPlayPause = useCallback(() => {
    if (nowPlaying) {
      togglePause();
      return;
    }
    const first = selectedPaths.length === 1 ? selectedPaths[0] : queue?.[0];
    if (first) void play(first);
  }, [nowPlaying, togglePause, selectedPaths, queue, play]);

  const onPrevious = useCallback(() => {
    if (queue == null || index <= 0) return;
    void play(queue[index - 1]);
  }, [queue, index, play]);

  const onNext = useCallback(() => {
    if (queue == null || index === -1 || index >= queue.length - 1) return;
    void play(queue[index + 1]);
  }, [queue, index, play]);

  return { canGoPrevious, canGoNext, onPlayPause, onPrevious, onNext };
}
