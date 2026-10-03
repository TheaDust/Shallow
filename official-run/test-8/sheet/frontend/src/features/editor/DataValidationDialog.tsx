import { useState, type FormEvent } from "react";

import { Button } from "../../ui/Button";
import { Combobox } from "../../ui/Combobox";
import { Dialog } from "../../ui/Dialog";
import { FormField } from "../../ui/FormField";
import { EMPTY_DROPDOWN_MESSAGE } from "../../domain/validation";
import { errorMessage } from "../../lib/workbooks-api";
import type { CellRange, ValidationRule, ValidationRuleInput } from "../../domain/types";

export interface DataValidationDialogProps {
  /** Rectangle the saved rule constrains (the current selection). */
  range: CellRange;
  /** Rule already covering the selection, prefilling the dialog. */
  existing: ValidationRule | null;
  onClose(): void;
  onSave(rule: ValidationRuleInput): Promise<unknown>;
  onDelete(ruleId: string): Promise<unknown>;
}

const RULE_TYPES = [
  { value: "dropdown", label: "Dropdown" },
  { value: "numeric", label: "Number range" },
];

/**
 * "Data validation" dialog. A dropdown rule lists the allowed values (comma
 * separated, each trimmed); a number range rule stores an inclusive minimum and
 * maximum. Saving replaces the rule covering the selected range, deleting
 * removes the constraint; both close the dialog and leave existing cell values
 * untouched — the rule only constrains later input.
 */
export function DataValidationDialog({
  range,
  existing,
  onClose,
  onSave,
  onDelete,
}: DataValidationDialogProps) {
  const [ruleType, setRuleType] = useState<string>(existing?.type ?? "dropdown");
  const [allowed, setAllowed] = useState(
    existing?.type === "dropdown" ? existing.values.join(", ") : "",
  );
  const [minimum, setMinimum] = useState(existing?.type === "numeric" ? String(existing.min) : "");
  const [maximum, setMaximum] = useState(existing?.type === "numeric" ? String(existing.max) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The rule the current field values describe, or a message explaining why not. */
  const buildRule = (): ValidationRuleInput | string => {
    if (ruleType === "dropdown") {
      const values = allowed
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      if (values.length === 0) return EMPTY_DROPDOWN_MESSAGE;
      return { id: existing?.id, type: "dropdown", values, range };
    }
    const minText = minimum.trim();
    const maxText = maximum.trim();
    const min = Number(minText);
    const max = Number(maxText);
    if (minText === "" || maxText === "" || !Number.isFinite(min) || !Number.isFinite(max)) {
      return "Enter a number for the minimum and the maximum";
    }
    if (min > max) return "The minimum must not be greater than the maximum";
    return { id: existing?.id, type: "numeric", min, max, range, style: "between" };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const rule = buildRule();
    if (typeof rule === "string") {
      setError(rule);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(rule);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !existing) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(existing.id);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Data validation"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <form className="data-validation-dialog" onSubmit={submit}>
        <Combobox
          label="Rule type"
          value={ruleType}
          options={RULE_TYPES}
          onChange={(event) => setRuleType(event.target.value)}
        />
        {ruleType === "dropdown" ? (
          <FormField id="validation-allowed" label="Allowed values">
            <input
              id="validation-allowed"
              value={allowed}
              onChange={(event) => setAllowed(event.target.value)}
            />
          </FormField>
        ) : (
          <>
            <FormField id="validation-minimum" label="Minimum">
              <input
                id="validation-minimum"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
              />
            </FormField>
            <FormField id="validation-maximum" label="Maximum">
              <input
                id="validation-maximum"
                value={maximum}
                onChange={(event) => setMaximum(event.target.value)}
              />
            </FormField>
          </>
        )}
        {error ? <p className="ui-field__error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy}>Save</Button>
          {existing ? (
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>Delete rule</Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
