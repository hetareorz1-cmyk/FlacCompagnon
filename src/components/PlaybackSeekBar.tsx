// The footer's right section: a volume control (click the icon to mute,
// hover to reveal a slider) followed by the seek bar — click or drag
// anywhere on the track to move the playhead. Dragging uses the same
// document-level mousemove/mouseup pattern as useRowDrag.ts, for the same
// reason: the pointer can leave the track's own bounds mid-drag and still
// needs to keep updating the position.

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
  const dragging = useRef(false);
  const disabled = duration == null || duration <= 0;

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

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (dragging.current) seekFromClientX(ev.clientX);
    };
    const onUp = () => {
      dragging.current = false;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [seekFromClientX]);

  const pct = disabled ? 0 : Math.min(100, Math.max(0, (position / duration) * 100));

  return (
    <div className="playback-seekbar">
      <div className="playback-volume">
        <IconButton
          icon={volumeIcon(volume, muted)}
          title={muted ? "Unmute" : "Mute"}
          onClick={onToggleMute}
        />
        <div className="playback-volume-slider">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((muted ? 0 : volume) * 100)}
            onChange={(ev) => onVolumeChange(Number(ev.target.value) / 100)}
            aria-label="Volume"
          />
        </div>
      </div>
      <span className="playback-time">{fmtDuration(position)}</span>
      <div
        ref={trackRef}
        className={`playback-track${disabled ? " disabled" : ""}`}
        onMouseDown={(ev) => {
          if (disabled) return;
          dragging.current = true;
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
