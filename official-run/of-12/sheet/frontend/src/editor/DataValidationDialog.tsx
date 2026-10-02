import { useId, useState } from "react";

import {
  parseAllowedValues,
  RULE_TYPE_OPTIONS,
  type ValidationRule,
  type ValidationRuleType,
} from "../lib/data-validation";
import type { CellRange } from "../lib/spreadsheet";
import { Button, Combobox, Dialog, FormField } from "../ui";

export interface DataValidationDialogProps {
  /** Target range the rule applies to: the rectangle the user selected. */
  range: CellRange;
  /** The rule currently covering the selection, prefilled for a modification. */
  rule: ValidationRule | null;
  busy: boolean;
  error?: string | null;
  onSave(payload: {
    ruleId?: string;
    type: ValidationRuleType;
    range: CellRange;
    values?: string;
    min?: string;
    max?: string;
  }): void;
  onDelete(ruleId: string): void;
  onClose(): void;
}

/** `Data validation` dialog (REQ-5-2): dropdown or inclusive number range for the selected range. */
export function DataValidationDialog({
  range,
  rule,
  busy,
  error,
  onSave,
  onDelete,
  onClose,
}: DataValidationDialogProps) {
  const [type, setType] = useState<ValidationRuleType>(rule?.type ?? "dropdown");
  // Prefilled from the stored (already trimmed) values, joined by a bare comma so reopening a rule
  // shows the same comma-separated item list the user saves.
  const [allowedValues, setAllowedValues] = useState(
    rule?.type === "dropdown" ? rule.values.join(",") : "",
  );
  const [minimum, setMinimum] = useState(rule?.type === "number-range" ? String(rule.min) : "");
  const [maximum, setMaximum] = useState(rule?.type === "number-range" ? String(rule.max) : "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const allowedFieldId = useId();
  const minimumFieldId = useId();
  const maximumFieldId = useId();

  const save = () => {
    if (type === "dropdown") {
      if (!parseAllowedValues(allowedValues).length) {
        setFieldError("Allowed values cannot be empty");
        return;
      }
      setFieldError(null);
      onSave({ ruleId: rule?.id, type, range, values: allowedValues });
      return;
    }
    const lower = Number(minimum.trim());
    const upper = Number(maximum.trim());
    if (minimum.trim() === "" || maximum.trim() === "" || !Number.isFinite(lower) || !Number.isFinite(upper)) {
      setFieldError("Enter a valid number range");
      return;
    }
    if (lower > upper) {
      setFieldError("Minimum cannot be greater than Maximum");
      return;
    }
    setFieldError(null);
    onSave({ ruleId: rule?.id, type, range, min: minimum.trim(), max: maximum.trim() });
  };

  return (
    <Dialog
      open
      title="Data validation"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      actions={(
        <>
          {rule ? (
            <Button variant="danger" onClick={() => onDelete(rule.id)} disabled={busy}>Delete rule</Button>
          ) : null}
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>Save</Button>
        </>
      )}
    >
      {error ? <p role="alert" className="ui-field__error">{error}</p> : null}
      <Combobox
        label="Rule type"
        value={type}
        disabled={busy}
        onChange={(event) => setType(event.target.value as ValidationRuleType)}
        options={RULE_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
      />
      {type === "dropdown" ? (
        <FormField id={allowedFieldId} label="Allowed values" error={fieldError ?? undefined}>
          <input
            id={allowedFieldId}
            type="text"
            value={allowedValues}
            disabled={busy}
            onChange={(event) => setAllowedValues(event.target.value)}
          />
        </FormField>
      ) : (
        <>
          <FormField id={minimumFieldId} label="Minimum" error={fieldError ?? undefined}>
            <input
              id={minimumFieldId}
              type="text"
              inputMode="decimal"
              value={minimum}
              disabled={busy}
              onChange={(event) => setMinimum(event.target.value)}
            />
          </FormField>
          <FormField id={maximumFieldId} label="Maximum">
            <input
              id={maximumFieldId}
              type="text"
              inputMode="decimal"
              value={maximum}
              disabled={busy}
              onChange={(event) => setMaximum(event.target.value)}
            />
          </FormField>
        </>
      )}
    </Dialog>
  );
}
