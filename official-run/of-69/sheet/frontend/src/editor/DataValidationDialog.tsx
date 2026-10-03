import { useState } from "react";

import { ApiError } from "../lib/api";
import { deleteWorksheetValidation, saveWorksheetValidation } from "../domain/workbook-api";
import type { ValidationRule, Workbook, Worksheet } from "../domain/types";
import { Button, Combobox, Dialog, FormField } from "../ui";

export const NO_ALLOWED_VALUES_MESSAGE = "Enter at least one allowed value";
export const INVALID_LIMITS_MESSAGE = "Minimum must not be greater than Maximum";

/** Comma-separated allowed values, trimmed of leading and trailing spaces. */
export function parseAllowedValues(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export interface DataValidationDialogProps {
  workbookId: string;
  worksheet: Worksheet;
  /** Range the rule applies to (the selection when the dialog was opened). */
  range: string;
  /** Existing rule covering that range, when one is being reopened. */
  rule: ValidationRule | null;
  onOpenChange(open: boolean): void;
  onSaved(workbook: Workbook): void;
}

/**
 * "Data validation" dialog (REQ-5-2-1): a dropdown or inclusive number-range rule for the
 * selected range. Reopening an existing rule prefills it and adds "Delete rule"; saving or
 * deleting closes the dialog and never rewrites existing cell values.
 */
export function DataValidationDialog({
  workbookId,
  worksheet,
  range,
  rule,
  onOpenChange,
  onSaved,
}: DataValidationDialogProps) {
  const [ruleType, setRuleType] = useState<string>(rule?.type === "number" ? "number" : "list");
  const [allowed, setAllowed] = useState<string>(
    rule?.type === "list" ? (rule.values ?? []).join(", ") : "",
  );
  const [minimum, setMinimum] = useState<string>(
    rule?.type === "number" && rule.min !== undefined ? String(rule.min) : "",
  );
  const [maximum, setMaximum] = useState<string>(
    rule?.type === "number" && rule.max !== undefined ? String(rule.max) : "",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  type ValidationPayload =
    | { range: string; type: "list"; values: string[] }
    | { range: string; type: "number"; min: number; max: number };

  async function persist(payload: ValidationPayload) {
    setSaving(true);
    setError("");
    try {
      onSaved(await saveWorksheetValidation(workbookId, worksheet.id, payload));
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to save the rule. Please try again.");
      setSaving(false);
    }
  }

  async function save() {
    if (saving) return;
    if (ruleType === "list") {
      const values = parseAllowedValues(allowed);
      if (values.length === 0) {
        setError(NO_ALLOWED_VALUES_MESSAGE);
        return;
      }
      await persist({ range, type: "list", values });
      return;
    }
    const min = Number(minimum);
    const max = Number(maximum);
    const valid =
      minimum.trim() !== "" &&
      maximum.trim() !== "" &&
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min <= max;
    if (!valid) {
      setError(INVALID_LIMITS_MESSAGE);
      return;
    }
    await persist({ range, type: "number", min, max });
  }

  async function remove() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      onSaved(await deleteWorksheetValidation(workbookId, worksheet.id, rule?.range ?? range));
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to delete the rule. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Data validation"
      onOpenChange={onOpenChange}
      actions={
        <>
          {rule ? (
            <Button variant="danger" onClick={remove} disabled={saving}>
              Delete rule
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            Save
          </Button>
        </>
      }
    >
      <FormField id="data-validation-range" label="Applies to">
        <input id="data-validation-range" type="text" value={range} readOnly />
      </FormField>
      <Combobox
        id="data-validation-type"
        label="Rule type"
        value={ruleType}
        onChange={(event) => {
          setRuleType(event.target.value);
          setError("");
        }}
        options={[
          { value: "list", label: "Dropdown" },
          { value: "number", label: "Number range" },
        ]}
      />
      {ruleType === "list" ? (
        <FormField id="data-validation-values" label="Allowed values" error={error || undefined}>
          <input
            id="data-validation-values"
            type="text"
            value={allowed}
            autoComplete="off"
            placeholder="Open, Closed"
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setAllowed(event.target.value);
              if (error) setError("");
            }}
          />
        </FormField>
      ) : (
        <div className="data-validation__limits">
          <FormField id="data-validation-min" label="Minimum">
            <input
              id="data-validation-min"
              type="text"
              inputMode="decimal"
              value={minimum}
              autoComplete="off"
              onChange={(event) => {
                setMinimum(event.target.value);
                if (error) setError("");
              }}
            />
          </FormField>
          <FormField id="data-validation-max" label="Maximum">
            <input
              id="data-validation-max"
              type="text"
              inputMode="decimal"
              value={maximum}
              autoComplete="off"
              onChange={(event) => {
                setMaximum(event.target.value);
                if (error) setError("");
              }}
            />
          </FormField>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      )}
    </Dialog>
  );
}
