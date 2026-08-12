// Right-click menu on the results table's header: check/uncheck a column to
// show or hide it — see useColumnPrefs.ts for how the choice is computed and
// persisted. Reordering itself lives outside this menu entirely: press and
// hold a header cell in the table and drag it (useColumnDrag.ts), the same
// direct-manipulation gesture the table's own rows already use
// (useRowDrag.ts) — this menu used to also carry a pair of up/down buttons
// for it, which the header drag replaced.
//
// Anchored at the click position (a plain backdrop + absolutely-positioned
// panel) rather than centered like Modal.tsx: this is a small, transient
// picker dismissed by clicking anywhere else, not a dialog read top to
// bottom.

import { useEffect } from "react";

import type { ColumnDef, ColumnKey } from "./resultColumns";
import "./ColumnMenu.css";

export interface ColumnMenuProps {
  open: boolean;
  /// Viewport coordinates from the triggering `contextmenu` event.
  x: number;
  y: number;
  rows: { col: ColumnDef; visible: boolean }[];
  onToggle: (key: ColumnKey) => void;
  onClose: () => void;
}

export function ColumnMenu({ open, x, y, rows, onToggle, onClose }: ColumnMenuProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="column-menu-backdrop"
      onClick={onClose}
      onContextMenu={(ev) => {
        // A second right-click anywhere else closes this one instead of
        // stacking a new browser context menu on top of it.
        ev.preventDefault();
        onClose();
      }}
    >
      <div className="column-menu" style={{ left: x, top: y }} onClick={(ev) => ev.stopPropagation()}>
        {rows.map(({ col, visible }) => (
          <div className="column-menu-row" key={col.key}>
            <label className="column-menu-check">
              <input type="checkbox" checked={visible} onChange={() => onToggle(col.key)} />
              {col.label}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
