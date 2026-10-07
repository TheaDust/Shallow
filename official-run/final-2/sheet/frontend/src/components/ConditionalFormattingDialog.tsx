import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import { CONDITION_OPTIONS, STYLE_OPTIONS } from "../domain/conditional";
import {
  GREATER_THAN_CONDITION,
  RED_FILL_STYLE,
  type ConditionalCondition,
  type ConditionalRule,
  type ConditionalStyle,
} from "../domain/types";

export interface ConditionalFormattingDialogProps {
  open: boolean;
  /** A1 area a new rule covers: the current selection rectangle. */
  range: string;
  /** Rules of the active worksheet, in stored order. */
  rules: ConditionalRule[];
  onOpenChange(open: boolean): void;
  /** Appends a rule, or replaces the one at `index`; a rejection keeps the dialog open. */
  onSave(rule: ConditionalRule, index: number | null): Promise<void>;
  /** Removes the rule at `index`; the list and the grid update immediately. */
  onDelete(index: number): Promise<void>;
}

const CONDITION_FIELD_ID = "conditional-condition";
const VALUE_FIELD_ID = "conditional-value";
const STYLE_FIELD_ID = "conditional-style";

/**
 * Creates, edits and deletes the conditional formatting rules of the active
 * worksheet. A new rule covers the current selection rectangle; "Edit rule N"
 * reopens that rule's own range, condition, value and style. Saving applies the
 * replacement immediately (the dialog closes, so the grid shows the new fills),
 * "Delete rule N" removes the rule and its fill, and a rejected save reports its
 * message while leaving the stored rules untouched.
 */
export function ConditionalFormattingDialog({
  open,
  range,
  rules,
  onOpenChange,
  onSave,
  onDelete,
}: ConditionalFormattingDialogProps) {
  const [condition, setCondition] = useState<string>(GREATER_THAN_CONDITION);
  const [value, setValue] = useState("");
  const [style, setStyle] = useState<string>(RED_FILL_STYLE);
  /** Index of the rule being edited, or `null` while a new rule is composed. */
  const [editing, setEditing] = useState<number | null>(null);
  /** A1 area the composed rule covers: the selection, or the edited rule's range. */
  const [target, setTarget] = useState(range);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setCondition(GREATER_THAN_CONDITION);
    setValue("");
    setStyle(RED_FILL_STYLE);
    setEditing(null);
    setTarget(range);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const edit = (index: number) => {
    const rule = rules[index];
    if (!rule) return;
    setEditing(index);
    setTarget(rule.range);
    setCondition(rule.condition);
    setValue(rule.value);
    setStyle(rule.style);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const text = value.trim();
    if (text === "") {
      setError("Please enter a value");
      return;
    }
    setBusy(true);
    setError(null);
    const rule: ConditionalRule = {
      range: target,
      condition: condition as ConditionalCondition,
      value: text,
      style: style as ConditionalStyle,
    };
    try {
      await onSave(rule, editing);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the rule");
      setBusy(false);
    }
  };

  const remove = async (index: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(index);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the rule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Conditional formatting" onOpenChange={onOpenChange}>
      <div className="conditional-formatting">
        <p className="conditional-formatting__target">{`Applies to ${target}`}</p>
        <form className="conditional-formatting__form" onSubmit={submit}>
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
              aria-describedby={fieldDescriptionIds(VALUE_FIELD_ID, { error: Boolean(error) })}
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
          <div className="conditional-formatting__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
        {rules.length === 0 ? (
          <p className="conditional-formatting__empty">No conditional formatting rules yet</p>
        ) : (
          <ul className="conditional-formatting__list">
            {rules.map((rule, index) => (
              <li key={`${index}-${rule.range}`} className="conditional-formatting__item">
                {/* The range identifies the rule; the condition, value and style
                    stay in the fields, whose names the rule list must not shadow. */}
                <span className="conditional-formatting__summary">{rule.range}</span>
                <Button disabled={busy} onClick={() => edit(index)}>
                  {`Edit rule ${index + 1}`}
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => void remove(index)}>
                  {`Delete rule ${index + 1}`}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p className="conditional-formatting__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
