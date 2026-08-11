// The footer's center section: previous / play-pause / next. Purely a
// presentation of `usePlayback`'s state — App.tsx supplies the callbacks and
// decides what "previous"/"next" mean (the table's current display order).

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { IconButton } from "./IconButton";
import "./PlaybackTransport.css";

export interface PlaybackTransportProps {
  /// Previous/Next reflect `usePlaybackQueue`: disabled with nothing loaded,
  /// with exactly one row selected (a deliberate single preview, not a
  /// queue), or at either end of whichever list applies.
  canGoPrevious: boolean;
  canGoNext: boolean;
  /// True while a track is loaded and actually outputting sound — false both
  /// when nothing is loaded and while paused, so the button shows a Play
  /// glyph in either case.
  playing: boolean;
  /// Never disabled: with nothing loaded it starts the appropriate first
  /// track (see `usePlaybackQueue`'s `onPlayPause`) rather than doing
  /// nothing — the footer only renders once there's at least one file, so
  /// there's always something for it to play.
  onPrevious: () => void;
  onTogglePause: () => void;
  onNext: () => void;
}

export function PlaybackTransport({
  canGoPrevious,
  canGoNext,
  playing,
  onPrevious,
  onTogglePause,
  onNext,
}: PlaybackTransportProps) {
  return (
    <div className="playback-transport">
      <IconButton
        icon={<SkipBack size={15} strokeWidth={1.8} fill="currentColor" />}
        title="Previous track"
        onClick={onPrevious}
        disabled={!canGoPrevious}
      />
      <IconButton
        icon={
          playing ? (
            <Pause size={13} strokeWidth={1} fill="currentColor" />
          ) : (
            <Play size={13} strokeWidth={1} fill="currentColor" />
          )
        }
        title={playing ? "Pause" : "Play"}
        onClick={onTogglePause}
        className="playback-transport-playpause"
      />
      <IconButton
        icon={<SkipForward size={15} strokeWidth={1.8} fill="currentColor" />}
        title="Next track"
        onClick={onNext}
        disabled={!canGoNext}
      />
    </div>
  );
}
