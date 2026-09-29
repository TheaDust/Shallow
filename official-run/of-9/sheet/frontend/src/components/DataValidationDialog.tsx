import { useEffect, useId, useState } from "react";

import type { CellRange, ValidationRule, Workbook } from "../domain/types";
import { cellCoordinate } from "../domain/grid";
import { parseAllowedValues } from "../domain/validation";
import { setValidation } from "../lib/api";
import { Button, Combobox, Dialog, FormField } from "../ui";

export interface DataValidationDialogProps {
  open: boolean;
  workbookId: string;
  sheetId: string;
  range: CellRange;
  /** The stored rule covering the selection, when one exists (for prefill/delete). */
  existing: ValidationRule | null;
  onOpenChange(open: boolean): void;
  onSaved(workbook: Workbook): void;
}

/**
 * The "Data validation" dialog. "Rule type" chooses between "Dropdown"
 * (comma-separated "Allowed values", trimmed) and "Number range"
 * ("Minimum"/"Maximum", inclusive). "Save" applies the rule to the current
 * range and closes; an existing rule is prefilled and offers "Delete rule".
 */
export function DataValidationDialog({
  open,
  workbookId,
  sheetId,
  range,
  existing,
  onOpenChange,
  onSaved,
}: DataValidationDialogProps) {
  const [ruleType, setRuleType] = useState<"dropdown" | "number">("dropdown");
  const [allowedValues, setAllowedValues] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowedId = useId();
  const minimumId = useId();
  const maximumId = useId();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    if (existing?.type === "dropdown") {
      setRuleType("dropdown");
      setAllowedValues((existing.allowedValues ?? []).join(", "));
    } else if (existing) {
      setRuleType("number");
      setMinimum(existing.min != null ? String(existing.min) : "");
      setMaximum(existing.max != null ? String(existing.max) : "");
    } else {
      setRuleType("dropdown");
      setAllowedValues("");
      setMinimum("");
      setMaximum("");
    }
  }, [open, existing]);

  const buildRule = (): { type: "dropdown"; allowedValues: string[] } | { type: "number"; min: number; max: number } | null => {
    if (ruleType === "dropdown") {
      const values = parseAllowedValues(allowedValues);
      if (values.length === 0) {
        setError("Allowed values cannot be empty");
        return null;
      }
      return { type: "dropdown", allowedValues: values };
    }
    if (minimum.trim() === "" || maximum.trim() === "") {
      setError("Minimum and maximum must be numbers");
      return null;
    }
    const min = Number(minimum.trim());
    const max = Number(maximum.trim());
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      setError("Minimum and maximum must be numbers");
      return null;
    }
    if (min > max) {
      setError("Minimum must not exceed maximum");
      return null;
    }
    return { type: "number", min, max };
  };

  const save = async () => {
    if (busy) return;
    const rule = buildRule();
    if (!rule) return;
    setBusy(true);
    setError(null);
    try {
      const workbook = await setValidation(workbookId, sheetId, { range, rule });
      onSaved(workbook);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save validation rule");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const workbook = await setValidation(workbookId, sheetId, { deleteRuleId: existing.id });
      onSaved(workbook);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete validation rule");
      setBusy(false);
    }
  };

  const rangeLabel = `${cellCoordinate(range.start.row, range.start.column)}:${cellCoordinate(range.end.row, range.end.column)}`;

  return (
    <Dialog
      open={open}
      title="Data validation"
      onOpenChange={onOpenChange}
      actions={
        <>
          {existing ? (
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              Delete rule
            </Button>
          ) : null}
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <p className="data-validation-dialog__range">Range: {rangeLabel}</p>
      <div className="data-validation-dialog__form">
        <Combobox
          label="Rule type"
          options={[
            { value: "dropdown", label: "Dropdown" },
            { value: "number", label: "Number range" },
          ]}
          value={ruleType}
          onChange={(event) => {
            setRuleType(event.target.value as "dropdown" | "number");
            setError(null);
          }}
        />
        {ruleType === "dropdown" ? (
          <FormField id={allowedId} label="Allowed values">
            <input
              id={allowedId}
              value={allowedValues}
              onChange={(event) => {
                setAllowedValues(event.target.value);
                setError(null);
              }}
            />
          </FormField>
        ) : (
          <div className="data-validation-dialog__number-fields">
            <FormField id={minimumId} label="Minimum">
              <input
                id={minimumId}
                value={minimum}
                onChange={(event) => {
                  setMinimum(event.target.value);
                  setError(null);
                }}
              />
            </FormField>
            <FormField id={maximumId} label="Maximum">
              <input
                id={maximumId}
                value={maximum}
                onChange={(event) => {
                  setMaximum(event.target.value);
                  setError(null);
                }}
              />
            </FormField>
          </div>
        )}
      </div>
      {error ? (
        <p role="alert" className="data-validation-dialog__error">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

