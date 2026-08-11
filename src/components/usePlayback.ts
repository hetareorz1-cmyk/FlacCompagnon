// Single-track preview playback.
//
// The audio itself lives in the Rust backend (a `cpal` stream owned by the
// audio thread), not here — which is why this module stops playback once on
// mount: a webview reload restarts the JS with no idea a track is playing,
// while the Rust side keeps going. Without that call the UI would look idle
// with audio still coming out and nothing left to stop it.
//
// `requestId` pairs each play with the backend's `playback://finished` event,
// so a stale notification from a track that was already superseded can't
// trigger auto-advance on the wrong row.

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlaybackFinished, PlaybackPosition } from "../types";
import * as api from "../api";
import { listen } from "@tauri-apps/api/event";

export interface NowPlaying {
  path: string;
  requestId: number;
}

export function usePlayback(
  orderedPaths: string[],
  onToast: (msg: string, kind?: "info" | "error") => void,
) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  // A footer-only concept layered on top of `nowPlaying` — the results
  // table's own row buttons (`togglePlay`) never look at this and keep
  // meaning "play this row / stop whatever's playing", exactly as before.
  // Only the footer's transport button tells a real pause/resume apart from
  // a full stop.
  const [paused, setPaused] = useState(false);
  // Seconds into the current track — from `playback://position` while
  // playing, or set optimistically the instant the footer's seek bar is
  // dragged (that event is throttled and stops arriving entirely while
  // paused, so waiting for it would make the bar lag behind the mouse).
  const [position, setPosition] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  // Mirrors `nowPlaying` for the "finished"/"position" listeners, which must
  // not read it through a state updater: React may invoke an updater more
  // than once, and auto-advance has to fire exactly once per finished track.
  const current = useRef<NowPlaying | null>(null);
  const orderRef = useRef(orderedPaths);
  orderRef.current = orderedPaths;

  useEffect(() => {
    current.current = nowPlaying;
  }, [nowPlaying]);

  useEffect(() => {
    api.stopPlayback().catch(() => {});
  }, []);

  const stop = useCallback(() => {
    setNowPlaying(null);
    setPaused(false);
    setPosition(0);
    api.stopPlayback().catch(() => {});
  }, []);

  const play = useCallback(
    async (path: string) => {
      try {
        const requestId = await api.playTrack(path);
        setNowPlaying({ path, requestId });
        setPaused(false);
        setPosition(0);
      } catch (e) {
        setNowPlaying(null);
        onToast(String(e), "error");
      }
    },
    [onToast],
  );

  const togglePlay = useCallback(
    (path: string) => {
      if (nowPlaying?.path === path) {
        stop();
        return;
      }
      void play(path);
    },
    [nowPlaying, play, stop],
  );

  /// Stop only if `path` is what's currently playing — used when that row is
  /// about to leave the table.
  const stopIfPlaying = useCallback(
    (path: string) => {
      if (nowPlaying?.path === path) stop();
    },
    [nowPlaying, stop],
  );

  // A real pause in place, resumed in place — see `usePlaybackQueue`'s
  // `onPlayPause`, which is what the footer's button actually calls: this
  // half only makes sense once something is already loaded, so it's a no-op
  // otherwise rather than the thing that decides what to start playing.
  const togglePause = useCallback(() => {
    if (!nowPlaying) return;
    const next = !paused;
    setPaused(next);
    const call = next ? api.pausePlayback() : api.resumePlayback();
    call.catch((e) => {
      setPaused(!next); // the backend didn't actually change state — undo
      onToast(String(e), "error");
    });
  }, [nowPlaying, paused, onToast]);

  const seek = useCallback(
    (seconds: number) => {
      if (!nowPlaying) return;
      setPosition(seconds); // optimistic — see `position`'s doc comment
      api.seekPlayback(seconds).catch((e) => onToast(String(e), "error"));
    },
    [nowPlaying, onToast],
  );

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    api.setVolume(clamped).catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      api.setMuted(next).catch(() => {});
      return next;
    });
  }, []);

  // Auto-advance to the next row in display order when a track ends on its
  // own; stop at the end of the list. Subscribed once — the handler reads the
  // current track and order from refs, so re-ordering the table mid-playback
  // doesn't tear down and rebuild the listener.
  useEffect(() => {
    const unlisten = listen<PlaybackFinished>("playback://finished", (e) => {
      const playing = current.current;
      // A stale notification from a track already superseded by a newer play.
      if (!playing || e.payload.request_id !== playing.requestId) return;
      const order = orderRef.current;
      const idx = order.indexOf(playing.path);
      const next = idx === -1 ? undefined : order[idx + 1];
      if (next) {
        void play(next);
      } else {
        current.current = null;
        setNowPlaying(null);
        setPaused(false);
        setPosition(0);
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [play]);

  // Drives the footer's seek bar while a track plays — throttled on the
  // backend (same cadence as the equalizer bars' level events), and simply
  // stops arriving while paused, which is exactly right: the bar should hold
  // still, not creep toward 0.
  useEffect(() => {
    const unlisten = listen<PlaybackPosition>("playback://position", (e) => {
      const playing = current.current;
      if (!playing || e.payload.request_id !== playing.requestId) return;
      setPosition(e.payload.position_secs);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  return {
    nowPlaying,
    paused,
    position,
    volume,
    muted,
    play,
    togglePlay,
    stopIfPlaying,
    stop,
    togglePause,
    seek,
    setVolume,
    toggleMute,
  };
}
