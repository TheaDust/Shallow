import { useEffect, useState } from "react";

import { Button, Combobox, Dialog, FormField } from "../../ui";
import { errorMessage, setValidations } from "./api";
import {
  dropdownRuleMessage,
  dropdownRuleValues,
  numberRangeRuleMessage,
} from "./filtering";
import type { ValidationRule, WorkbookData, WorksheetData } from "./types";

export const DROPDOWN_RULE_TYPE = "dropdown";
export const NUMBER_RANGE_RULE_TYPE = "number-range";

export const RULE_TYPE_OPTIONS = [
  { value: DROPDOWN_RULE_TYPE, label: "Dropdown" },
  { value: NUMBER_RANGE_RULE_TYPE, label: "Number range" },
] as const;

const EMPTY_ALLOWED_VALUES_MESSAGE = "Enter at least one value, separated by commas.";
const INVALID_NUMBER_RANGE_MESSAGE = "Enter a minimum and a maximum number; the minimum must not be greater.";

export interface DataValidationDialogProps {
  workbookId: string;
  worksheet: WorksheetData;
  /** Target range of the rule: the rectangle currently selected in the grid. */
  range: { start: string; end: string };
  /** Rule already covering the target range, reopened for editing. */
  existingRule: ValidationRule | null;
  onSaved(workbook: WorkbookData): void;
  onClose(): void;
}

/** True when an input is a finite number. */
function parseBound(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

/**
 * "Data validation" dialog of the "Data" menu. It saves one rule for the
 * selected range: a "Dropdown" of allowed values or an inclusive "Number range".
 * Reopening it for a range an existing rule covers prefills the type and its
 * parameters and adds "Delete rule".
 */
export function DataValidationDialog({
  workbookId,
  worksheet,
  range,
  existingRule,
  onSaved,
  onClose,
}: DataValidationDialogProps) {
  const [ruleType, setRuleType] = useState(
    existingRule?.type === "number-between" ? NUMBER_RANGE_RULE_TYPE : DROPDOWN_RULE_TYPE,
  );
  const [allowedValues, setAllowedValues] = useState(
    existingRule?.type === "dropdown" ? (existingRule.values ?? []).join(", ") : "",
  );
  const [minimum, setMinimum] = useState(existingRule?.type === "number-between" ? String(existingRule.min ?? "") : "");
  const [maximum, setMaximum] = useState(existingRule?.type === "number-between" ? String(existingRule.max ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [existingRule?.id, range.start, range.end]);

  const rules = Array.isArray(worksheet.validations) ? worksheet.validations : [];
  const nextRuleId = () => {
    const taken = new Set(rules.map((stored) => stored.id));
    for (let index = 1; ; index += 1) {
      const candidate = `rule-${index}`;
      if (!taken.has(candidate)) return candidate;
    }
  };

  const save = async () => {
    if (busy) return;
    let rule: ValidationRule;
    if (ruleType === DROPDOWN_RULE_TYPE) {
      const values = dropdownRuleValues(allowedValues);
      if (values.length === 0) {
        setError(EMPTY_ALLOWED_VALUES_MESSAGE);
        return;
      }
      rule = {
        id: existingRule?.id ?? nextRuleId(),
        range,
        type: "dropdown",
        values,
        message: dropdownRuleMessage(values),
      };
    } else {
      const min = parseBound(minimum);
      const max = parseBound(maximum);
      if (min === null || max === null || min > max) {
        setError(INVALID_NUMBER_RANGE_MESSAGE);
        return;
      }
      rule = {
        id: existingRule?.id ?? nextRuleId(),
        range,
        type: "number-between",
        min,
        max,
        message: numberRangeRuleMessage(min, max),
      };
    }
    const next = existingRule
      ? rules.map((stored) => (stored.id === existingRule.id ? rule : stored))
      : [...rules, rule];
    setBusy(true);
    setError(null);
    try {
      const result = await setValidations(workbookId, worksheet.id, next);
      onSaved(result.workbook);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !existingRule) return;
    const next = rules.filter((stored) => stored.id !== existingRule.id);
    setBusy(true);
    setError(null);
    try {
      const result = await setValidations(workbookId, worksheet.id, next);
      onSaved(result.workbook);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Data validation"
      description={`Range ${range.start}:${range.end}`}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={(
        <>
          {existingRule ? (
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>Delete rule</Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>Save</Button>
        </>
      )}
    >
      <div className="validation-dialog">
        <Combobox
          label="Rule type"
          value={ruleType}
          disabled={busy}
          options={RULE_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(event) => {
            setRuleType(event.target.value);
            setError(null);
          }}
        />
        {ruleType === DROPDOWN_RULE_TYPE ? (
          <FormField id="validation-allowed-values" label="Allowed values">
            <input
              id="validation-allowed-values"
              type="text"
              value={allowedValues}
              disabled={busy}
              onChange={(event) => {
                setAllowedValues(event.target.value);
                setError(null);
              }}
            />
          </FormField>
        ) : (
          <div className="validation-dialog__bounds">
            <FormField id="validation-minimum" label="Minimum">
              <input
                id="validation-minimum"
                type="text"
                value={minimum}
                disabled={busy}
                onChange={(event) => {
                  setMinimum(event.target.value);
                  setError(null);
                }}
              />
            </FormField>
            <FormField id="validation-maximum" label="Maximum">
              <input
                id="validation-maximum"
                type="text"
                value={maximum}
                disabled={busy}
                onChange={(event) => {
                  setMaximum(event.target.value);
                  setError(null);
                }}
              />
            </FormField>
          </div>
        )}
        {error ? <p role="alert" className="form-error">{error}</p> : null}
      </div>
    </Dialog>
  );
}
