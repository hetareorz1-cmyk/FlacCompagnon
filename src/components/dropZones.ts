// The places a native OS file drop means something, and how the app-level
// handler finds them.
//
// There used to be three separate mechanisms for this — an imperative
// `containsPoint` on the tag panel, another on the conversion panel, and a
// bare ref hit-tested inline for the results list — each measuring a
// different element with its own copy of the same rectangle arithmetic. They
// drifted, as duplicated geometry does: two of them measured a wrapper around
// the visible box rather than the box itself, and a bug in the shared
// coordinate conversion stayed hidden for a long time because the two
// left-hand zones are wide enough to absorb it while the right-hand one is
// not. One declaration site, one lookup, no arithmetic.
//
// A component marks its own drop target by spreading `dropZone(kind)` onto
// the element the user actually sees; `dropZoneAt` resolves a point to
// whichever of them is under it, using the browser's own hit-testing (which
// already accounts for stacking, overflow, transforms and `pointer-events` —
// all things hand-rolled rectangle maths gets wrong).

/// The kinds of drop target, in the order a point is resolved against them —
/// which is to say, not at all: they never overlap, so the first hit wins.
export type DropZoneKind =
  /// The tag panel's artwork square. Takes exactly one image.
  | "cover"
  /// The results list: the empty-state dropzone before anything is
  /// analyzed, the table itself afterwards. The only place a drop imports
  /// audio for analysis.
  | "list"
  /// The conversion panel's own drop target. Imports for conversion without
  /// touching the results table.
  | "convert";

const ATTR = "data-drop-zone";

/// Spread onto the element that *is* the drop target — the painted box, not
/// a wrapper around it, or the hit area won't match what the user sees.
export function dropZone(kind: DropZoneKind): { "data-drop-zone": DropZoneKind } {
  return { [ATTR]: kind } as { "data-drop-zone": DropZoneKind };
}

/// Which drop zone, if any, sits under a point given in CSS pixels.
/// `closest` rather than an equality check, because the point usually lands
/// on something *inside* the zone (a table row, the cover image, a label).
export function dropZoneAt(cssX: number, cssY: number): DropZoneKind | null {
  const el = document.elementFromPoint(cssX, cssY);
  const zone = el?.closest(`[${ATTR}]`);
  const kind = zone?.getAttribute(ATTR);
  return kind === "cover" || kind === "list" || kind === "convert" ? kind : null;
}

/// Whether a point in CSS pixels is inside the webview at all. Used to work
/// out which unit an incoming drop position is in — see `useNativeDrop`.
export function isInsideViewport(cssX: number, cssY: number): boolean {
  return cssX >= 0 && cssY >= 0 && cssX <= window.innerWidth && cssY <= window.innerHeight;
}
