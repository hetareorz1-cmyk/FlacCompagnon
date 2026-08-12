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

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { fmtDuration } from "../format";
import { IconButton } from "./IconButton";
import "./PlaybackSeekBar.css";

const SHOW_REMAINING_KEY = "playbackShowRemaining";

// Same wrapped-localStorage pattern as useTheme.ts/useColumnPrefs.ts: a
// webview with storage disabled would otherwise throw on startup.
function storedShowRemaining(): boolean {
  try {
    return localStorage.getItem(SHOW_REMAINING_KEY) === "1";
  } catch {
    return false;
  }
}

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

// Driven by the already-rounded percentage shown in the bar, not the raw
// `volume` float: repeated keyboard nudges (`volume - 0.05` clamped to a
// floor of 0 with `Math.max`) can leave a tiny positive residue like
// 5.5e-17 once floating-point drift creeps in — `Math.max` only clamps
// values that actually go negative, not ones that undershoot zero and land
// just above it. That residue rounds to "0%" on screen but fails a strict
// `volume === 0` check, so the icon stayed on Volume1 at an apparently-muted
// slider. Comparing the rounded percentage keeps the icon and the bar
// reading the same number always.
function volumeIcon(pct: number, muted: boolean) {
  if (muted || pct === 0) return <VolumeX size={16} strokeWidth={1.7} />;
  if (pct < 50) return <Volume1 size={16} strokeWidth={1.7} />;
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
  // Persists across tracks (not reset on load) — most players treat this as a
  // standing display preference, not a per-track toggle — and now across
  // restarts too, same as the column order (useColumnPrefs.ts) and the
  // theme (useTheme.ts).
  const [showRemaining, setShowRemaining] = useState(storedShowRemaining);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_REMAINING_KEY, showRemaining ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [showRemaining]);

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
  // Always the actual level, even while muted: forcing this to 0 whenever
  // `muted` was true used to pin the thumb at the track's left edge no
  // matter where a drag moved it — `onVolumeChange` was still updating the
  // real `volume` underneath, but the bar snapped straight back to 0 on
  // every re-render, reading as "the slider doesn't respond while muted".
  // Muted-and-silent is communicated by the icon alone (see `volumeIcon`).
  const volumePct = Math.round(volume * 100);

  return (
    <div className="playback-seekbar">
      <div className="playback-volume">
        <IconButton
          icon={volumeIcon(volumePct, muted)}
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
              // Grabbing the slider while muted unmutes, same as most media
              // players: reaching for the volume control is a request to
              // hear something again, not a request to silently move a
              // slider that stays silenced. Without this, adjusting volume
              // after a mute felt broken twice over — muted still ignoring
              // the new level *and* the bar not visibly moving (the
              // `volumePct` fix above).
              if (muted) onToggleMute();
              volumeDragging.current = true;
              volumeFromClientX(ev.clientX);
            }}
            onKeyDown={(ev) => {
              if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
                ev.preventDefault();
                if (muted) onToggleMute();
                onVolumeChange(Math.min(1, volume + 0.05));
              } else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
                ev.preventDefault();
                if (muted) onToggleMute();
                onVolumeChange(Math.max(0, volume - 0.05));
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
      <span
        className="playback-time playback-time-total"
        role="button"
        tabIndex={0}
        title={showRemaining ? "Show total duration" : "Show remaining time"}
        onClick={() => setShowRemaining((v) => !v)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            setShowRemaining((v) => !v);
          }
        }}
      >
        {duration == null
          ? "—:—"
          : showRemaining
            ? `-${fmtDuration(Math.max(0, duration - position))}`
            : fmtDuration(duration)}
      </span>
    </div>
  );
}
