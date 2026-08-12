//! End-to-end analysis of one file: pick a decode path, run the streaming
//! analyzer over it, and turn the raw measurements into a verdict.
//!
//! This is the orchestration layer. Every measurement it uses comes from
//! elsewhere ([`analyzer`](crate::analyzer) and the per-metric modules), and
//! the verdict logic lives in [`detections`](crate::detections) — what happens
//! here is choosing *which* path a file takes and assembling the result.
//!
//! This file holds the PCM path (FLAC's fused pass, or the generic Symphonia
//! one); the DSD path is [`dsd`], which shares almost nothing with it.
//!
//! [`analyze_file`] never returns an `Err`: a file that cannot be decoded comes
//! back with [`FileAnalysis::error`] set and best-effort defaults elsewhere, so
//! one bad file never aborts a batch.

mod dsd;

use std::path::Path;

use crate::decode;
use crate::detections::{self, Detections, TranscodeState};
use crate::dsd as dsd_format;
use crate::flac_md5::FlacMd5Status;
use crate::types::{ClippingInfo, FileAnalysis, ScanOptions};

/// Analyze a single audio file end-to-end.
///
/// The file is opened **read-only** and never modified. This never panics and
/// never returns an `Err`.
///
/// ```no_run
/// use std::path::Path;
/// use flaccompagnon_core::{analyze_file, FlacMd5Status, ScanOptions};
///
/// let r = analyze_file(Path::new("track.flac"), &ScanOptions::default());
///
/// // The three authenticity detections are independent: a file may trip none,
/// // one, or several of them.
/// println!("upscaled:   {}", r.detections.upscaling);
/// println!("upsampled:  {}", r.detections.upsampling);
/// println!("transcoded: {:?}", r.detections.transcoding);
///
/// // Integrity extras.
/// if matches!(r.flac_md5, Some(FlacMd5Status::Mismatch)) {
///     println!("the decoded audio does not match the stored MD5!");
/// }
/// if let Some(dr) = r.dr_db {
///     println!("dynamic range: {dr:.1} dB");
/// }
/// ```
pub fn analyze_file(path: &Path, opts: &ScanOptions) -> FileAnalysis {
    let mut result = skeleton(path);

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    // DSD files take a dedicated path: exact header verification, then (when
    // ffmpeg is available) content analysis on the decoded PCM.
    if ext == "dsf" || ext == "dff" {
        dsd::analyze(path, opts, &mut result);
        flag_container_mismatch(path, &mut result, false);
        return result;
    }

    let is_flac = ext == "flac";
    // Single decode pass. FLAC files go through the fused claxon path, which
    // feeds the analyzer AND hashes the MD5 from the same decoded samples —
    // nothing is decoded twice. If that fast path fails (corrupt or misnamed
    // file), fall back to symphonia so the analysis still happens; the MD5
    // column then reports the error.
    let mut flac_md5_status: Option<FlacMd5Status> = None;
    let decoded = if is_flac {
        match decode::decode_and_analyze_flac(path, opts.verify_flac_md5) {
            Ok((outcome, md5)) => {
                flac_md5_status = Some(md5);
                Ok(outcome)
            }
            Err(e) => {
                flac_md5_status = Some(FlacMd5Status::Error(e.to_string()));
                decode::decode_and_analyze(path)
            }
        }
    } else {
        decode::decode_and_analyze(path)
    };

    // Sigma-delta noise heritage of a DSD master, when found in hi-res PCM.
    let mut dsd_heritage: Option<f32> = None;
    match decoded {
        Ok(outcome) => dsd_heritage = apply_outcome(outcome, &mut result),
        Err(e) => result.error = Some(e.to_string()),
    }

    // Real container from magic bytes; flag a mismatch with the extension.
    flag_container_mismatch(path, &mut result, true);

    // FLAC MD5 signature, computed during the single decode pass above.
    if is_flac {
        result.flac_md5 = flac_md5_status;
    }

    result.badge = hires_badge(&result, dsd_heritage);
    result.bitrate_kbps = bitrate_kbps(result.size_bytes, result.duration_secs);
    result
}

/// The record we can already fill in before decoding anything, so an
/// unreadable file still produces a useful row.
fn skeleton(path: &Path) -> FileAnalysis {
    // Read once, up front, from the filesystem: available even for a file
    // whose audio fails to decode, so an unreadable track still reports an
    // honest size (and modification time) in the table. One `metadata` call
    // rather than two separate ones for size and mtime.
    let meta = std::fs::metadata(path).ok();
    let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified_unix = meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| {
        t.duration_since(std::time::UNIX_EPOCH)
            .ok()
            .and_then(|d| i64::try_from(d.as_secs()).ok())
    });

    FileAnalysis {
        path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string(),
        format: String::new(),
        codec: None,
        ext_mismatch: false,
        sample_rate: 0,
        channels: 0,
        declared_bits: None,
        duration_secs: 0.0,
        size_bytes,
        bitrate_kbps: None, // filled in once `duration_secs` is known — see `analyze_file`
        modified_unix,
        detections: Detections::unknown(),
        cutoff_hz: None,
        cutoff_ratio: None,
        real_bit_depth: None,
        requant_rate: None,
        fake_stereo: None,
        badge: None,
        clipping: ClippingInfo::unmeasured(),
        dr_db: None,
        flac_md5: None,
        error: None,
    }
}

/// Average bitrate in kbps from the file's own size and duration — see
/// [`FileAnalysis::bitrate_kbps`] for why this (not a codec-reported figure)
/// is what's shown.
fn bitrate_kbps(size_bytes: u64, duration_secs: f64) -> Option<u32> {
    if duration_secs <= 0.0 {
        return None;
    }
    let kbps = (size_bytes as f64 * 8.0) / duration_secs / 1000.0;
    if kbps.is_finite() && kbps >= 0.0 {
        Some(kbps.round() as u32)
    } else {
        None
    }
}

/// Fold a successful decode into `result`, and return the DSD-heritage rise
/// (in dB) if the ultrasonic content shows one.
fn apply_outcome(outcome: decode::DecodeOutcome, result: &mut FileAnalysis) -> Option<f32> {
    result.format = outcome.format;
    result.codec = outcome.codec;
    result.sample_rate = outcome.sample_rate;
    result.channels = outcome.channels;
    result.declared_bits = outcome.declared_bits;
    result.duration_secs = outcome.duration_secs;

    let summary = outcome
        .analyzer
        .finish(outcome.sample_rate, outcome.declared_bits);

    result.cutoff_hz = Some(summary.cutoff_hz);
    result.cutoff_ratio = Some(summary.cutoff_ratio);
    result.requant_rate = summary.requant_rate;
    result.clipping = summary.clipping.clone();
    result.dr_db = summary.dr_db;

    if outcome.channels >= 2 {
        result.fake_stereo = Some(summary.fake_stereo);
    }
    let real_bits = match (outcome.declared_bits, summary.real_bit_depth) {
        (Some(_), Some(real)) => {
            result.real_bit_depth = Some(real);
            Some(real)
        }
        _ => None,
    };
    result.detections = detections::classify(
        &summary,
        outcome.sample_rate,
        outcome.declared_bits,
        real_bits,
    );

    dsd_format::dsd_heritage_check(
        &summary.spectrum_db,
        outcome.sample_rate,
        summary.fft_size(),
    )
}

/// Compare the container the magic bytes say this is against what the
/// extension claims. `overwrite_format` is false on the DSD path, where
/// `format` already holds the more informative "DSD64" style label.
///
/// Only actually overwrites `result.format` when the extension turns out to
/// have lied about the container (`ext_mismatch`) or wasn't recognized at
/// all — otherwise `result.format` already carries `format_label`'s richer,
/// codec-aware value (e.g. "AAC/MP4" vs "ALAC/MP4", see its doc comment) and
/// `detected` here is only ever the bare container name ("MP4" either way),
/// which would silently downgrade a correct, more specific label back to a
/// less specific — but not wrong — one on every single file, mismatch or
/// not. This used to do exactly that unconditionally.
fn flag_container_mismatch(path: &Path, result: &mut FileAnalysis, overwrite_format: bool) {
    let Some(detected) = decode::detect_container(path) else {
        return;
    };
    let expected = decode::ext_canonical(path);
    if let Some(expected) = expected {
        result.ext_mismatch = detected != expected;
    }
    if overwrite_format && (expected.is_none() || result.ext_mismatch) {
        result.format = detected.to_string();
    }
}

/// Codec labels (`FileAnalysis::codec`) that are inherently lossy — a badge
/// claiming Hi-Res quality must never survive one of these, no matter what
/// the container or extension implied. This is a backstop alongside the
/// three detections below, not a replacement for them: those look at the
/// decoded *audio* and catch a lossy source re-wrapped in a nominally
/// lossless codec (transcoding); this catches Symphonia's own codec
/// identification admitting outright that the codec itself is lossy — e.g.
/// an AAC stream sitting in an `.m4a` container that could equally hold
/// ALAC (see `codec`'s own doc comment).
const LOSSY_CODECS: &[&str] = &["AAC", "MP1", "MP2", "MP3", "Opus", "Vorbis"];

/// Verified Hi-Res badge: hi-res specs that no detection contradicts.
fn hires_badge(result: &FileAnalysis, dsd_heritage: Option<f32>) -> Option<String> {
    let hires_specs =
        result.sample_rate > 48_000 || result.declared_bits.is_some_and(|b| b > 16);
    let lossy_codec = result.codec.as_deref().is_some_and(|c| LOSSY_CODECS.contains(&c));
    if !hires_specs
        || lossy_codec
        || result.error.is_some()
        || result.detections.upscaling
        || result.detections.upsampling
        || result.detections.transcoding == TranscodeState::Detected
    {
        return None;
    }
    Some(if dsd_heritage.is_some() {
        // Hi-res PCM carrying the sigma-delta noise signature of a DSD master.
        "Hi-Res (DSD source)".to_string()
    } else {
        "Hi-Res".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hi-res-on-paper specs (96 kHz/24-bit) with everything else clean —
    /// only `codec` varies between the test cases below.
    fn hires_pcm(codec: Option<&str>) -> FileAnalysis {
        FileAnalysis {
            path: "/music/a.m4a".into(),
            file_name: "a.m4a".into(),
            format: "ALAC/MP4".into(),
            codec: codec.map(str::to_string),
            ext_mismatch: false,
            sample_rate: 96_000,
            channels: 2,
            declared_bits: Some(24),
            duration_secs: 200.0,
            size_bytes: 40_000_000,
            bitrate_kbps: None,
            modified_unix: None,
            detections: Detections {
                upscaling: false,
                upsampling: false,
                transcoding: TranscodeState::None,
                detail: String::new(),
                summary: "Clean".into(),
            },
            cutoff_hz: None,
            cutoff_ratio: None,
            real_bit_depth: Some(24),
            requant_rate: None,
            fake_stereo: Some(false),
            badge: None,
            clipping: ClippingInfo::unmeasured(),
            dr_db: Some(14.0),
            flac_md5: None,
            error: None,
        }
    }

    /// The bug this backstop exists for: an AAC stream sitting in an `.m4a`
    /// container (extension/container implying ALAC, i.e. lossless) must
    /// never earn a Hi-Res badge just because its declared specs look
    /// hi-res — the codec itself says lossy, full stop.
    #[test]
    fn hires_badge_refuses_a_known_lossy_codec() {
        assert_eq!(hires_badge(&hires_pcm(Some("AAC")), None), None);
        assert_eq!(hires_badge(&hires_pcm(Some("MP3")), None), None);
    }

    /// Same specs, lossless (or unresolved — FLAC/DSD always report `codec:
    /// None`) codec: the guard must not become a blanket "no badge for a
    /// multi-codec container" rule.
    #[test]
    fn hires_badge_still_grants_lossless_codecs() {
        assert_eq!(hires_badge(&hires_pcm(Some("ALAC")), None), Some("Hi-Res".to_string()));
        assert_eq!(hires_badge(&hires_pcm(None), None), Some("Hi-Res".to_string()));
    }
}
