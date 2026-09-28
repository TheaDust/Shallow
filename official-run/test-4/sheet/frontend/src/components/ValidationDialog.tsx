import { useState } from "react";

import { Dialog } from "./Dialog";
import type { CellRange } from "../lib/spreadsheet";
import type { ValidationRule, ValidationRulePayload } from "../lib/workbooks";

interface ValidationDialogProps {
  range: CellRange;
  /** Existing rule covering the selection, if any (prefills the dialog). */
  existing: ValidationRule | null;
  onSave: (payload: ValidationRulePayload) => Promise<void>;
  onDelete: (ruleId: string) => Promise<void>;
  onClose: () => void;
}

/**
 * The "Data validation" dialog (REQ-5-2-1). A "Rule type" combo box selects
 * "Dropdown" (comma-separated "Allowed values", trimmed of leading/trailing
 * spaces) or "Number range" ("Minimum"/"Maximum", inclusive). "Save" applies
 * the rule and closes on success; reopening an existing rule prefills the
 * dialog and offers "Delete rule".
 */
export function ValidationDialog({
  range,
  existing,
  onSave,
  onDelete,
  onClose,
}: ValidationDialogProps) {
  const initialType = existing ? (existing.type === "dropdown" ? "Dropdown" : "Number range") : "Dropdown";
  const [ruleType, setRuleType] = useState<string>(initialType);
  const [allowedText, setAllowedText] = useState<string>(
    existing && existing.type === "dropdown" ? existing.allowed?.join(", ") ?? "" : "",
  );
  const [minText, setMinText] = useState<string>(
    existing && existing.type === "number" ? String(existing.min) : "",
  );
  const [maxText, setMaxText] = useState<string>(
    existing && existing.type === "number" ? String(existing.max) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function buildPayload(): ValidationRulePayload | null {
    const base = {
      ruleId: existing?.id,
      start: range.start,
      end: range.end,
      type: ruleType === "Number range" ? ("number" as const) : ("dropdown" as const),
    };
    if (base.type === "dropdown") {
      const allowed = allowedText
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
      if (allowed.length === 0) {
        setError("Allowed values cannot be empty");
        return null;
      }
      return { ...base, allowed };
    }
    const min = Number(minText);
    const max = Number(maxText);
    if (minText.trim() === "" || maxText.trim() === "" || !Number.isFinite(min) || !Number.isFinite(max)) {
      setError("Minimum and Maximum must be numbers");
      return null;
    }
    if (min > max) {
      setError("Minimum must not exceed Maximum");
      return null;
    }
    return { ...base, min, max };
  }

  async function save() {
    if (busy) return;
    const payload = buildPayload();
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(payload);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(existing.id);
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog label="Data validation" onClose={onClose}>
      <h2>Data validation</h2>

      <div className="dialog-field">
        <label htmlFor="rule-type">Rule type</label>
        <select id="rule-type" value={ruleType} onChange={(event) => setRuleType(event.target.value)}>
          <option value="Dropdown">Dropdown</option>
          <option value="Number range">Number range</option>
        </select>
      </div>

      {ruleType === "Dropdown" ? (
        <div className="dialog-field">
          <label htmlFor="allowed-values">Allowed values</label>
          <input
            id="allowed-values"
            type="text"
            value={allowedText}
            onChange={(event) => setAllowedText(event.target.value)}
            placeholder="Comma-separated values"
          />
        </div>
      ) : (
        <div className="dialog-field dialog-number-fields">
          <div>
            <label htmlFor="rule-minimum">Minimum</label>
            <input
              id="rule-minimum"
              type="text"
              value={minText}
              onChange={(event) => setMinText(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="rule-maximum">Maximum</label>
            <input
              id="rule-maximum"
              type="text"
              value={maxText}
              onChange={(event) => setMaxText(event.target.value)}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
          Save
        </button>
        {existing && (
          <button type="button" onClick={() => void remove()} disabled={busy}>
            Delete rule
          </button>
        )}
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
