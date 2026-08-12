//! Undoing a cancelled conversion batch.
//!
//! Cancellation here is not the same problem it is for analysis. Analysis
//! only *reads*, so abandoning it mid-run leaves nothing behind — dropping
//! the partial results is the whole cleanup. A conversion batch writes real
//! files, and the workers that were already mid-file when Cancel was pressed
//! go on to finish and write theirs (see `parallel_map_ordered`'s own
//! comment: in-flight items are allowed to complete rather than being killed
//! mid-write, which would leave a truncated file instead of no file). So
//! "cancelled" without this module means the user gets told the run was
//! cancelled while a folder of half a batch's output sits on disk — which is
//! exactly the behaviour this exists to fix.
//!
//! The one thing it must not do is delete something it didn't create. A user
//! converting into a folder that already holds a previous run's output would
//! otherwise have those earlier files removed by cancelling this one, which
//! is worse than the problem being solved. Hence `preexisting`: the caller
//! records which destination paths were already on disk *before* the batch
//! started, and only the rest are ever removed.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Delete the output files a cancelled batch created under `output_root`,
/// then remove any folders that creating them had left empty. `planned` is
/// every destination the batch was going to write (see
/// [`super::plan_batch`]); `preexisting` is the subset of those that already
/// existed before it started, which are left exactly as they were.
///
/// Returns how many files were actually removed. Errors are deliberately not
/// propagated: this runs while unwinding a cancelled batch, where a file that
/// can't be deleted (permissions, a lock, something removed it already) is
/// worth neither failing the cancellation over nor reporting on top of it.
pub fn undo_batch(planned: &[PathBuf], preexisting: &HashSet<PathBuf>, output_root: &Path) -> usize {
    let mut removed = 0usize;
    let mut parents: HashSet<PathBuf> = HashSet::new();

    for dest in planned {
        if preexisting.contains(dest) || !dest.starts_with(output_root) || !dest.is_file() {
            continue;
        }
        if std::fs::remove_file(dest).is_ok() {
            removed += 1;
            if let Some(parent) = dest.parent() {
                parents.insert(parent.to_path_buf());
            }
        }
    }

    // Deepest first, so a nested folder is gone before its parent is tried —
    // otherwise the parent still looks non-empty and survives a run that
    // emptied it.
    let mut parents: Vec<PathBuf> = parents.into_iter().collect();
    parents.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for parent in parents {
        prune_empty_dirs(&parent, output_root);
    }

    removed
}

/// Remove `dir` and each of its ancestors up to (but never including)
/// `output_root`, stopping at the first one that isn't empty.
/// `std::fs::remove_dir` refuses to remove a non-empty folder, so its failure
/// *is* the emptiness test — no separate `read_dir` race between checking and
/// removing.
fn prune_empty_dirs(mut dir: &Path, output_root: &Path) {
    while dir.starts_with(output_root) && dir != output_root {
        if std::fs::remove_dir(dir).is_err() {
            return;
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(path, b"data").expect("write");
    }

    #[test]
    fn removes_the_files_the_batch_wrote() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let a = root.join("a.flac");
        let b = root.join("Disc 2/b.flac");
        touch(&a);
        touch(&b);

        let planned = vec![a.clone(), b.clone()];
        assert_eq!(undo_batch(&planned, &HashSet::new(), root), 2);
        assert!(!a.exists());
        assert!(!b.exists());
    }

    /// The case this module's `preexisting` argument exists for: converting
    /// into a folder that already holds an earlier run's output, then
    /// cancelling, must not take that earlier output down with it.
    #[test]
    fn leaves_files_that_were_already_there_before_the_batch() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let old = root.join("old.flac");
        let fresh = root.join("fresh.flac");
        touch(&old);
        touch(&fresh);

        let planned = vec![old.clone(), fresh.clone()];
        let preexisting: HashSet<PathBuf> = [old.clone()].into_iter().collect();
        assert_eq!(undo_batch(&planned, &preexisting, root), 1);
        assert!(old.exists(), "a file that predates the batch must survive it");
        assert!(!fresh.exists());
    }

    /// A planned destination that never got written (the batch was cancelled
    /// before reaching it) is simply not there — that's the normal case for
    /// most of the list, not an error.
    #[test]
    fn a_destination_that_was_never_written_is_not_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let never = root.join("never.flac");

        assert_eq!(undo_batch(&[never], &HashSet::new(), root), 0);
    }

    /// Subfolders the batch created to mirror the source layout go too, so a
    /// cancelled run doesn't leave an empty skeleton of the album's folder
    /// structure behind.
    #[test]
    fn prunes_folders_the_batch_created_and_then_emptied() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let nested = root.join("Album/Disc 2/b.flac");
        touch(&nested);

        undo_batch(&[nested], &HashSet::new(), root);
        assert!(!root.join("Album/Disc 2").exists());
        assert!(!root.join("Album").exists());
        assert!(root.exists(), "the output root itself is never removed");
    }

    /// A folder that still holds something else — a cover the user had put
    /// there, a file from an earlier run — must survive, along with every
    /// ancestor above it.
    #[test]
    fn keeps_a_folder_that_still_has_something_else_in_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let converted = root.join("Album/b.flac");
        let cover = root.join("Album/cover.jpg");
        touch(&converted);
        touch(&cover);

        undo_batch(&[converted], &HashSet::new(), root);
        assert!(cover.exists());
        assert!(root.join("Album").exists());
    }

    /// Defence in depth against a bad `output_root`/`planned` pairing: this
    /// deletes files, so a path outside the folder the user picked is never
    /// touched, whatever the caller passed.
    #[test]
    fn never_touches_anything_outside_the_output_root() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("out");
        std::fs::create_dir_all(&root).expect("mkdir");
        let outside = dir.path().join("elsewhere/keep.flac");
        touch(&outside);

        assert_eq!(undo_batch(&[outside.clone()], &HashSet::new(), &root), 0);
        assert!(outside.exists());
    }
}
