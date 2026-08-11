// The tag panel's edit buffer.
//
// Only what the user actually changed is stored; everything else is derived
// from the selection on the fly. That's what makes bulk editing safe: a field
// nobody touched stays `Unset` in the payload, so saving ten files whose
// titles all differ doesn't overwrite nine of them with the tenth's title.
// Clearing the buffer *is* the Reset button, and the same buffer is what an
// applied online-lookup result writes into — so a staged lookup is discarded
// by Reset exactly like a hand-typed edit.

import { useCallback, useMemo, useRef, useState } from "react";

import type { CoverArt, CoverEdit, FieldEdit, TagEdits, TagSet } from "../types";
import * as api from "../api";
import type { TagFieldValue } from "./TagField";
import { TAG_TEXT_FIELDS, type TagTextField } from "./tagLayout";
import { compilationValue, fieldValues } from "./tagSelection";

/// A `TagEdits` where every field is "Unset" (untouched) — the starting point
/// for any write that only means to touch a couple of fields, rather than
/// hand-repeating all twelve field names at each call site. Used by this
/// hook's own `buildEdits` and by the renumber flow (`useRenumberTracks`),
/// which only ever sets `track`/`track_total`.
export function emptyTagEdits(): TagEdits {
  return {
    title: "Unset",
    artist: "Unset",
    album: "Unset",
    album_artist: "Unset",
    composer: "Unset",
    year: "Unset",
    track: "Unset",
    track_total: "Unset",
    disc: "Unset",
    disc_total: "Unset",
    genre: "Unset",
    comment: "Unset",
    compilation: null,
    cover: "Unset",
    extra: [],
  };
}

export interface UseTagEditorArgs {
  paths: string[];
  tagSets: TagSet[];
  /// Invalidates the caller's cached tags for these paths and re-reads them.
  onSaved: (paths: string[]) => void;
  onToast: (msg: string, kind?: "info" | "error") => void;
}

export function useTagEditor({ paths, tagSets, onSaved, onToast }: UseTagEditorArgs) {
  const [edits, setEdits] = useState<Partial<Record<TagTextField, string>>>({});
  const [compilationEdit, setCompilationEdit] = useState<boolean | null>(null);
  const [coverEdit, setCoverEdit] = useState<CoverEdit>("Unset");
  // Sparse, keyed by the same raw format-specific tag name `TagSet.extra`
  // pairs use — the extended-tags pop-in's own Save merges its local draft
  // in here rather than writing to disk itself (see ExtendedTagsModal's file
  // header comment), so this buffer is what actually reaches Save/Reset.
  const [extraEdits, setExtraEditsState] = useState<Record<string, FieldEdit>>({});
  const [saving, setSaving] = useState(false);

  // Selecting different files discards whatever was half-typed for the
  // previous ones. Without this the buffer would survive the selection change
  // and Save would write it to files the user never edited — the exact
  // clobbering the "only send what was touched" design exists to prevent.
  const selectionKey = paths.join("|");
  const lastSelection = useRef(selectionKey);
  if (lastSelection.current !== selectionKey) {
    lastSelection.current = selectionKey;
    setEdits({});
    setCompilationEdit(null);
    setCoverEdit("Unset");
    setExtraEditsState({});
  }

  const base = useMemo(() => fieldValues(tagSets), [tagSets]);
  const baseCompilation = useMemo(() => compilationValue(tagSets), [tagSets]);

  /// What each box shows: the user's edit if there is one, otherwise the
  /// selection's shared value (or blank + "mixed" when they disagree).
  const values = useMemo(() => {
    const out = {} as Record<TagTextField, TagFieldValue>;
    for (const field of TAG_TEXT_FIELDS) {
      const edited = edits[field];
      out[field] = edited === undefined ? base[field] : { value: edited, mixed: false };
    }
    return out;
  }, [base, edits]);

  const compilation = compilationEdit ?? baseCompilation;

  const dirty =
    Object.keys(edits).length > 0 ||
    compilationEdit !== null ||
    coverEdit !== "Unset" ||
    Object.keys(extraEdits).length > 0;

  const setField = useCallback((field: TagTextField, value: string) => {
    setEdits((prev) => ({ ...prev, [field]: value }));
  }, []);

  /// Stages a whole online-lookup result at once — same buffer, so Save and
  /// Reset treat it like any other pending edit.
  const setFields = useCallback((patch: Partial<Record<TagTextField, string>>) => {
    setEdits((prev) => ({ ...prev, ...patch }));
  }, []);

  const stageCover = useCallback((cover: CoverArt) => {
    setCoverEdit({
      Set: {
        mime: cover.mime,
        data_base64: cover.data_base64,
        picture_type: cover.picture_type,
      },
    });
  }, []);

  /// Removes the cover from every selected file — same "Clear" as any other
  /// tag field, applied uniformly across the batch regardless of whether the
  /// selection shares one cover (deleting doesn't have the "which exact image
  /// gets overwritten" problem relabeling does).
  const clearCover = useCallback(() => {
    setCoverEdit("Clear");
  }, []);

  /// Relabels the cover currently shown without touching its bytes. Only
  /// reachable when the whole selection shares one exact cover — `CoverEdit`
  /// always re-applies the image to every file in the batch, so allowing this
  /// on a mixed selection would silently overwrite covers, not just roles.
  const setCoverRole = useCallback((cover: CoverArt, pictureType: string) => {
    setCoverEdit({
      Set: { mime: cover.mime, data_base64: cover.data_base64, picture_type: pictureType },
    });
  }, []);

  /// Merges the extended-tags pop-in's local draft into this buffer on its
  /// own Save — the pop-in never writes to disk itself, only stages into the
  /// same buffer the panel's own Save/Reset already govern (see
  /// ExtendedTagsModal's file header comment for why).
  const mergeExtraEdits = useCallback((patch: Record<string, FieldEdit>) => {
    setExtraEditsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setEdits({});
    setCompilationEdit(null);
    setCoverEdit("Unset");
    setExtraEditsState({});
  }, []);

  const buildEdits = useCallback((): TagEdits => {
    const out: TagEdits = {
      ...emptyTagEdits(),
      compilation: compilationEdit,
      cover: coverEdit,
      extra: Object.entries(extraEdits),
    };
    for (const field of TAG_TEXT_FIELDS) {
      const edited = edits[field];
      if (edited === undefined) continue;
      const trimmed = edited.trim();
      out[field] = trimmed === "" ? "Clear" : { Set: trimmed };
    }
    return out;
  }, [edits, compilationEdit, coverEdit, extraEdits]);

  const save = useCallback(async () => {
    if (paths.length === 0 || !dirty || saving) return;
    setSaving(true);
    const target = paths;
    try {
      const summary = await api.writeTagsBatch(target, buildEdits());
      if (summary.failed > 0) {
        onToast(
          `${summary.written}/${summary.total} tracks updated — ${summary.failed} failed`,
          "error",
        );
      } else {
        onToast(`${summary.written} track${summary.written === 1 ? "" : "s"} updated`);
      }
      reset();
      onSaved(target);
    } catch (e) {
      onToast(String(e), "error");
    } finally {
      setSaving(false);
    }
  }, [paths, dirty, saving, buildEdits, onToast, onSaved, reset]);

  return {
    values,
    compilation,
    coverEdit,
    extraEdits,
    dirty,
    saving,
    setField,
    setFields,
    setCompilation: setCompilationEdit,
    stageCover,
    clearCover,
    setCoverRole,
    mergeExtraEdits,
    reset,
    save,
  };
}
