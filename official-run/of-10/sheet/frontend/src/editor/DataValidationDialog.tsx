import { useEffect, useState } from "react";

import { regionToRef, type CellRegion } from "../lib/cells";
import { Button, Combobox, Dialog, FormField } from "../ui";
import { requestErrorMessage } from "../workbooks/api";
import type { ValidationRuleData, ValidationRuleInput } from "../workbooks/types";

const DROPDOWN = "dropdown";
const NUMBER_RANGE = "numberRange";

type RuleType = typeof DROPDOWN | typeof NUMBER_RANGE;

/** Splits the comma separated `Allowed values` box, trimming every item. */
export function parseAllowedValues(text: string): string[] {
  const values: string[] = [];
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (trimmed !== "" && !values.includes(trimmed)) values.push(trimmed);
  }
  return values;
}

export interface DataValidationDialogProps {
  open: boolean;
  /** Range the rule is created for (the selected target range). */
  range: CellRegion;
  /** Rule covering the selection, prefilled and removable; null when the range has no rule. */
  existingRule: ValidationRuleData | null;
  onOpenChange(open: boolean): void;
  /** Stores the rule; a rejection keeps the dialog open with its message. */
  onSave(payload: ValidationRuleInput): Promise<void>;
  onDelete(): Promise<void>;
}

/**
 * `Data validation` dialog: a `Rule type` combo box switching between the `Allowed values` box of a
 * dropdown rule and the `Minimum`/`Maximum` boxes of an inclusive number range, a `Save` button and,
 * for an existing rule, a `Delete rule` button. Cell values never change when a rule is saved or
 * deleted.
 */
export function DataValidationDialog({
  open,
  range,
  existingRule,
  onOpenChange,
  onSave,
  onDelete,
}: DataValidationDialogProps) {
  const [ruleType, setRuleType] = useState<RuleType>(DROPDOWN);
  const [allowedText, setAllowedText] = useState("");
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existingRule?.type === NUMBER_RANGE) {
      setRuleType(NUMBER_RANGE);
      setMinText(String(existingRule.min ?? ""));
      setMaxText(String(existingRule.max ?? ""));
      setAllowedText("");
    } else if (existingRule?.type === DROPDOWN) {
      setRuleType(DROPDOWN);
      setAllowedText((existingRule.allowedValues ?? []).join(", "));
      setMinText("");
      setMaxText("");
    } else {
      setRuleType(DROPDOWN);
      setAllowedText("");
      setMinText("");
      setMaxText("");
    }
    setError(null);
    setSubmitting(false);
  }, [open, existingRule]);

  const save = async () => {
    setError(null);
    let payload: ValidationRuleInput;
    if (ruleType === DROPDOWN) {
      const allowedValues = parseAllowedValues(allowedText);
      if (allowedValues.length === 0) {
        setError("Enter at least one allowed value");
        return;
      }
      payload = { range: regionToRef(range), type: DROPDOWN, allowedValues };
    } else {
      const min = Number(minText.trim());
      const max = Number(maxText.trim());
      if (minText.trim() === "" || maxText.trim() === "" || !Number.isFinite(min) || !Number.isFinite(max)) {
        setError("Enter a numeric minimum and maximum");
        return;
      }
      payload = { range: regionToRef(range), type: NUMBER_RANGE, min, max };
    }
    setSubmitting(true);
    try {
      await onSave(payload);
    } catch (saveError) {
      setError(requestErrorMessage(saveError));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onDelete();
    } catch (deleteError) {
      setError(requestErrorMessage(deleteError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Data validation"
      onOpenChange={onOpenChange}
      actions={
        <>
          {existingRule ? (
            <Button variant="danger" onClick={() => void remove()} disabled={submitting}>
              Delete rule
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void save()} disabled={submitting}>
            Save
          </Button>
        </>
      }
    >
      <div className="validation-dialog">
        <p className="validation-dialog__range">Range: {regionToRef(range)}</p>
        <Combobox
          label="Rule type"
          value={ruleType}
          options={[
            { value: DROPDOWN, label: "Dropdown" },
            { value: NUMBER_RANGE, label: "Number range" },
          ]}
          onChange={(event) => setRuleType(event.target.value as RuleType)}
        />
        {ruleType === DROPDOWN ? (
          <FormField id="validation-allowed-values" label="Allowed values" description="Separate the values with commas.">
            <input
              id="validation-allowed-values"
              type="text"
              value={allowedText}
              onChange={(event) => setAllowedText(event.target.value)}
            />
          </FormField>
        ) : (
          <>
            <FormField id="validation-minimum" label="Minimum">
              <input
                id="validation-minimum"
                type="text"
                inputMode="decimal"
                value={minText}
                onChange={(event) => setMinText(event.target.value)}
              />
            </FormField>
            <FormField id="validation-maximum" label="Maximum">
              <input
                id="validation-maximum"
                type="text"
                inputMode="decimal"
                value={maxText}
                onChange={(event) => setMaxText(event.target.value)}
              />
            </FormField>
          </>
        )}
        {error ? (
          <p className="validation-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
