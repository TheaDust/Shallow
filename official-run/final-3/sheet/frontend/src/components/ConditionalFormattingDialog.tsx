import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import {
  FILL_STYLE_OPTIONS,
  FORMAT_CONDITION_OPTIONS,
  FORMAT_VALUE_REQUIRED_MESSAGE,
  fillColor,
  fillStyleLabel,
  formatConditionLabel,
} from "../domain/formatting";
import type { FillStyle, FormatCondition, FormatRule } from "../domain/types";

export interface ConditionalFormattingDialogProps {
  open: boolean;
  /** A1 area of the selection when the dialog opened: target of a new rule. */
  range: string;
  /** Rules already stored on the worksheet, listed in their saved order. */
  rules: FormatRule[];
  onOpenChange(open: boolean): void;
  /**
   * Store the rule, replacing the one at `index` when it is given. The dialog
   * closes when the save succeeds, so the grid shows the new fill right away.
   */
  onSave(rule: FormatRule, index?: number): Promise<void>;
  /** Remove the rule at `index`. */
  onDelete(index: number): Promise<void>;
}

const CONDITION_FIELD_ID = "conditional-formatting-condition";
const VALUE_FIELD_ID = "conditional-formatting-value";
const STYLE_FIELD_ID = "conditional-formatting-style";

/**
 * Creates, edits and deletes the conditional formatting rules of one
 * worksheet. A rule colours the cells of its range that satisfy the condition:
 * `Greater than` compares parsed numbers and `Text contains` looks for text
 * inside the cell value. Every other cell of the range keeps its plain look.
 */
export function ConditionalFormattingDialog({
  open,
  range,
  rules,
  onOpenChange,
  onSave,
  onDelete,
}: ConditionalFormattingDialogProps) {
  const [condition, setCondition] = useState<FormatCondition>("greater-than");
  const [value, setValue] = useState("");
  const [style, setStyle] = useState<FillStyle>("red");
  /** Index of the rule the form edits, or `null` while creating a new one. */
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // A fresh dialog starts a new rule; an edit loads the rule into the form.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setCondition("greater-than");
    setValue("");
    setStyle("red");
    setEditingIndex(null);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const startEdit = (index: number) => {
    const rule = rules[index];
    if (!rule) return;
    setCondition(rule.condition);
    setValue(rule.value);
    setStyle(rule.style);
    setEditingIndex(index);
    setError(null);
  };

  const run = (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    action()
      .then(() => {
        setBusy(false);
        onOpenChange(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : fallback);
        setBusy(false);
      });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (value.trim() === "") {
      setError(FORMAT_VALUE_REQUIRED_MESSAGE);
      return;
    }
    // Editing replaces the rule in place and keeps its own target range; a new
    // rule covers the range that was selected when the dialog opened.
    const edited = editingIndex !== null ? rules[editingIndex] : undefined;
    const targetRange = edited ? edited.range : range;
    void run(
      () => onSave({ range: targetRange, condition, value: value.trim(), style }, editingIndex ?? undefined),
      "Unable to save the rule",
    );
  };

  return (
    <Dialog open={open} title="Conditional formatting" onOpenChange={onOpenChange}>
      <div className="conditional-formatting">
        <form className="conditional-formatting__form" onSubmit={submit}>
          <p className="conditional-formatting__range">{`Range: ${editingIndex !== null && rules[editingIndex] ? rules[editingIndex].range : range}`}</p>
          <Combobox
            id={CONDITION_FIELD_ID}
            label="Condition"
            options={FORMAT_CONDITION_OPTIONS}
            value={condition}
            disabled={busy}
            onChange={(event) => setCondition(event.target.value as FormatCondition)}
          />
          <FormField id={VALUE_FIELD_ID} label="Value">
            <input
              id={VALUE_FIELD_ID}
              type="text"
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </FormField>
          <Combobox
            id={STYLE_FIELD_ID}
            label="Style"
            options={FILL_STYLE_OPTIONS}
            value={style}
            disabled={busy}
            onChange={(event) => setStyle(event.target.value as FillStyle)}
          />
          {error ? (
            <p className="conditional-formatting__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="conditional-formatting__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
        <ul className="conditional-formatting__list">
          {rules.map((rule, index) => (
            <li key={`${rule.range}-${index}`} className="conditional-formatting__item">
              <span
                className="conditional-formatting__swatch"
                style={{ backgroundColor: fillColor(rule.style) }}
                title={fillStyleLabel(rule.style)}
                aria-hidden="true"
              />
              <span className="conditional-formatting__description">
                {`${rule.range} · ${formatConditionLabel(rule.condition)} ${rule.value}`}
              </span>
              <Button type="button" disabled={busy} onClick={() => startEdit(index)}>
                {`Edit rule ${index + 1}`}
              </Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => run(() => onDelete(index), "Unable to delete the rule")}>
                {`Delete rule ${index + 1}`}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
