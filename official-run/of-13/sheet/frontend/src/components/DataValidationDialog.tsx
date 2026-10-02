import { useState } from "react";

import { allowedValuesFromText } from "../domain/validation";
import type { ValidationRule } from "../domain/workbook";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export type RuleType = "dropdown" | "number-range";

/** What `Save` submits for the selected range. */
export interface ValidationDraft {
  type: RuleType;
  values?: string[];
  min?: number;
  max?: number;
}

export interface DataValidationDialogProps {
  /** Rectangle the rule will cover, e.g. `A1:A2`. */
  range: string;
  /** Rule already stored for exactly this range, when the dialog was reopened. */
  rule: ValidationRule | null;
  busy?: boolean;
  error?: string;
  onSave(draft: ValidationDraft): void;
  /** Removes the reopened rule; only offered while `rule` is set. */
  onDelete(): void;
  onClose(): void;
}

/**
 * `Data validation` dialog (REQ-5-2-1): chooses between a dropdown rule (comma-separated
 * allowed values) and an inclusive number range. Reopening a range that already has a rule
 * prefills the type and its parameters and offers `Delete rule`.
 */
export function DataValidationDialog({
  range,
  rule,
  busy = false,
  error = "",
  onSave,
  onDelete,
  onClose,
}: DataValidationDialogProps) {
  const [type, setType] = useState<RuleType>(rule?.type ?? "dropdown");
  const [allowed, setAllowed] = useState((rule?.values ?? []).join(", "));
  const [min, setMin] = useState(rule?.min === undefined ? "" : String(rule.min));
  const [max, setMax] = useState(rule?.max === undefined ? "" : String(rule.max));
  const [localError, setLocalError] = useState("");

  function submit() {
    if (type === "dropdown") {
      const values = allowedValuesFromText(allowed);
      if (values.length === 0) {
        setLocalError("Enter at least one allowed value");
        return;
      }
      setLocalError("");
      onSave({ type, values });
      return;
    }
    const minimum = Number(min);
    const maximum = Number(max);
    if (min.trim() === "" || max.trim() === "" || !Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      setLocalError("Enter a valid minimum and maximum");
      return;
    }
    if (minimum > maximum) {
      setLocalError("The minimum must not be greater than the maximum");
      return;
    }
    setLocalError("");
    onSave({ type, min: minimum, max: maximum });
  }

  return (
    <Dialog
      open
      title="Data validation"
      description={`Range ${range}`}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          {rule ? (
            <Button variant="danger" disabled={busy} onClick={onDelete}>
              Delete rule
            </Button>
          ) : null}
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <Combobox
        label="Rule type"
        value={type}
        disabled={busy}
        options={[
          { value: "dropdown", label: "Dropdown" },
          { value: "number-range", label: "Number range" },
        ]}
        onChange={(event) => setType(event.target.value as RuleType)}
      />
      {type === "dropdown" ? (
        <FormField id="allowed-values" label="Allowed values">
          <input
            id="allowed-values"
            name="allowed-values"
            type="text"
            value={allowed}
            disabled={busy}
            onChange={(event) => setAllowed(event.target.value)}
          />
        </FormField>
      ) : (
        <>
          <FormField id="rule-minimum" label="Minimum">
            <input
              id="rule-minimum"
              name="rule-minimum"
              type="text"
              value={min}
              disabled={busy}
              onChange={(event) => setMin(event.target.value)}
            />
          </FormField>
          <FormField id="rule-maximum" label="Maximum">
            <input
              id="rule-maximum"
              name="rule-maximum"
              type="text"
              value={max}
              disabled={busy}
              onChange={(event) => setMax(event.target.value)}
            />
          </FormField>
        </>
      )}
      {localError || error ? (
        <p role="alert" className="page-error">
          {localError || error}
        </p>
      ) : null}
    </Dialog>
  );
}
