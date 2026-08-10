// The action bar. Purely presentational: every button reports upwards, and
// what's enabled is decided by the app state passed in.

import { useRef } from "react";
import { Search, X } from "lucide-react";

import { IconButton } from "./IconButton";
import { useTheme } from "./useTheme";
import "./TopBar.css";

export interface TopBarProps {
  busy: boolean;
  hasReport: boolean;
  canGenerateSpectrograms: boolean;
  /// ffmpeg wasn't found — the spectrogram button explains why it's disabled
  /// rather than looking broken.
  ffmpegAvailable: boolean;
  /// Filters which rows the table *renders* — see ResultsTable's
  /// `visiblePaths`. Matches everything a row displays (format, bit depth,
  /// detections, ...), not just the file name — see `fileSearchText`. Never
  /// touches playback, selection, drag order or exports, which all keep
  /// working off the full list.
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onPick: () => void;
  onSave: () => void;
  onExportPlaylist: () => void;
  onGenerateSpectrograms: () => void;
  onReset: () => void;
}

export function TopBar({
  busy,
  hasReport,
  canGenerateSpectrograms,
  ffmpegAvailable,
  searchQuery,
  onSearchChange,
  onPick,
  onSave,
  onExportPlaylist,
  onGenerateSpectrograms,
  onReset,
}: TopBarProps) {
  const theme = useTheme();
  const searchInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <div className="topbar-search">
        <Search className="topbar-search-icon" size={14} strokeWidth={1.8} aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Filter…"
          value={searchQuery}
          disabled={!hasReport}
          onChange={(ev) => onSearchChange(ev.target.value)}
        />
        {/* Only rendered once there's something to clear, and even then only
            revealed on hover (see .topbar-search:hover in TopBar.css) — a
            permanently visible cross here read as a delete affordance, which
            this isn't: it just resets the display filter. Refocusing the
            field afterwards (rather than leaving focus on the now-vanished
            button) means typing a new query doesn't need an extra click. */}
        {searchQuery && (
          <IconButton
            icon={<X size={12} strokeWidth={2} />}
            title="Clear filter"
            variant="close"
            className="topbar-search-clear"
            onClick={() => {
              onSearchChange("");
              searchInputRef.current?.focus();
            }}
          />
        )}
      </div>
      <div className="actions">
        <button className="btn" disabled={busy} onClick={onPick}>
          Choose folder…
        </button>
        <button className="btn btn-secondary" disabled={busy || !hasReport} onClick={onSave}>
          Save…
        </button>
        <button
          className="btn btn-secondary"
          disabled={busy || !hasReport}
          onClick={onExportPlaylist}
        >
          Export playlist…
        </button>
        <button
          className="btn btn-secondary"
          disabled={busy || !canGenerateSpectrograms || !ffmpegAvailable}
          title={
            ffmpegAvailable
              ? ""
              : "ffmpeg was not found on your system — install it to enable spectrograms"
          }
          onClick={onGenerateSpectrograms}
        >
          Generate spectrograms
        </button>
        {!busy && hasReport && (
          <button className="btn btn-ghost" onClick={onReset}>
            Reset
          </button>
        )}
        <button
          className="btn btn-ghost"
          title="Switch theme (Auto / Light / Dark)"
          onClick={theme.cycle}
        >
          {theme.label}
        </button>
      </div>
    </header>
  );
}
