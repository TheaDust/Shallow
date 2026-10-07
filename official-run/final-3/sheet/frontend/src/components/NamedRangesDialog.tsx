import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import {
  INVALID_NAMED_RANGE_RANGE_MESSAGE,
  namedRangeNameError,
  namedRangeText,
  parseNamedRangeRange,
} from "../domain/namedRanges";
import type { NamedRange, Workbook } from "../domain/types";

/** One named range to store: the new name, its range and the entry it replaces. */
export interface NamedRangeInput {
  name: string;
  worksheetId: string;
  range: string;
  /** Name the edited entry had before, so a rename replaces it. */
  previousName?: string;
}

export interface NamedRangesDialogProps {
  open: boolean;
  workbook: Workbook;
  /** Worksheet the editor shows; an unqualified `Range` belongs to it. */
  activeWorksheetId: string;
  onOpenChange(open: boolean): void;
  /**
   * Persist the name and range. The dialog closes only when the save succeeds,
   * so a rejected name keeps the form and its message visible; a saved name
   * closes the dialog so the grid can be edited again.
   */
  onSave(input: NamedRangeInput): Promise<void>;
}

const NAME_FIELD_ID = "named-range-name";
const RANGE_FIELD_ID = "named-range-range";

interface OpenForm {
  /** Name of the entry being edited, or `null` while adding a new one. */
  previousName: string | null;
}

/**
 * Creates and edits the workbook's named ranges. A saved name is usable as a
 * range reference in formulas, and its `Range` reads as `Sheet!A1:B2`, which is
 * also the text the visitor types when changing it.
 */
export function NamedRangesDialog({
  open,
  workbook,
  activeWorksheetId,
  onOpenChange,
  onSave,
}: NamedRangesDialogProps) {
  const [form, setForm] = useState<OpenForm | null>(null);
  const [name, setName] = useState("");
  const [range, setRange] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Reset the dialog as it opens, during render, so the first paint already
  // shows the saved names without a half-filled form.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setForm(null);
    setName("");
    setRange("");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const namedRanges: NamedRange[] = workbook.namedRanges ?? [];

  const startAdd = () => {
    setForm({ previousName: null });
    setName("");
    setRange("");
    setError(null);
  };

  const startEdit = (namedRange: NamedRange) => {
    setForm({ previousName: namedRange.name });
    setName(namedRange.name);
    setRange(namedRangeText(namedRange, workbook));
    setError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !form) return;
    const trimmedName = name.trim();
    const nameError = namedRangeNameError(trimmedName);
    if (nameError) {
      setError(nameError);
      return;
    }
    const parsed = parseNamedRangeRange(range, workbook, activeWorksheetId);
    if (!parsed) {
      setError(INVALID_NAMED_RANGE_RANGE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    onSave({ name: trimmedName, ...parsed, previousName: form.previousName ?? undefined })
      .then(() => {
        setForm(null);
        setBusy(false);
        onOpenChange(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to save the named range");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Named ranges" onOpenChange={onOpenChange}>
      <div className="named-ranges">
        <Button type="button" onClick={startAdd}>
          Add named range
        </Button>
        {form ? (
          <form className="named-ranges__form" onSubmit={submit}>
            <FormField id={NAME_FIELD_ID} label="Name">
              <input
                id={NAME_FIELD_ID}
                type="text"
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField id={RANGE_FIELD_ID} label="Range">
              <input
                id={RANGE_FIELD_ID}
                type="text"
                value={range}
                disabled={busy}
                onChange={(event) => setRange(event.target.value)}
              />
            </FormField>
            {error ? (
              <p className="named-ranges__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="named-ranges__actions">
              <Button type="submit" variant="primary" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        ) : null}
        <ul className="named-ranges__list">
          {namedRanges.map((namedRange) => (
            <li key={namedRange.name} className="named-ranges__item">
              <span className="named-ranges__name">{namedRange.name}</span>
              <Button type="button" onClick={() => startEdit(namedRange)}>
                {`Edit ${namedRange.name}`}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
