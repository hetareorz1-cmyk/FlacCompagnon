// A footer bar grafted directly onto the bottom of the results table — see
// Footer.css and ResultsTable.css's `.table-wrap` for the flat-seam styling
// that makes the two read as one piece. Rendered as the table's own next
// sibling inside `.results` (App.tsx), not elsewhere, so it only ever
// spans the table's width, not the tag panel beside it, and shares its
// `hasResults` condition — nothing to summarize or play before then.

import type { FileAnalysis } from "../types";
import type { NowPlaying } from "./usePlayback";
import { FooterStats } from "./FooterStats";
import { PlaybackSeekBar } from "./PlaybackSeekBar";
import { PlaybackTransport } from "./PlaybackTransport";
import "./Footer.css";

export interface FooterProps {
  files: FileAnalysis[];
  selectedPaths: string[];
  nowPlaying: NowPlaying | null;
  paused: boolean;
  position: number;
  volume: number;
  muted: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onTogglePause: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onToggleMute: () => void;
  onVolumeChange: (v: number) => void;
}

export function Footer({
  files,
  selectedPaths,
  nowPlaying,
  paused,
  position,
  volume,
  muted,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onTogglePause,
  onNext,
  onSeek,
  onToggleMute,
  onVolumeChange,
}: FooterProps) {
  const playingFile = nowPlaying ? files.find((f) => f.path === nowPlaying.path) : undefined;
  const duration = playingFile ? playingFile.duration_secs : null;

  return (
    <div className="footer">
      <FooterStats files={files} selectedPaths={selectedPaths} />
      <PlaybackTransport
        canGoPrevious={canGoPrevious}
        canGoNext={canGoNext}
        playing={nowPlaying != null && !paused}
        onPrevious={onPrevious}
        onTogglePause={onTogglePause}
        onNext={onNext}
      />
      <PlaybackSeekBar
        position={position}
        duration={duration}
        volume={volume}
        muted={muted}
        onSeek={onSeek}
        onToggleMute={onToggleMute}
        onVolumeChange={onVolumeChange}
      />
    </div>
  );
}
