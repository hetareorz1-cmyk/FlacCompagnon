// A single editable tag field.
//
// "Mixed" means the selection doesn't agree on this tag: the box is left empty
// so saving it untouched can't clobber the files that had a different value,
// and the disagreement is shown instead — a badge where there's room, a
// compact "≠" placeholder in the narrow ones.

import { useRef } from "react";
import { X } from "lucide-react";

import { IconButton } from "./IconButton";
import "./TagField.css";

export interface TagFieldValue {
  value: string;
  mixed: boolean;
}

export interface TagFieldProps extends TagFieldValue {
  label: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  numeric?: boolean;
  /// Half-width variant, laid out two to a row.
  narrow?: boolean;
}

export function TagField({
  label,
  value,
  mixed,
  onChange,
  multiline,
  numeric,
  narrow,
}: TagFieldProps) {
  const placeholder = mixed ? (narrow ? "≠" : "Multiple values") : "";
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const clearAndFocus = () => {
    onChange("");
    (multiline ? textareaRef : inputRef).current?.focus();
  };

  return (
    <div className={narrow ? "tag-field tag-field-narrow" : "tag-field"}>
      <div className="tag-field-head">
        <span>{label}</span>
        {mixed && !narrow && <span className="tag-field-badge">multiple values</span>}
      </div>
      {/* Same clear-on-hover pattern as the top bar's search field (see
          .topbar-search-clear) — rendered once there's text, and
          `position: relative` on the wrapper is what lets it sit inside the
          box rather than beside it. A multiline field pins it to the
          top-right corner instead of vertical-centering it, since a
          textarea's box grows taller than the button.

          A "mixed" field shows this too even though its `value` is blank
          ("mixed" leaves the box empty on purpose, see the file header
          comment) — the field isn't actually empty, the selection just
          disagrees on what it holds, and clearing it is exactly how you'd
          resolve that disagreement by wiping the tag everywhere. */}
      <div className="tag-field-input-wrap">
        {multiline ? (
          <textarea
            ref={textareaRef}
            rows={2}
            value={value}
            placeholder={placeholder}
            onChange={(ev) => onChange(ev.target.value)}
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            inputMode={numeric ? "numeric" : undefined}
            value={value}
            placeholder={placeholder}
            onChange={(ev) => onChange(ev.target.value)}
          />
        )}
        {(value || mixed) && (
          <IconButton
            icon={<X size={12} strokeWidth={2} />}
            title="Clear"
            variant="close"
            className={multiline ? "tag-field-clear tag-field-clear-top" : "tag-field-clear"}
            onClick={clearAndFocus}
          />
        )}
      </div>
    </div>
  );
}

export interface TagFractionFieldProps {
  label: string;
  /// The numerator (track number, disc number).
  main: TagFieldValue;
  /// The denominator (track total, disc total).
  total: TagFieldValue;
  onMainChange: (value: string) => void;
  onTotalChange: (value: string) => void;
}

/// "3 / 12" style pair — one label over two numeric boxes.
export function TagFractionField({
  label,
  main,
  total,
  onMainChange,
  onTotalChange,
}: TagFractionFieldProps) {
  return (
    <div className="tag-field tag-field-narrow">
      <div className="tag-field-head">
        <span>{label}</span>
      </div>
      <div className="tag-field-pair">
        <input
          type="text"
          inputMode="numeric"
          value={main.value}
          placeholder={main.mixed ? "≠" : ""}
          onChange={(ev) => onMainChange(ev.target.value)}
        />
        <span className="tag-field-sep">/</span>
        <input
          type="text"
          inputMode="numeric"
          value={total.value}
          placeholder={total.mixed ? "≠" : ""}
          onChange={(ev) => onTotalChange(ev.target.value)}
        />
      </div>
    </div>
  );
}
