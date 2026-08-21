//! Converting the panel's imported tracks to another format.
//!
//! Mirrors [`super::analysis::analyze_paths`]'s shape (gather targets, run in
//! parallel over a thread pool, emit progress, honour cancellation) but
//! writes files instead of only reading them — the reason this lives in its
//! own module rather than folded into `analysis`, and the reason cancelling
//! is a different problem here: an abandoned analysis leaves no trace, an
//! abandoned conversion leaves however many files its workers had already
//! finished. See the `let Some(outcomes)` branch below and
//! [`convert::undo_batch`]. Pausing playback and freezing the rest of the UI
//! while this runs is the frontend's job (the player already exposes
//! `pause_playback`/`resume_playback`); this command only does the
//! conversion itself.

use std::collections::HashSet;
use std::path::PathBuf;

use flaccompagnon_core::convert::{self, ConvertSettings};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::batch::{cancelled, gather_targets, parallel_map_ordered, reset_cancel, Progress};
use super::file_name;

/// Summary returned once a conversion batch finishes (or is cancelled — see
/// below, a cancelled run returns an error instead, the same way
/// `analyze_paths` does).
#[derive(Clone, Serialize)]
pub struct ConvertSummary {
    total: usize,
    converted: usize,
    failed: usize,
    /// How many non-audio files (covers, playlists, spectrograms, ...) were
    /// copied verbatim — 0 unless `copy_others` was set.
    copied: usize,
    output_root: String,
    /// One message per failed file, `"name: reason"` — the batch keeps going
    /// past a single bad file rather than aborting the rest.
    errors: Vec<String>,
}

/// Expand what the conversion panel was handed — any mix of audio files and
/// folders — into the audio files it will actually convert.
///
/// The panel used to keep the dropped paths verbatim, which made its own
/// count wrong the moment a folder arrived: one row reading "1 track
/// imported" for what might hold a hundred. Resolving it here rather than
/// guessing in the frontend has two further benefits — the list then shows
/// exactly what will be written, and a single track inside a dropped folder
/// can be removed like any other, which was impossible while the folder was
/// one opaque row.
///
/// Recursive, and it applies the same filtering [`convert_files`] would
/// (extension-based, generated `spectres/` folders skipped), so what the panel
/// lists and what the batch writes cannot disagree.
#[tauri::command]
pub async fn list_convert_sources(targets: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        gather_targets(&targets, true)
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Convert every audio file implied by `targets` (the panel's own imported
/// files/folders, independent of the main results table) to `settings`'s
/// format, writing the result under `output_root` in the same relative
/// layout the sources have today. When `copy_others` is set, every other
/// file sharing a source folder (covers, `.m3u` playlists, generated
/// spectrograms, ...) is copied there too, unconverted.
#[tauri::command]
pub async fn convert_files(
    app: AppHandle,
    targets: Vec<String>,
    output_root: String,
    settings: ConvertSettings,
    copy_others: bool,
) -> Result<ConvertSummary, String> {
    if targets.is_empty() {
        return Err("Nothing to convert.".to_string());
    }
    let sources = gather_targets(&targets, true);
    if sources.is_empty() {
        return Err("No supported audio files found.".to_string());
    }
    let total = sources.len();
    let input_root = common_root(&sources);
    let output_root_path = PathBuf::from(&output_root);
    let destinations = convert::plan_batch(&sources, &input_root, &output_root_path, settings.format);
    // Taken before a single file is written, so a cancellation can tell the
    // outputs *this* batch created from ones that were already sitting in the
    // chosen folder (an earlier run, most likely) and must survive it — see
    // `convert::undo_batch`.
    let preexisting: HashSet<PathBuf> = destinations
        .iter()
        .filter(|dest| dest.exists())
        .cloned()
        .collect();
    let pairs: Vec<(PathBuf, PathBuf)> =
        sources.iter().cloned().zip(destinations.iter().cloned()).collect();

    reset_cancel();
    let app_bg = app.clone();
    let outcomes = tauri::async_runtime::spawn_blocking(move || {
        parallel_map_ordered(
            &pairs,
            cancelled,
            // Handed down into the per-file work too, not just checked
            // between files: a hi-res track takes seconds to decode and
            // re-encode, and without this Cancel wouldn't be felt until every
            // worker's current file had run to completion.
            |(src, dest)| convert::convert_file(src, dest, &settings, &cancelled),
            |done, (src, _)| {
                let _ = app_bg.emit(
                    "convert://progress",
                    Progress {
                        current: done.saturating_sub(1),
                        total,
                        file: file_name(src),
                    },
                );
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    // Unlike a cancelled analysis, which leaves nothing behind because it only
    // ever read, a cancelled conversion has already written every file that
    // finished before the click landed. Reporting "cancelled" while those sit
    // in the output folder is the worst of both — so they go before the error
    // does.
    let Some(outcomes) = outcomes else {
        convert::undo_batch(&destinations, &preexisting, &output_root_path);
        return Err("cancelled".to_string());
    };

    let mut errors: Vec<String> = outcomes
        .iter()
        .filter_map(|r| r.as_ref().err().map(ToString::to_string))
        .collect();
    let failed = errors.len();
    let converted = outcomes.len() - failed;

    let mut copied = 0usize;
    if copy_others {
        let exclude: HashSet<PathBuf> = sources.into_iter().collect();
        match convert::passthrough_files(&input_root, &output_root_path, &exclude) {
            Ok(written) => copied = written.len(),
            Err(e) => errors.push(format!("copy: {e}")),
        }
    }

    let _ = app.emit(
        "convert://progress",
        Progress {
            current: total,
            total,
            file: String::new(),
        },
    );

    Ok(ConvertSummary {
        total,
        converted,
        failed,
        copied,
        output_root,
        errors,
    })
}

/// The common ancestor folder of every source's own parent folder — what
/// [`convert::plan_batch`] mirrors the sources' relative layout against. Not
/// [`super::batch::display_root`]: that one only ever looks at the *first*
/// target, which is enough for a label but not for a folder structure that
/// has to hold every source at once.
fn common_root(paths: &[PathBuf]) -> PathBuf {
    let mut iter = paths.iter();
    let Some(first) = iter.next() else {
        return PathBuf::new();
    };
    let mut root: Vec<_> = first
        .parent()
        .map(|p| p.components().collect())
        .unwrap_or_default();
    for p in iter {
        let comps: Vec<_> = p.parent().map(|p| p.components().collect()).unwrap_or_default();
        let common_len = root.iter().zip(comps.iter()).take_while(|(a, b)| a == b).count();
        root.truncate(common_len);
    }
    root.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_root_is_the_shared_ancestor_of_every_source() {
        let paths = vec![
            PathBuf::from("/music/Album/01 track.flac"),
            PathBuf::from("/music/Album/Disc 2/02 track.flac"),
        ];
        assert_eq!(common_root(&paths), PathBuf::from("/music/Album"));
    }

    #[test]
    fn common_root_of_a_single_file_is_its_own_folder() {
        let paths = vec![PathBuf::from("/music/Album/track.flac")];
        assert_eq!(common_root(&paths), PathBuf::from("/music/Album"));
    }

    #[test]
    fn common_root_of_unrelated_folders_is_their_shared_prefix() {
        let paths = vec![
            PathBuf::from("/music/Album A/track.flac"),
            PathBuf::from("/music/Album B/track.flac"),
        ];
        assert_eq!(common_root(&paths), PathBuf::from("/music"));
    }

    #[test]
    fn common_root_of_nothing_is_empty() {
        let paths: Vec<PathBuf> = Vec::new();
        assert_eq!(common_root(&paths), PathBuf::new());
    }
}
