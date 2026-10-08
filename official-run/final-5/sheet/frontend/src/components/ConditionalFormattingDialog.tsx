import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import {
  CONDITION_GREATER_THAN,
  CONDITION_OPTIONS,
  STYLE_OPTIONS,
  STYLE_RED,
  VALUE_NOT_NUMBER_MESSAGE,
  VALUE_REQUIRED_MESSAGE,
} from "../domain/formatting";
import { areaOfRegion } from "../domain/clipboard";
import { regionFromArea } from "../domain/grid";
import type { ConditionalFormatRule } from "../domain/types";

const RANGE_FIELD_ID = "conditional-format-range";
const CONDITION_FIELD_ID = "conditional-format-condition";
const VALUE_FIELD_ID = "conditional-format-value";
const STYLE_FIELD_ID = "conditional-format-style";

/** Short description of one rule, used in the saved-rule list. */
function describeRule(rule: ConditionalFormatRule, index: number): string {
  return `Rule ${index + 1}: ${rule.condition} ${rule.value} (${rule.range}) — ${rule.style}`;
}

export interface ConditionalFormattingDialogProps {
  open: boolean;
  /** Rules already saved on the active worksheet, in order. */
  rules: ConditionalFormatRule[];
  /** A1 area the form starts with: the grid's current selection. */
  selectionRange: string;
  onOpenChange(open: boolean): void;
  /** Save a new rule (`index` omitted) or replace rule `index`. */
  onSave(rule: ConditionalFormatRule, index: number | null): Promise<void>;
  /** Remove rule `index`; its fill disappears from the grid. */
  onDelete(index: number): Promise<void>;
}

/**
 * Creates, edits and deletes the active worksheet's conditional-formatting
 * rules. The form collects the target "Range" (prefilled with the current
 * selection), the "Condition", the required "Value" and the "Style"; the saved
 * rules are listed with an "Edit rule N" and a "Delete rule N" control each.
 * Saving or deleting closes the dialog so the grid shows the resulting fill.
 */
export function ConditionalFormattingDialog({
  open,
  rules,
  selectionRange,
  onOpenChange,
  onSave,
  onDelete,
}: ConditionalFormattingDialogProps) {
  const [range, setRange] = useState(selectionRange);
  const [condition, setCondition] = useState<string>(CONDITION_GREATER_THAN);
  const [value, setValue] = useState("");
  const [style, setStyle] = useState<string>(STYLE_RED);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Reset the form as the dialog opens, during render, so the first committed
  // paint already shows the selection's range and the default condition/style.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setRange(selectionRange);
    setCondition(CONDITION_GREATER_THAN);
    setValue("");
    setStyle(STYLE_RED);
    setEditingIndex(null);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const startEdit = (index: number) => {
    const rule = rules[index];
    if (!rule) return;
    setEditingIndex(index);
    setRange(rule.range);
    setCondition(rule.condition);
    setValue(rule.value);
    setStyle(rule.style);
    setError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const bounds = regionFromArea(range);
    if (!bounds) {
      setError("Enter a valid cell range");
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      setError(VALUE_REQUIRED_MESSAGE);
      return;
    }
    if (condition === CONDITION_GREATER_THAN && !Number.isFinite(Number(trimmed))) {
      setError(VALUE_NOT_NUMBER_MESSAGE);
      return;
    }
    const rule: ConditionalFormatRule = { range: areaOfRegion(bounds), condition, value: trimmed, style };
    setBusy(true);
    setError(null);
    onSave(rule, editingIndex)
      .then(() => onOpenChange(false))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to save the rule");
        setBusy(false);
      });
  };

  const remove = (index: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onDelete(index)
      .then(() => onOpenChange(false))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to delete the rule");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Conditional formatting" onOpenChange={onOpenChange}>
      <div className="conditional-formatting">
        <form className="conditional-formatting__form" onSubmit={submit}>
          <FormField id={RANGE_FIELD_ID} label="Range">
            <input
              id={RANGE_FIELD_ID}
              type="text"
              value={range}
              disabled={busy}
              onChange={(event) => setRange(event.target.value)}
            />
          </FormField>
          <Combobox
            id={CONDITION_FIELD_ID}
            label="Condition"
            options={[...CONDITION_OPTIONS]}
            value={condition}
            disabled={busy}
            onChange={(event) => setCondition(event.target.value)}
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
            options={[...STYLE_OPTIONS]}
            value={style}
            disabled={busy}
            onChange={(event) => setStyle(event.target.value)}
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
        {rules.length > 0 ? (
          <ul className="conditional-formatting__list" aria-label="Conditional formatting rules">
            {rules.map((rule, index) => (
              <li key={`${rule.range}-${index}`} className="conditional-formatting__item">
                <span className="conditional-formatting__summary">{describeRule(rule, index)}</span>
                <Button disabled={busy} onClick={() => startEdit(index)}>
                  {`Edit rule ${index + 1}`}
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => remove(index)}>
                  {`Delete rule ${index + 1}`}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}
