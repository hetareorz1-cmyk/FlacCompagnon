// What the footer's transport controls (Play/Pause, Previous, Next) show and
// trigger — `usePlayback` owns the actual queue (see its `activeQueue` and
// `stepQueue`), this hook only derives the UI-facing bits from it:
// Previous/Next's enabled state, and what a bare Play press (nothing loaded)
// should start.
//
// That last case is the one moment this hook reads the order/selection live
// rather than through `activeQueue` — there's no session yet to have frozen
// one. `usePlayback.play` freezes its own `activeQueue` copy right after,
// from the same order/selection, so the two computations agree.

import { useCallback } from "react";

import type { NowPlaying } from "./usePlayback";
import { effectiveQueue } from "./playbackQueue";

export interface UsePlaybackQueueArgs {
  orderedPaths: string[];
  selectedPaths: string[];
  nowPlaying: NowPlaying | null;
  activeQueue: string[] | null;
  play: (path: string) => void | Promise<void>;
  togglePause: () => void;
  stepQueue: (delta: 1 | -1) => void;
}

export function usePlaybackQueue({
  orderedPaths,
  selectedPaths,
  nowPlaying,
  activeQueue,
  play,
  togglePause,
  stepQueue,
}: UsePlaybackQueueArgs) {
  const index = activeQueue && nowPlaying ? activeQueue.indexOf(nowPlaying.path) : -1;
  const canGoPrevious = activeQueue != null && index > 0;
  const canGoNext = activeQueue != null && index !== -1 && index < activeQueue.length - 1;

  // Doubles as "start": with nothing loaded, the button plays the sole
  // selected track, the first of the selection, or the first of the table —
  // whichever `orderedPaths`/`selectedPaths` currently call for. Once
  // something is loaded, it's a plain pause/resume regardless of the
  // selection.
  const onPlayPause = useCallback(() => {
    if (nowPlaying) {
      togglePause();
      return;
    }
    const queue = effectiveQueue(orderedPaths, selectedPaths);
    const first = selectedPaths.length === 1 ? selectedPaths[0] : queue[0];
    if (first) void play(first);
  }, [nowPlaying, togglePause, selectedPaths, orderedPaths, play]);

  const onPrevious = useCallback(() => stepQueue(-1), [stepQueue]);
  const onNext = useCallback(() => stepQueue(1), [stepQueue]);

  return { canGoPrevious, canGoNext, onPlayPause, onPrevious, onNext };
}
