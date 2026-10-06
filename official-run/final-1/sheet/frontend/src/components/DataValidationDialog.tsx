import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import type { ValidationRule } from "../domain/types";
import {
  DROPDOWN_TYPE,
  NUMBER_RANGE_TYPE,
  RULE_TYPE_OPTIONS,
  parseAllowedValues,
} from "../domain/validation";

export interface DataValidationDialogProps {
  open: boolean;
  /** A1 area the saved rule covers: the current selection rectangle. */
  range: string;
  /** Rule already covering the selection; its values prefill the form. */
  rule: ValidationRule | null;
  onOpenChange(open: boolean): void;
  /** Persist the rule; rejecting keeps the dialog open with the message shown. */
  onSave(rule: ValidationRule): Promise<void>;
  /** Remove the rule covering the selection. */
  onDelete(): Promise<void>;
}

const TYPE_FIELD_ID = "data-validation-type";
const VALUES_FIELD_ID = "data-validation-values";
const MIN_FIELD_ID = "data-validation-min";
const MAX_FIELD_ID = "data-validation-max";
const MESSAGE_FIELD_ID = "data-validation-message";

/**
 * Creates or edits the validation rule for the current selection. The saved
 * rule is enforced by the server for grid edits, formula-bar edits and range
 * operations, so the dialog only collects the parameters. "Error message" is
 * optional: while it holds text, that message replaces the standard one on
 * every rejected entry path.
 */
export function DataValidationDialog({
  open,
  range,
  rule,
  onOpenChange,
  onSave,
  onDelete,
}: DataValidationDialogProps) {
  const [type, setType] = useState<string>(NUMBER_RANGE_TYPE);
  const [allowed, setAllowed] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Prefill the form from the rule covering the selection as the dialog opens,
  // during render, so the first committed paint already shows the saved values.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setType(rule?.type === DROPDOWN_TYPE ? DROPDOWN_TYPE : NUMBER_RANGE_TYPE);
    setAllowed(rule?.type === DROPDOWN_TYPE && Array.isArray(rule.values) ? rule.values.join(", ") : "");
    setMin(rule?.type === NUMBER_RANGE_TYPE && rule.min !== undefined ? String(rule.min) : "");
    setMax(rule?.type === NUMBER_RANGE_TYPE && rule.max !== undefined ? String(rule.max) : "");
    setMessage(typeof rule?.message === "string" ? rule.message : "");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (type === DROPDOWN_TYPE) {
      const values = parseAllowedValues(allowed);
      if (values.length === 0) {
        setError("Please enter at least one allowed value");
        return;
      }
      void run(() => onSave({ range, type: DROPDOWN_TYPE, values, message: message.trim() }), "Unable to save the rule");
      return;
    }
    const low = Number(min.trim());
    const high = Number(max.trim());
    if (min.trim() === "" || max.trim() === "" || !Number.isFinite(low) || !Number.isFinite(high)) {
      setError("Please enter a number for the minimum and maximum");
      return;
    }
    if (low > high) {
      setError("The minimum must not be greater than the maximum");
      return;
    }
    void run(() => onSave({ range, type: NUMBER_RANGE_TYPE, min: low, max: high, message: message.trim() }), "Unable to save the rule");
  };

  const remove = () => {
    void run(() => onDelete(), "Unable to delete the rule");
  };

  return (
    <Dialog open={open} title="Data validation" onOpenChange={onOpenChange}>
      <form className="data-validation" aria-label="Data validation" onSubmit={submit}>
        <Combobox
          id={TYPE_FIELD_ID}
          label="Rule type"
          options={[...RULE_TYPE_OPTIONS]}
          value={type}
          disabled={busy}
          onChange={(event) => setType(event.target.value)}
        />
        {type === DROPDOWN_TYPE ? (
          <FormField id={VALUES_FIELD_ID} label="Allowed values">
            <input
              id={VALUES_FIELD_ID}
              type="text"
              value={allowed}
              disabled={busy}
              onChange={(event) => setAllowed(event.target.value)}
            />
          </FormField>
        ) : (
          <>
            <FormField id={MIN_FIELD_ID} label="Minimum">
              <input
                id={MIN_FIELD_ID}
                type="text"
                inputMode="decimal"
                value={min}
                disabled={busy}
                onChange={(event) => setMin(event.target.value)}
              />
            </FormField>
            <FormField id={MAX_FIELD_ID} label="Maximum">
              <input
                id={MAX_FIELD_ID}
                type="text"
                inputMode="decimal"
                value={max}
                disabled={busy}
                aria-describedby={fieldDescriptionIds(MAX_FIELD_ID, { error: Boolean(error) })}
                onChange={(event) => setMax(event.target.value)}
              />
            </FormField>
          </>
        )}
        {error ? (
          <p className="data-validation__error" role="alert">
            {error}
          </p>
        ) : null}
        <FormField id={MESSAGE_FIELD_ID} label="Error message">
          <input
            id={MESSAGE_FIELD_ID}
            type="text"
            value={message}
            disabled={busy}
            onChange={(event) => setMessage(event.target.value)}
          />
        </FormField>
        <div className="data-validation__actions">
          {rule ? (
            <Button type="button" variant="danger" disabled={busy} onClick={remove}>
              Delete rule
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
