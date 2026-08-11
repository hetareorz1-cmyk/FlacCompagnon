// The footer's left section: total duration + size of every imported file,
// and the same pair for the current selection once there is one — same "· N"
// separator pattern as ResultsSummary uses above the table, without the word
// itself (ResultsSummary's own count line already spells out "N selected"
// right above this one, so repeating the word here was redundant).
// Deliberately ignores the search filter (see App.tsx's Footer wiring): the
// filter only ever changes what's *drawn*, so summing what it hides would
// make the total silently shrink while typing, which isn't what "total
// imported" means.

import type { FileAnalysis } from "../types";
import { fmtDurationLong, fmtSize } from "../format";
import "./FooterStats.css";

export interface FooterStatsProps {
  files: FileAnalysis[];
  selectedPaths: string[];
}

function totals(files: FileAnalysis[]) {
  let duration = 0;
  let size = 0;
  for (const f of files) {
    duration += f.duration_secs;
    size += f.size_bytes;
  }
  return { duration, size };
}

export function FooterStats({ files, selectedPaths }: FooterStatsProps) {
  const all = totals(files);
  const selectedSet = new Set(selectedPaths);
  const selected = selectedSet.size > 0 ? totals(files.filter((f) => selectedSet.has(f.path))) : null;

  return (
    <div className="footer-stats">
      <span>
        {fmtDurationLong(all.duration)} · {fmtSize(all.size)}
      </span>
      {selected && (
        <span className="footer-stats-selected">
          · {selectedSet.size} · {fmtDurationLong(selected.duration)} · {fmtSize(selected.size)}
        </span>
      )}
    </div>
  );
}
