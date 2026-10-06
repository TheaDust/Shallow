import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { INVALID_NAMED_RANGE_MESSAGE, namedRangeNameError, normalizeNamedRangeText } from "../domain/named-ranges";
import type { NamedRange } from "../domain/types";

export interface NamedRangeDraft {
  /** Id of the entry being edited; absent while a new name is created. */
  id?: string;
  name: string;
  range: string;
}

export interface NamedRangesDialogProps {
  open: boolean;
  /** Names saved in the workbook, in the order they were saved. */
  namedRanges: NamedRange[];
  onOpenChange(open: boolean): void;
  /**
   * Persist a new or edited name. Rejecting keeps the form open with the
   * message shown, so an invalid name leaves the stored names untouched.
   */
  onSave(draft: NamedRangeDraft): Promise<void>;
}

const NAME_FIELD_ID = "named-range-name";
const RANGE_FIELD_ID = "named-range-range";

/**
 * Management interface of a workbook's named ranges. Every saved name is listed
 * with its own "Edit &lt;name&gt;" control, which reopens the form holding that
 * entry so its range can be replaced; "Add named range" opens the same form for
 * a new name. Saving persists through the server and closes the dialog.
 */
export function NamedRangesDialog({ open, namedRanges, onOpenChange, onSave }: NamedRangesDialogProps) {
  const [draft, setDraft] = useState<NamedRangeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // A reopened interface starts without the report of a previous attempt.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setDraft(null);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const change = (part: Partial<NamedRangeDraft>) => {
    setDraft((current) => (current ? { ...current, ...part } : current));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !draft) return;
    // The name rule and the range shape are checked here for an immediate
    // message; the server re-validates both before its atomic write.
    const nameError = namedRangeNameError(draft.name);
    if (nameError) {
      setError(nameError);
      return;
    }
    const range = normalizeNamedRangeText(draft.range);
    if (!range) {
      setError(INVALID_NAMED_RANGE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    const request: NamedRangeDraft = { name: draft.name.trim(), range };
    if (draft.id) request.id = draft.id;
    onSave(request)
      .then(() => onOpenChange(false))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to save the named range");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Named ranges" onOpenChange={onOpenChange}>
      <div className="named-ranges">
        {namedRanges.length === 0 ? (
          <p className="named-ranges__empty" role="status">
            No named ranges
          </p>
        ) : (
          <ul className="named-ranges__list">
            {namedRanges.map((entry) => (
              <li key={entry.id} className="named-ranges__item">
                <span className="named-ranges__name">{entry.name}</span>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setDraft({ id: entry.id, name: entry.name, range: entry.range });
                  }}
                >
                  {`Edit ${entry.name}`}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p className="named-ranges__error" role="alert">
            {error}
          </p>
        ) : null}
        {draft ? (
          <form className="named-ranges__form" onSubmit={submit}>
            <FormField id={NAME_FIELD_ID} label="Name">
              <input
                id={NAME_FIELD_ID}
                type="text"
                value={draft.name}
                disabled={busy}
                onChange={(event) => change({ name: event.target.value })}
              />
            </FormField>
            <FormField id={RANGE_FIELD_ID} label="Range">
              <input
                id={RANGE_FIELD_ID}
                type="text"
                value={draft.range}
                disabled={busy}
                onChange={(event) => change({ range: event.target.value })}
              />
            </FormField>
            <div className="named-ranges__actions">
              <Button type="submit" variant="primary" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <div className="named-ranges__actions">
            <Button
              disabled={busy}
              onClick={() => {
                setError(null);
                setDraft({ name: "", range: "" });
              }}
            >
              Add named range
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
