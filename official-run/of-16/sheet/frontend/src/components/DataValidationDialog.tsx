import { useEffect, useState, type FormEvent } from "react";

import { dropdownRule, numberRangeRule, ruleValues, type RuleKind } from "../domain/validation-rules";
import type { ValidationRule } from "../domain/workbook";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

const RULE_TYPE_FIELD_ID = "data-validation-rule-type";
const ALLOWED_FIELD_ID = "data-validation-allowed";
const MINIMUM_FIELD_ID = "data-validation-minimum";
const MAXIMUM_FIELD_ID = "data-validation-maximum";

const MISSING_VALUES_ERROR = "Enter at least one allowed value.";
const MISSING_NUMBER_ERROR = "Enter a number.";
const REVERSED_RANGE_ERROR = "Enter a maximum that is at least the minimum.";

export interface DataValidationDialogProps {
  /** A1 range the rule applies to: the current selection. */
  target: string;
  /** Rule covering the current selection, when one is reopened. */
  existing?: ValidationRule | null;
  error?: string | null;
  busy?: boolean;
  onSubmit(rule: ValidationRule): void;
  /** Only offered when `existing` is set; removes that rule. */
  onDelete(): void;
  onOpenChange(open: boolean): void;
}

function initialKind(existing: ValidationRule | null): RuleKind {
  return existing?.type === "list" ? "list" : "number-between";
}

/**
 * "Data validation" dialog (REQ-5-2-1).
 *
 * `Rule type` picks the constraint of the current selection: `Dropdown` stores
 * the comma-separated `Allowed values` (each item trimmed), `Number range`
 * stores an inclusive `Minimum`/`Maximum`. `Save` applies the rule to the
 * selected range and closes the dialog; reopening the dialog on a constrained
 * cell prefills the stored rule and offers `Delete rule`.
 */
export function DataValidationDialog({
  target,
  existing = null,
  error = null,
  busy = false,
  onSubmit,
  onDelete,
  onOpenChange,
}: DataValidationDialogProps) {
  const [kind, setKind] = useState<RuleKind>(() => initialKind(existing));
  const [allowed, setAllowed] = useState(() => (existing?.type === "list" ? ruleValues(existing).join(", ") : ""));
  const [minimum, setMinimum] = useState(() => (existing?.type === "number-between" ? String(existing.min ?? "") : ""));
  const [maximum, setMaximum] = useState(() => (existing?.type === "number-between" ? String(existing.max ?? "") : ""));
  const [localError, setLocalError] = useState<string | null>(null);

  // Another cell/rule opens the dialog with its own values.
  useEffect(() => {
    setKind(initialKind(existing));
    setAllowed(existing?.type === "list" ? ruleValues(existing).join(", ") : "");
    setMinimum(existing?.type === "number-between" ? String(existing.min ?? "") : "");
    setMaximum(existing?.type === "number-between" ? String(existing.max ?? "") : "");
    setLocalError(null);
  }, [existing, target]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (kind === "list") {
      const rule = dropdownRule(target, allowed);
      if (!ruleValues(rule).length) {
        setLocalError(MISSING_VALUES_ERROR);
        return;
      }
      setLocalError(null);
      onSubmit(rule);
      return;
    }
    const min = Number(minimum);
    const max = Number(maximum);
    if (!minimum.trim() || !Number.isFinite(min) || !maximum.trim() || !Number.isFinite(max)) {
      setLocalError(MISSING_NUMBER_ERROR);
      return;
    }
    if (min > max) {
      setLocalError(REVERSED_RANGE_ERROR);
      return;
    }
    setLocalError(null);
    onSubmit(numberRangeRule(target, min, max));
  }

  return (
    <Dialog
      open
      title="Data validation"
      closeLabel="Close data validation dialog"
      description={`Rule for ${target}`}
      onOpenChange={(open) => {
        if (!open && !busy) onOpenChange(false);
      }}
    >
      <form id="data-validation-form" className="data-validation" onSubmit={submit} noValidate>
        <Combobox
          id={RULE_TYPE_FIELD_ID}
          label="Rule type"
          value={kind}
          disabled={busy}
          onChange={(event) => {
            setKind(event.target.value as RuleKind);
            setLocalError(null);
          }}
          options={[
            { value: "list", label: "Dropdown" },
            { value: "number-between", label: "Number range" },
          ]}
        />
        {kind === "list" ? (
          <FormField
            id={ALLOWED_FIELD_ID}
            label="Allowed values"
            description="Comma-separated values; surrounding spaces are ignored."
            error={localError ?? undefined}
          >
            <input
              id={ALLOWED_FIELD_ID}
              name="allowed-values"
              type="text"
              value={allowed}
              disabled={busy}
              onChange={(event) => {
                setAllowed(event.target.value);
                setLocalError(null);
              }}
            />
          </FormField>
        ) : (
          <>
            <FormField id={MINIMUM_FIELD_ID} label="Minimum">
              <input
                id={MINIMUM_FIELD_ID}
                name="minimum"
                type="text"
                inputMode="decimal"
                value={minimum}
                disabled={busy}
                onChange={(event) => {
                  setMinimum(event.target.value);
                  setLocalError(null);
                }}
              />
            </FormField>
            <FormField id={MAXIMUM_FIELD_ID} label="Maximum" error={localError ?? undefined}>
              <input
                id={MAXIMUM_FIELD_ID}
                name="maximum"
                type="text"
                inputMode="decimal"
                value={maximum}
                disabled={busy}
                onChange={(event) => {
                  setMaximum(event.target.value);
                  setLocalError(null);
                }}
              />
            </FormField>
          </>
        )}
        {error ? <p role="alert" className="data-validation__error">{error}</p> : null}
        <div className="data-validation__actions">
          {existing ? (
            <Button variant="danger" disabled={busy} onClick={() => onDelete()}>Delete rule</Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>Save</Button>
        </div>
        {busy ? <p role="status">Saving validation rule…</p> : null}
      </form>
    </Dialog>
  );
}
