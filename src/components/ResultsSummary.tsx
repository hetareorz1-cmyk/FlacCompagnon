// The chip strip above the table: how many files, and how many tripped each
// detection. Only non-zero counts get a chip, so a clean folder shows one
// chip rather than a row of zeroes.

import { Folder } from "lucide-react";

import type { FolderReport } from "../types";
import * as api from "../api";
import { IconButton } from "./IconButton";
import "./ResultsSummary.css";

export interface ResultsSummaryProps {
  report: FolderReport;
  /// Deepest folder containing every listed file.
  rootPath: string;
  /// How many rows the search filter (TopBar) currently shows; `null` when no
  /// filter is active, in which case the count line only shows the total —
  /// exactly as before the filter existed.
  visibleCount: number | null;
  onToast: (msg: string, kind?: "info" | "error") => void;
}

export function ResultsSummary({ report, rootPath, visibleCount, onToast }: ResultsSummaryProps) {
  let clean = 0;
  let upscaled = 0;
  let upsampled = 0;
  let transcoded = 0;
  let suspicious = 0;
  let md5Bad = 0;
  let md5Missing = 0;

  for (const f of report.files) {
    const d = f.detections;
    if (d.summary === "Clean") clean++;
    if (d.summary === "Suspicious") suspicious++;
    if (d.upscaling) upscaled++;
    if (d.upsampling) upsampled++;
    if (d.transcoding === "detected") transcoded++;
    if (f.flac_md5?.state === "Mismatch") md5Bad++;
    if (f.flac_md5?.state === "NoSignature") md5Missing++;
  }

  const chips: { cls: string; label: string; n: number }[] = [
    { cls: "v-clean", label: "clean", n: clean },
    { cls: "v-upscaled", label: "upscaled", n: upscaled },
    { cls: "v-upsampled", label: "upsampled", n: upsampled },
    { cls: "v-transcoded", label: "transcoded", n: transcoded },
    { cls: "v-suspected", label: "suspicious", n: suspicious },
  ];
  if (report.has_flac) {
    chips.push({ cls: "v-bad", label: "MD5 mismatch", n: md5Bad });
    // A missing signature is not an error, just missing information.
    chips.push({ cls: "v-muted", label: "no MD5", n: md5Missing });
  }

  return (
    <div className="results-head">
      <div className="summary">
        <span className="count">
          {report.files.length} files
          {visibleCount != null && (
            <span className="count-filtered"> · {visibleCount} shown</span>
          )}
        </span>{" "}
        {chips
          .filter((c) => c.n > 0)
          .map((c) => (
            <span className={`chip ${c.cls}`} key={c.cls}>
              {c.n} {c.label}
            </span>
          ))}
      </div>
      <div className="results-meta">
        <span className="muted results-meta-path" title={rootPath}>
          {rootPath}
        </span>
        {rootPath && (
          <IconButton
            icon={<Folder size={14} strokeWidth={1.5} />}
            title="Open this folder"
            onClick={() => {
              api.openFolder(rootPath).catch((e) => onToast(String(e), "error"));
            }}
          />
        )}
      </div>
    </div>
  );
}
