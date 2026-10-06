import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import {
  CONDITION_OPTIONS,
  INVALID_RULE_RANGE_MESSAGE,
  MISSING_VALUE_MESSAGE,
  STYLE_OPTIONS,
} from "../domain/conditional";
import { normalizeNamedRangeText } from "../domain/named-ranges";
import type {
  ConditionalFormatCondition,
  ConditionalFormatRule,
  ConditionalFormatStyle,
} from "../domain/types";

/** A rule as the dialog hands it to the server (no id while it is new). */
export interface ConditionalFormatDraft {
  id?: string;
  range: string;
  condition: ConditionalFormatCondition;
  value: string;
  style: ConditionalFormatStyle;
}

export interface ConditionalFormattingDialogProps {
  open: boolean;
  /** A1 area the form starts on: the current selection rectangle. */
  range: string;
  /** Rules stored on the active worksheet, in the order they were saved. */
  rules: ConditionalFormatRule[];
  onOpenChange(open: boolean): void;
  /** Persist a rule; a rejection keeps the form open with the message shown. */
  onSave(draft: ConditionalFormatDraft): Promise<void>;
  /** Remove one stored rule; its cells lose the fill. */
  onDelete(id: string): Promise<void>;
}

const RANGE_FIELD_ID = "conditional-format-range";
const VALUE_FIELD_ID = "conditional-format-value";
const CONDITION_FIELD_ID = "conditional-format-condition";
const STYLE_FIELD_ID = "conditional-format-style";

/**
 * Conditional formatting interface of the active worksheet: a form collecting
 * the target range, the condition, the required value and the fill style, and
 * the list of stored rules with their own "Edit rule N" / "Delete rule N"
 * controls. Editing loads a stored rule into the form, so saving replaces that
 * rule immediately; deleting removes its visible fill.
 */
export function ConditionalFormattingDialog({
  open,
  range,
  rules,
  onOpenChange,
  onSave,
  onDelete,
}: ConditionalFormattingDialogProps) {
  const [draft, setDraft] = useState<ConditionalFormatDraft>({
    range,
    condition: "Greater than",
    value: "",
    style: "Red fill",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // The form starts on the current selection; reopening it after an edit or a
  // deletion drops the previous attempt's report.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setDraft({ range, condition: "Greater than", value: "", style: "Red fill" });
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const change = (part: Partial<ConditionalFormatDraft>) => {
    setDraft((current) => ({ ...current, ...part }));
  };

  const run = (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => onOpenChange(false))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : fallback);
        setBusy(false);
      });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const target = normalizeNamedRangeText(draft.range);
    if (!target) {
      setError(INVALID_RULE_RANGE_MESSAGE);
      return;
    }
    const value = draft.value.trim();
    if (value === "") {
      setError(MISSING_VALUE_MESSAGE);
      return;
    }
    const request: ConditionalFormatDraft = {
      range: target,
      condition: draft.condition,
      value,
      style: draft.style,
    };
    if (draft.id) request.id = draft.id;
    run(() => onSave(request), "Unable to save the rule");
  };

  const startEdit = (rule: ConditionalFormatRule) => {
    setError(null);
    setDraft({
      id: rule.id,
      range: rule.range,
      condition: rule.condition,
      value: rule.value,
      style: rule.style,
    });
  };

  const remove = (rule: ConditionalFormatRule) => {
    run(() => onDelete(rule.id), "Unable to delete the rule");
  };

  return (
    <Dialog open={open} title="Conditional formatting" onOpenChange={onOpenChange}>
      {/* The form carries no accessible name of its own: a container name
          containing a field label would shadow that field for label queries. */}
      <form className="conditional-format" onSubmit={submit}>
        <FormField id={RANGE_FIELD_ID} label="Range">
          <input
            id={RANGE_FIELD_ID}
            type="text"
            value={draft.range}
            disabled={busy}
            onChange={(event) => change({ range: event.target.value })}
          />
        </FormField>
        <Combobox
          id={CONDITION_FIELD_ID}
          label="Condition"
          options={CONDITION_OPTIONS.map((condition) => ({ value: condition, label: condition }))}
          value={draft.condition}
          disabled={busy}
          onChange={(event) => change({ condition: event.target.value as ConditionalFormatCondition })}
        />
        <FormField id={VALUE_FIELD_ID} label="Value">
          <input
            id={VALUE_FIELD_ID}
            type="text"
            value={draft.value}
            disabled={busy}
            onChange={(event) => change({ value: event.target.value })}
          />
        </FormField>
        <Combobox
          id={STYLE_FIELD_ID}
          label="Style"
          options={STYLE_OPTIONS.map((style) => ({ value: style, label: style }))}
          value={draft.style}
          disabled={busy}
          onChange={(event) => change({ style: event.target.value as ConditionalFormatStyle })}
        />
        {error ? (
          <p className="conditional-format__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="conditional-format__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
      {rules.length === 0 ? (
        <p className="conditional-format__empty" role="status">
          No conditional formatting rules
        </p>
      ) : (
        <ul className="conditional-format__rules">
          {rules.map((rule, index) => (
            <li key={rule.id} className="conditional-format__rule">
              <span className="conditional-format__rule-name">{`Rule ${index + 1}`}</span>
              <Button disabled={busy} onClick={() => startEdit(rule)}>
                {`Edit rule ${index + 1}`}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => remove(rule)}>
                {`Delete rule ${index + 1}`}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
