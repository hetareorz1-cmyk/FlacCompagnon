//! Report generation: a spreadsheet-friendly CSV, and a re-importable JSON that
//! round-trips the full [`FolderReport`] — every field the app computed,
//! nested detections included — so a saved analysis can be dropped back onto
//! the window later and rendered without re-decoding a single audio file.

use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{FlacMd5Status, FolderReport, TranscodeState};

/// Default file name suggested when saving a report.
pub const CSV_FILE_NAME: &str = "FlacCompagnon.csv";
/// Same stem, JSON sibling — `save` always writes both from one dialog pick.
pub const JSON_FILE_NAME: &str = "FlacCompagnon.json";

/// Marker written into every JSON report so a dropped file can be recognized
/// (and rejected with a clear message) before attempting to parse it as one.
const JSON_FORMAT_MARKER: &str = "flaccompagnon-report";
/// Bumped if the JSON shape ever changes incompatibly.
const JSON_FORMAT_VERSION: u32 = 1;

/// On-disk shape of the JSON report: the marker/version let a dropped file be
/// identified and versioned independently of [`FolderReport`]'s own shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct JsonReport {
    format: String,
    version: u32,
    report: FolderReport,
}

/// Build the CSV text for a folder report.
///
/// Column order mirrors the results table left-to-right (`ResultsTable.tsx`'s
/// `headers`), not the order fields were originally added to this struct —
/// so a column's position here means the same thing it means on screen.
/// Fields the table folds into a single cell (Detections: `status` +
/// `upscaling`/`upsampling`/`transcoding`/`aac_grid`; Clipping: `clipped` +
/// `clip_events`/`peak_dbfs`) are grouped together at that cell's position
/// rather than split across the row. No column is dropped — every field the
/// old order exported is still here, just reordered.
///
/// `codec` and `bitrate_kbps` are deliberately slotted mid-row — right after
/// `format` and right before `sample_rate` respectively — rather than at the
/// end, on the maintainer's explicit request, even though the table's own
/// column order is otherwise just a display preference (`useColumnPrefs.ts`)
/// this file doesn't follow. This *is* a breaking change for any script or
/// spreadsheet already reading the CSV by position: those two columns moved.
/// `modified_unix` stays appended at the end — nobody asked to move that one,
/// and there's no natural mid-row spot for it the way there is for the other
/// two.
pub fn build_csv(report: &FolderReport) -> String {
    let mut out = String::new();
    out.push_str(
        "file,format,codec,badge,bitrate_kbps,sample_rate,declared_bits,real_bit_depth,\
         duration_s,size_bytes,status,upscaling,upsampling,transcoding,aac_grid,cutoff_hz,\
         cutoff_ratio,channels,fake_stereo,clipped,clip_events,peak_dbfs,true_peak_dbtp,dr_db,\
         md5,modified_unix\n",
    );
    for f in &report.files {
        let md5 = f
            .flac_md5
            .as_ref()
            .map(|m| match m {
                FlacMd5Status::NoSignature => "none",
                FlacMd5Status::Present => "present",
                FlacMd5Status::Match => "ok",
                FlacMd5Status::Mismatch => "mismatch",
                FlacMd5Status::Error(_) => "error",
            })
            .unwrap_or("");
        let transcoding = match f.detections.transcoding {
            TranscodeState::None => "none",
            TranscodeState::Suspected => "suspected",
            TranscodeState::Detected => "detected",
        };
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{:.3},{},{},{},{},{},{},{},{},{},{},{},{},{:.2},{:.2},{},{},{}\n",
            csv_escape(&f.file_name),
            f.format,
            f.codec.clone().unwrap_or_default(),
            f.badge.clone().unwrap_or_default(),
            opt(f.bitrate_kbps),
            f.sample_rate,
            opt(f.declared_bits),
            opt(f.real_bit_depth),
            f.duration_secs,
            // Raw byte count, not a human-readable string: a spreadsheet can
            // then sum/sort it, and the reader picks their own unit convention.
            f.size_bytes,
            f.detections.summary,
            f.detections.upscaling,
            f.detections.upsampling,
            transcoding,
            f.requant_rate.map(|v| format!("{v:.3}")).unwrap_or_default(),
            f.cutoff_hz.map(|v| format!("{v:.0}")).unwrap_or_default(),
            f.cutoff_ratio.map(|v| format!("{v:.3}")).unwrap_or_default(),
            f.channels,
            opt_bool(f.fake_stereo),
            f.clipping.clipped,
            f.clipping.clip_events,
            f.clipping.peak_dbfs,
            f.clipping.true_peak_dbtp,
            f.dr_db.map(|v| format!("{v:.1}")).unwrap_or_default(),
            md5,
            opt(f.modified_unix),
        ));
    }
    out
}

/// Write the CSV report to `dest`.
pub fn write_csv(dest: &Path, report: &FolderReport) -> std::io::Result<()> {
    let mut file = std::fs::File::create(dest)?;
    file.write_all(build_csv(report).as_bytes())
}

/// Build the JSON text for a folder report (pretty-printed, wrapped with a
/// format marker and version — see `JsonReport`).
pub fn build_json(report: &FolderReport) -> serde_json::Result<String> {
    let wrapped = JsonReport {
        format: JSON_FORMAT_MARKER.to_string(),
        version: JSON_FORMAT_VERSION,
        report: report.clone(),
    };
    serde_json::to_string_pretty(&wrapped)
}

/// Write the JSON report to `dest`.
pub fn write_json(dest: &Path, report: &FolderReport) -> std::io::Result<()> {
    let text = build_json(report)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let mut file = std::fs::File::create(dest)?;
    file.write_all(text.as_bytes())
}

/// Parse a previously-saved JSON report back into a [`FolderReport`], so it
/// can be rendered without re-analyzing any audio. Rejects JSON that doesn't
/// carry FlacCompagnon's format marker, with a message meant for end users
/// (someone dropped an unrelated `.json` file).
///
/// ```
/// use flaccompagnon_core::{report, FolderReport};
///
/// let empty = FolderReport { root: "/music".into(), files: vec![], has_flac: false };
///
/// // build_json / parse_json round-trip the whole report.
/// let json = report::build_json(&empty).unwrap();
/// let back = report::parse_json(&json).unwrap();
/// assert_eq!(back.root, "/music");
///
/// // Unrelated JSON is refused with a message meant for the user.
/// assert!(report::parse_json(r#"{"hello":"world"}"#).is_err());
/// ```
pub fn parse_json(text: &str) -> Result<FolderReport, String> {
    let wrapped: JsonReport = serde_json::from_str(text).map_err(|e| {
        format!("This doesn't look like a FlacCompagnon JSON report ({e}).")
    })?;
    if wrapped.format != JSON_FORMAT_MARKER {
        return Err("This JSON file wasn't exported by FlacCompagnon.".to_string());
    }
    if wrapped.version > JSON_FORMAT_VERSION {
        return Err(
            "This report was saved by a newer version of FlacCompagnon — please update the app."
                .to_string(),
        );
    }
    Ok(wrapped.report)
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn opt<T: std::fmt::Display>(v: Option<T>) -> String {
    v.map(|x| x.to_string()).unwrap_or_default()
}

fn opt_bool(v: Option<bool>) -> String {
    v.map(|x| x.to_string()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::detections::{Detections, TranscodeState};
    use crate::{ClippingInfo, FileAnalysis};

    fn sample_file() -> FileAnalysis {
        FileAnalysis {
            path: "/music/a.flac".into(),
            file_name: "a.flac".into(),
            format: "FLAC".into(),
            codec: None,
            ext_mismatch: false,
            sample_rate: 44_100,
            channels: 2,
            declared_bits: Some(16),
            duration_secs: 183.4,
            size_bytes: 32_345_678,
            bitrate_kbps: Some(1412),
            modified_unix: Some(1_700_000_000),
            detections: Detections {
                upscaling: false,
                upsampling: false,
                transcoding: TranscodeState::None,
                detail: "Clean.".into(),
                summary: "Clean".into(),
            },
            cutoff_hz: Some(21000.0),
            cutoff_ratio: Some(0.95),
            real_bit_depth: Some(16),
            requant_rate: None,
            fake_stereo: Some(false),
            badge: None,
            clipping: ClippingInfo {
                clipped_samples: 0,
                clip_events: 0,
                peak: 0.9,
                peak_dbfs: -0.9,
                true_peak: 0.92,
                true_peak_dbtp: -0.7,
                clipped: false,
            },
            dr_db: Some(12.3),
            flac_md5: Some(FlacMd5Status::Match),
            error: None,
        }
    }

    #[test]
    fn csv_has_header_and_row() {
        let report = FolderReport {
            root: "/music".into(),
            files: vec![sample_file()],
            has_flac: true,
        };
        let csv = build_csv(&report);
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("file,format"));
        assert!(lines[0].contains(",md5,"));
        assert!(lines[0].trim_end().ends_with(",modified_unix"));
        assert!(lines[1].contains("a.flac"));
        assert!(lines[1].contains("ok"));
        // The size is exported as a raw byte count, not a formatted string,
        // so a spreadsheet can sum and sort it.
        assert!(lines[0].contains(",size_bytes,"));
        assert!(lines[1].contains(",32345678,"));
        // Header and row must stay in lockstep — an easy thing to break when
        // adding a column to one and forgetting the other.
        assert_eq!(
            lines[0].split(',').count(),
            lines[1].split(',').count(),
            "CSV header and row column counts must match"
        );
    }

    /// Locks in the maintainer's explicit request to move `codec` and
    /// `bitrate_kbps` out of their original "appended at the end" spot —
    /// see `build_csv`'s doc comment for why that's a deliberate exception.
    #[test]
    fn csv_places_codec_after_format_and_bitrate_before_sample_rate() {
        let report = FolderReport {
            root: "/music".into(),
            files: vec![sample_file()],
            has_flac: true,
        };
        let csv = build_csv(&report);
        let header: Vec<&str> = csv.lines().next().expect("header line").split(',').collect();
        assert_eq!(header.get(1), Some(&"format"));
        assert_eq!(header.get(2), Some(&"codec"));
        let bitrate_idx = header.iter().position(|&h| h == "bitrate_kbps").expect("bitrate_kbps");
        let rate_idx = header.iter().position(|&h| h == "sample_rate").expect("sample_rate");
        assert_eq!(bitrate_idx + 1, rate_idx, "bitrate_kbps must sit right before sample_rate");
    }

    #[test]
    fn json_round_trips_the_full_report() {
        let report = FolderReport {
            root: "/music".into(),
            files: vec![sample_file()],
            has_flac: true,
        };
        let json = build_json(&report).expect("serializes");
        assert!(json.contains("flaccompagnon-report"));
        let parsed = parse_json(&json).expect("parses back");
        assert_eq!(parsed.root, report.root);
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].file_name, "a.flac");
        assert_eq!(parsed.files[0].dr_db, Some(12.3));
        assert_eq!(parsed.files[0].clipping.true_peak_dbtp, -0.7);
        assert_eq!(parsed.files[0].flac_md5, Some(FlacMd5Status::Match));
        assert_eq!(parsed.files[0].size_bytes, 32_345_678);
    }

    /// A report exported before `size_bytes` existed must still load — the
    /// field is `serde(default)` precisely so an older `.json` dropped onto
    /// the window doesn't fail to parse.
    #[test]
    fn json_without_size_bytes_still_loads() {
        let report = FolderReport {
            root: "/music".into(),
            files: vec![sample_file()],
            has_flac: true,
        };
        let json = build_json(&report).expect("serializes");
        // Strip the field the way an older export simply wouldn't have it.
        let mut doc: serde_json::Value = serde_json::from_str(&json).unwrap();
        doc["report"]["files"][0]
            .as_object_mut()
            .unwrap()
            .remove("size_bytes");
        let older = serde_json::to_string(&doc).unwrap();

        let parsed = parse_json(&older).expect("older reports must still parse");
        assert_eq!(parsed.files[0].size_bytes, 0);
        assert_eq!(parsed.files[0].file_name, "a.flac");
    }

    #[test]
    fn json_rejects_unrelated_files() {
        // Not FlacCompagnon's shape at all — fails to deserialize.
        let err = parse_json(r#"{"hello": "world"}"#).unwrap_err();
        assert!(err.contains("doesn't look like"));

        // Right shape, wrong marker — deserializes fine, rejected on the check.
        let err2 = parse_json(
            r#"{"format": "something-else", "version": 1, "report": {"root": "", "files": [], "has_flac": false}}"#,
        )
        .unwrap_err();
        assert!(err2.contains("wasn't exported by FlacCompagnon"));
    }
}
