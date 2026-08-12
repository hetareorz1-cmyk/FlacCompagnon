//! Converting audio files to another format: FLAC, Opus, MP3 or WAV.
//!
//! Like [`crate::tags`], this module **does** write to disk beyond the source
//! file it reads — one converted file per source, plus (optionally, see
//! [`passthrough_files`]) plain copies of whatever else shares its folder.
//! That is a deliberate reading of "no I/O beyond the audio files it is
//! given" (see CLAUDE.md): the files it is *given* are exactly what it
//! produces output for, the same way `tags::write_tags` reads that rule as
//! covering writes to the files it is asked to tag, not just reads.
//!
//! DSD (`.dsf`/`.dff`) is out of scope for now: [`crate::decode::decode_to_pcm`]
//! doesn't handle it (Symphonia cannot decode DSD; only the ffmpeg-backed
//! analysis path can), so a DSD source fails fast with
//! [`ConvertError::Unsupported`] rather than silently producing nothing or
//! panicking partway through.
//!
//! ## Format choice
//!
//! All four targets are free to depend on: FLAC via a pure-Rust encoder
//! ([`flac`], crate `flacenc`, no C toolchain at all), WAV via plain PCM
//! muxing ([`wav`], crate `hound`), and Opus/MP3 ([`opus`], [`mp3`]) via
//! crates that vendor their respective C codec (`libopus`, LAME) from source
//! rather than linking a system library — so building this app still needs
//! nothing installed beyond a C compiler, which `cc`/`cargo` already assume.
//! Opus and MP3's *patents* are what mattered here, not their build story:
//! Opus was designed royalty-free from the start, and MP3's patents have all
//! expired (the last, in the US, in 2017) — this app holds no codec license
//! either way, so both are as free to ship as FLAC.
//!
//! ## Module layout
//!
//! One file per encoder ([`flac`], [`wav`], [`opus`], [`mp3`]), because each
//! wraps a different codec crate with essentially nothing in common. What's
//! shared — deciding *where* converted files go, not *how* they're encoded —
//! lives here: [`convert_file`] dispatches to the right encoder for one file,
//! [`plan_batch`] works out every destination path up front (mirroring the
//! source folder structure under a new root), and [`passthrough_files`]
//! copies everything else in that source folder verbatim. Two neighbours sit
//! beside them for reasons of their own: [`pcm`] (sample reshaping shared by
//! the encoders) and [`cleanup`] (removing what a cancelled batch already
//! wrote).

mod cleanup;
mod flac;
mod mp3;
mod opus;
mod pcm;
mod wav;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::decode;

pub use cleanup::undo_batch;
pub(crate) use pcm::{f32_to_ints, resample_linear};

/// A conversion target format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConvertFormat {
    /// Lossless — the default, and the only lossless target here besides WAV.
    Flac,
    /// Lossy, royalty-free — the modern choice when size matters.
    Opus,
    /// Lossy — kept for compatibility with players/hardware that don't speak
    /// Opus.
    Mp3,
    /// Uncompressed PCM. Not really a "conversion" so much as a guaranteed
    /// real copy — useful for a file this app has flagged as fake-lossless,
    /// where the point is a known-honest baseline rather than smaller files.
    Wav,
}

impl ConvertFormat {
    /// The file extension a converted file gets, without a leading dot.
    pub fn extension(self) -> &'static str {
        match self {
            ConvertFormat::Flac => "flac",
            ConvertFormat::Opus => "opus",
            ConvertFormat::Mp3 => "mp3",
            ConvertFormat::Wav => "wav",
        }
    }
}

/// Default Opus bitrate: comfortably transparent for music at this codec's
/// efficiency (see Opus's own listening-test results), well below where
/// diminishing returns set in.
pub const DEFAULT_OPUS_KBPS: u32 = 160;
/// Default MP3 bitrate — LAME's own commonly-recommended "high quality" rate.
pub const DEFAULT_MP3_KBPS: u32 = 256;

/// What to convert to, and how. `bitrate_kbps` only matters for the two lossy
/// formats; it is ignored for FLAC and WAV, which have no such setting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertSettings {
    /// The output format.
    pub format: ConvertFormat,
    /// Target bitrate in kbps, for [`ConvertFormat::Opus`]/[`ConvertFormat::Mp3`].
    /// `None` falls back to [`DEFAULT_OPUS_KBPS`]/[`DEFAULT_MP3_KBPS`].
    pub bitrate_kbps: Option<u32>,
}

/// Errors that can occur while converting one file. Every variant carries the
/// path it happened to, the same shape as [`crate::tags::TagError`], since a
/// batch conversion reports failures per file rather than aborting the rest.
#[derive(Debug, thiserror::Error)]
pub enum ConvertError {
    /// Could not create the destination folder, or write the output file
    /// (path, reason).
    #[error("{0}: {1}")]
    Io(String, String),
    /// The source file could not be decoded (path, reason).
    #[error("{0}: could not decode the source file ({1})")]
    Decode(String, String),
    /// The encoder rejected the audio or failed mid-encode (path, reason).
    #[error("{0}: could not encode the output file ({1})")]
    Encode(String, String),
    /// The source format, or something about it, isn't convertible yet
    /// (path, reason).
    #[error("{0}: {1}")]
    Unsupported(String, String),
    /// The caller asked to stop partway through this file (path). Distinct
    /// from the other variants because it isn't a failure to report to the
    /// user — a cancelled batch is discarded whole (see [`undo_batch`]), and
    /// counting this file as "failed" in the summary would be misleading.
    #[error("{0}: cancelled")]
    Cancelled(String),
}

/// Convert `src` to `dest` per `settings`. `dest`'s parent folder is created
/// if it doesn't exist yet (see [`plan_batch`], which is what typically
/// produces `dest` in the first place).
///
/// `is_cancelled` is polled while decoding — once per packet, and again just
/// before the encoder starts — and returns [`ConvertError::Cancelled`]
/// without writing anything as soon as it answers `true`. Without it, a
/// cancelled batch still has to wait for every in-flight file to decode *and*
/// re-encode in full before it can stop, which on a long hi-res track is
/// several seconds of a UI that looks hung; the encode itself is one opaque
/// call into a codec crate and stays uninterruptible, so the decode half is
/// what there is to give back.
pub fn convert_file(
    src: &Path,
    dest: &Path,
    settings: &ConvertSettings,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<(), ConvertError> {
    let name = || src.display().to_string();

    if matches!(lower_ext(src).as_deref(), Some("dsf" | "dff")) {
        return Err(ConvertError::Unsupported(
            name(),
            "DSD conversion isn't supported yet".to_string(),
        ));
    }
    // Checked before the source is even opened, not only inside the decode
    // loop: a worker that picks up its next file just as Cancel lands should
    // not pay for opening and probing it first.
    if is_cancelled() {
        return Err(ConvertError::Cancelled(name()));
    }

    let pcm = pcm::decode_cancellable(src, is_cancelled)?;
    if is_cancelled() {
        return Err(ConvertError::Cancelled(name()));
    }
    ensure_parent_dir(dest)?;

    match settings.format {
        ConvertFormat::Flac => flac::encode(&pcm, dest, source_bit_depth(src)),
        ConvertFormat::Wav => wav::encode(&pcm, dest),
        ConvertFormat::Opus => {
            opus::encode(&pcm, dest, settings.bitrate_kbps.unwrap_or(DEFAULT_OPUS_KBPS))
        }
        ConvertFormat::Mp3 => {
            mp3::encode(&pcm, dest, settings.bitrate_kbps.unwrap_or(DEFAULT_MP3_KBPS))
        }
    }
}

/// The bit depth to encode FLAC output at: the source's own declared depth
/// when there is one, clamped to 16–24 (FLAC's practical range, and the
/// range every encoder here is expected to see), 16 otherwise — a header
/// read, not a decode, so this costs nothing next to the decode
/// [`convert_file`] already did.
fn source_bit_depth(src: &Path) -> u32 {
    decode::probe_info(src)
        .ok()
        .and_then(|info| info.bits)
        .map(|b| b.clamp(16, 24))
        .unwrap_or(16)
}

fn lower_ext(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

fn ensure_parent_dir(dest: &Path) -> Result<(), ConvertError> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| ConvertError::Io(dest.display().to_string(), e.to_string()))?;
    }
    Ok(())
}

/// Work out one destination path per source in `sources`, mirroring each
/// one's position relative to `input_root` under `output_root` instead —
/// same folder, same subfolders, only the root and the extension change.
///
/// A source that (unexpectedly) doesn't live under `input_root` falls back
/// to just its own file name directly under `output_root`, rather than
/// failing the whole batch over one path oddity — the common root is
/// computed from the same file list on the frontend (`commonDir`), so this
/// should not normally happen, but a destination that's merely flatter than
/// intended is a far smaller problem than a batch that refuses to run.
pub fn plan_batch(
    sources: &[PathBuf],
    input_root: &Path,
    output_root: &Path,
    format: ConvertFormat,
) -> Vec<PathBuf> {
    sources
        .iter()
        .map(|src| {
            let rel: &Path = src.strip_prefix(input_root).unwrap_or_else(|_| {
                src.file_name().map(Path::new).unwrap_or(src.as_path())
            });
            output_root.join(rel).with_extension(format.extension())
        })
        .collect()
}

/// Copy every file under `input_root` that isn't in `exclude` (the tracks
/// just converted) to the same relative position under `output_root` —
/// covers, `.m3u` playlists, generated spectrograms, anything else that
/// shares the folder, verbatim. "Tout ou rien": there is no per-file choice,
/// by design (see the module's callers) — a file the caller wants left out
/// belongs in `exclude`, not a filter this function grows.
pub fn passthrough_files(
    input_root: &Path,
    output_root: &Path,
    exclude: &HashSet<PathBuf>,
) -> std::io::Result<Vec<PathBuf>> {
    let mut written = Vec::new();
    for entry in walkdir::WalkDir::new(input_root)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.into_path();
        if !path.is_file() || exclude.contains(&path) {
            continue;
        }
        let Ok(rel) = path.strip_prefix(input_root) else {
            continue;
        };
        let dest = output_root.join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&path, &dest)?;
        written.push(dest);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_batch_mirrors_the_source_structure_under_the_new_root() {
        let input_root = Path::new("/music/Album");
        let output_root = Path::new("/export/Album (FLAC)");
        let sources = vec![
            PathBuf::from("/music/Album/01 track.mp3"),
            PathBuf::from("/music/Album/Disc 2/02 track.mp3"),
        ];
        let got = plan_batch(&sources, input_root, output_root, ConvertFormat::Flac);
        assert_eq!(
            got,
            vec![
                PathBuf::from("/export/Album (FLAC)/01 track.flac"),
                PathBuf::from("/export/Album (FLAC)/Disc 2/02 track.flac"),
            ]
        );
    }

    /// A source outside `input_root` (shouldn't normally happen — see the
    /// doc comment) still gets a destination, just a flatter one, rather
    /// than panicking or silently dropping the file from the batch.
    #[test]
    fn plan_batch_falls_back_to_the_file_name_for_a_path_outside_the_root() {
        let input_root = Path::new("/music/Album");
        let output_root = Path::new("/export");
        let sources = vec![PathBuf::from("/elsewhere/loose.wav")];
        let got = plan_batch(&sources, input_root, output_root, ConvertFormat::Wav);
        assert_eq!(got, vec![PathBuf::from("/export/loose.wav")]);
    }

    #[test]
    fn passthrough_copies_everything_except_the_excluded_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        let input_root = dir.path().join("in");
        let output_root = dir.path().join("out");
        std::fs::create_dir_all(input_root.join("Disc 1")).expect("mkdir");
        std::fs::write(input_root.join("track.mp3"), b"audio").expect("write");
        std::fs::write(input_root.join("cover.jpg"), b"jpeg").expect("write");
        std::fs::write(input_root.join("Disc 1/playlist.m3u"), b"m3u").expect("write");

        let mut exclude = HashSet::new();
        exclude.insert(input_root.join("track.mp3"));

        let written = passthrough_files(&input_root, &output_root, &exclude).expect("copy");
        assert_eq!(written.len(), 2, "{written:?}");
        assert!(output_root.join("cover.jpg").exists());
        assert!(output_root.join("Disc 1/playlist.m3u").exists());
        assert!(!output_root.join("track.mp3").exists());
    }

    /// Cancellation is checked before the first packet is decoded, so an
    /// already-cancelled batch never reads or writes anything at all — and
    /// in particular never creates `dest`, which is what [`undo_batch`]
    /// would otherwise have to clean up.
    #[test]
    fn an_already_cancelled_convert_writes_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("in.wav");
        let dest = dir.path().join("out/track.flac");
        // Contents don't matter: cancellation is checked before any decode.
        std::fs::write(&src, b"not really a wav").expect("write");

        let settings = ConvertSettings {
            format: ConvertFormat::Flac,
            bitrate_kbps: None,
        };
        let err = convert_file(&src, &dest, &settings, &|| true).expect_err("cancelled");
        assert!(matches!(err, ConvertError::Cancelled(_)), "{err:?}");
        assert!(!dest.exists());
    }

    /// DSD is rejected on the extension alone, before any decode — so this
    /// stays a named error rather than whatever Symphonia would have said
    /// about a container it can't open.
    #[test]
    fn dsd_is_rejected_without_decoding() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("in.dsf");
        let dest = dir.path().join("out.flac");
        std::fs::write(&src, b"DSD ").expect("write");

        let settings = ConvertSettings {
            format: ConvertFormat::Flac,
            bitrate_kbps: None,
        };
        let err = convert_file(&src, &dest, &settings, &|| false).expect_err("unsupported");
        assert!(matches!(err, ConvertError::Unsupported(_, _)), "{err:?}");
        assert!(!dest.exists());
    }
}
