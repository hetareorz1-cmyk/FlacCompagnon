// One row of the extended-tags pop-in: the tag's raw key and its value —
// plain text, or (after two well-spaced clicks on the value, same
// Mp3tag/Finder pattern as the inline file-rename field; see ResultsTable's
// RENAME_CLICK_GAP_MS) an editable field. Clicking anywhere on the row
// selects it — selection is what the pop-in's grouped +/− buttons act on
// (see ExtendedTagsModal), mirroring Mp3tag's own extended-tags list rather
// than a per-row remove button.

import { useEffect, useRef, useState } from "react";

import type { ExtendedRow } from "./tagSelection";

// Same reasoning as RENAME_CLICK_GAP_MS: comfortably above any OS's own
// double-click speed, so a real double click still just selects the row
// instead of being mistaken for two deliberate, separately-spaced clicks.
const EDIT_CLICK_GAP_MS = 500;

export interface ExtendedTagRowProps {
  row: ExtendedRow;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onSubmit: (value: string) => void;
  onCancelEdit: () => void;
}

export function ExtendedTagRow({
  row,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onSubmit,
  onCancelEdit,
}: ExtendedTagRowProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Only tracks clicks on *this* row's value — unlike the table's rename
  // gap-check, each row is its own component instance, so there's no need to
  // also compare against which row was clicked last.
  const lastClickTime = useRef<number | null>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(row.mixed ? "" : row.value);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing, row.value, row.mixed]);

  return (
    <div className={selected ? "ext-row selected" : "ext-row"} onClick={onSelect}>
      <div className="ext-key">{row.key}</div>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          className="ext-value-input"
          value={draft}
          placeholder={row.mixed ? "Multiple values" : ""}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") {
              ev.preventDefault();
              onCancelEdit();
            } else if (ev.key === "Enter") {
              ev.preventDefault();
              onSubmit(draft);
            }
          }}
          onBlur={() => onSubmit(draft)}
        />
      ) : (
        <div
          className={row.mixed ? "ext-value ext-mixed" : "ext-value"}
          onClick={(ev) => {
            const now = ev.timeStamp;
            const prev = lastClickTime.current;
            const secondClick = prev != null && now - prev > EDIT_CLICK_GAP_MS;
            lastClickTime.current = now;
            if (secondClick) onStartEdit();
          }}
        >
          {row.mixed ? "Multiple values" : row.value}
        </div>
      )}
    </div>
  );
}
