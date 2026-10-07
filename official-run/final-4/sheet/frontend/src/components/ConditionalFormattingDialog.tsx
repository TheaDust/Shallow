import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import {
  CONDITIONAL_CONDITIONS,
  CONDITIONAL_STYLES,
  isConditionalCondition,
  isConditionalStyle,
} from "../domain/conditional-format";
import type { ConditionalFormat } from "../domain/types";

export interface ConditionalFormattingDialogProps {
  open: boolean;
  /** A1 area of the current selection, the target range of a new rule. */
  range: string;
  /** Rules stored on the active worksheet, in stored order. */
  rules: ConditionalFormat[];
  onOpenChange(open: boolean): void;
  /** Store one rule (a new one when `id` is absent) and repaint the grid. */
  onSave(rule: { id?: string; range: string; condition: string; value: string; style: string }): Promise<void>;
  /** Remove one rule; the fill of every cell it covered disappears with it. */
  onDelete(id: string): Promise<void>;
}

const RANGE_FIELD_ID = "conditional-format-range";
const CONDITION_FIELD_ID = "conditional-format-condition";
const VALUE_FIELD_ID = "conditional-format-value";
const STYLE_FIELD_ID = "conditional-format-style";

/**
 * Creates, edits and deletes the conditional-formatting rules of the active
 * worksheet. The form targets the selection the dialog was opened with (or the
 * range of the rule being edited); "Edit rule N" loads a stored rule, and a
 * successful save or delete closes the dialog so the repainted grid is right
 * there. A rejected save leaves the dialog open with its message.
 */
export function ConditionalFormattingDialog({
  open,
  range,
  rules,
  onOpenChange,
  onSave,
  onDelete,
}: ConditionalFormattingDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetRange, setTargetRange] = useState(range);
  const [condition, setCondition] = useState<string>(CONDITIONAL_CONDITIONS[0]);
  const [value, setValue] = useState("");
  const [style, setStyle] = useState<string>(CONDITIONAL_STYLES[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Each open starts a new rule over the current selection, with an empty value.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setEditingId(null);
    setTargetRange(range);
    setCondition(CONDITIONAL_CONDITIONS[0]);
    setValue("");
    setStyle(CONDITIONAL_STYLES[0]);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const startEdit = (rule: ConditionalFormat) => {
    setEditingId(rule.id);
    setTargetRange(rule.range);
    setCondition(isConditionalCondition(rule.condition) ? rule.condition : CONDITIONAL_CONDITIONS[0]);
    setValue(rule.value);
    setStyle(isConditionalStyle(rule.style) ? rule.style : CONDITIONAL_STYLES[0]);
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
      setError("Please enter a value for the condition");
      return;
    }
    run(
      () => onSave({ ...(editingId ? { id: editingId } : {}), range: targetRange, condition, value, style }),
      "Unable to save the rule",
    );
  };

  return (
    <Dialog open={open} title="Conditional formatting" onOpenChange={onOpenChange}>
      <div className="conditional-formatting">
        <form className="conditional-formatting__form" onSubmit={submit}>
          <FormField id={RANGE_FIELD_ID} label="Range">
            <input
              id={RANGE_FIELD_ID}
              type="text"
              value={targetRange}
              disabled={busy}
              onChange={(event) => setTargetRange(event.target.value)}
            />
          </FormField>
          <Combobox
            id={CONDITION_FIELD_ID}
            label="Condition"
            options={CONDITIONAL_CONDITIONS.map((entry) => ({ value: entry, label: entry }))}
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
              aria-describedby={fieldDescriptionIds(VALUE_FIELD_ID, { error: Boolean(error) })}
              onChange={(event) => setValue(event.target.value)}
            />
          </FormField>
          <Combobox
            id={STYLE_FIELD_ID}
            label="Style"
            options={CONDITIONAL_STYLES.map((entry) => ({ value: entry, label: entry }))}
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
        <ul className="conditional-formatting__list" aria-label="Conditional formatting rules">
          {rules.map((rule, index) => (
            <li key={rule.id} className="conditional-formatting__item">
              <span className="conditional-formatting__rule">{`Rule ${index + 1}`}</span>
              <span className="conditional-formatting__criteria">
                {`${rule.range} · ${rule.condition} ${rule.value} · ${rule.style}`}
              </span>
              <Button disabled={busy} onClick={() => startEdit(rule)}>{`Edit rule ${index + 1}`}</Button>
              <Button disabled={busy} onClick={() => run(() => onDelete(rule.id), "Unable to delete the rule")}>
                {`Delete rule ${index + 1}`}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
