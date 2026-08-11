// The footer's right section: a volume control (click the icon to mute,
// hover directly over the slider to reveal it — see PlaybackSeekBar.css for
// why it's the slider's own hover and not the icon's) followed by the seek
// bar — click or drag anywhere on the track to move the playhead.
//
// Both the volume slider and the seek bar are the same hand-drawn track/
// fill/head trio (not a native `<input type="range">`) so their handles are
// pixel-identical — a native range's thumb can't be resized to match without
// fighting each browser engine's own (and inconsistent) centering of a
// custom-sized thumb against a custom-height track. Dragging either uses the
// same document-level mousemove/mouseup pattern as useRowDrag.ts, for the
// same reason: the pointer can leave the track's own bounds mid-drag and
// still needs to keep updating the position.

import { useCallback, useEffect, useRef } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { fmtDuration } from "../format";
import { IconButton } from "./IconButton";
import "./PlaybackSeekBar.css";

export interface PlaybackSeekBarProps {
  /// Seconds into the current track — meaningless (and the bar disabled)
  /// while `duration` is `null`.
  position: number;
  /// The currently-loaded track's length, or `null` when nothing is loaded.
  duration: number | null;
  volume: number;
  muted: boolean;
  onSeek: (seconds: number) => void;
  onToggleMute: () => void;
  onVolumeChange: (v: number) => void;
}

function volumeIcon(volume: number, muted: boolean) {
  if (muted || volume === 0) return <VolumeX size={16} strokeWidth={1.7} />;
  if (volume < 0.5) return <Volume1 size={16} strokeWidth={1.7} />;
  return <Volume2 size={16} strokeWidth={1.7} />;
}

export function PlaybackSeekBar({
  position,
  duration,
  volume,
  muted,
  onSeek,
  onToggleMute,
  onVolumeChange,
}: PlaybackSeekBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const seekDragging = useRef(false);
  const disabled = duration == null || duration <= 0;

  const volumeTrackRef = useRef<HTMLDivElement>(null);
  const volumeDragging = useRef(false);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration == null || duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const frac = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
      onSeek(frac * duration);
    },
    [duration, onSeek],
  );

  const volumeFromClientX = useCallback(
    (clientX: number) => {
      const track = volumeTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const frac = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
      onVolumeChange(frac);
    },
    [onVolumeChange],
  );

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (seekDragging.current) seekFromClientX(ev.clientX);
      if (volumeDragging.current) volumeFromClientX(ev.clientX);
    };
    const onUp = () => {
      seekDragging.current = false;
      volumeDragging.current = false;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [seekFromClientX, volumeFromClientX]);

  const pct = disabled ? 0 : Math.min(100, Math.max(0, (position / duration) * 100));
  const volumePct = Math.round((muted ? 0 : volume) * 100);

  return (
    <div className="playback-seekbar">
      <div className="playback-volume">
        <IconButton
          icon={volumeIcon(volume, muted)}
          title={muted ? "Unmute" : "Mute"}
          onClick={onToggleMute}
        />
        <div className="playback-volume-slider">
          <div
            ref={volumeTrackRef}
            className="playback-track volume-track"
            role="slider"
            tabIndex={0}
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={volumePct}
            onMouseDown={(ev) => {
              volumeDragging.current = true;
              volumeFromClientX(ev.clientX);
            }}
            onKeyDown={(ev) => {
              if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
                ev.preventDefault();
                onVolumeChange(Math.min(1, (muted ? 0 : volume) + 0.05));
              } else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
                ev.preventDefault();
                onVolumeChange(Math.max(0, (muted ? 0 : volume) - 0.05));
              }
            }}
          >
            <div className="playback-track-fill" style={{ width: `${volumePct}%` }} />
            <div className="playback-track-head" style={{ left: `${volumePct}%` }} />
          </div>
        </div>
      </div>
      <span className="playback-time">{fmtDuration(position)}</span>
      <div
        ref={trackRef}
        className={`playback-track${disabled ? " disabled" : ""}`}
        onMouseDown={(ev) => {
          if (disabled) return;
          seekDragging.current = true;
          seekFromClientX(ev.clientX);
        }}
      >
        <div className="playback-track-fill" style={{ width: `${pct}%` }} />
        <div className="playback-track-head" style={{ left: `${pct}%` }} />
      </div>
      <span className="playback-time playback-time-total">
        {duration != null ? fmtDuration(duration) : "—:—"}
      </span>
    </div>
  );
}
