import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface FindReplaceDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /**
   * Selects the next matching cell and returns the status line to display.
   * Rejecting keeps the dialog open with the message shown.
   */
  onFindNext(findText: string, matchCase: boolean): Promise<string>;
  /** Replaces every matching cell and returns the status line to display. */
  onReplaceAll(findText: string, replaceText: string, matchCase: boolean): Promise<string>;
}

const FIND_FIELD_ID = "find-replace-find";
const REPLACE_FIELD_ID = "find-replace-replace";
const MATCH_CASE_FIELD_ID = "find-replace-match-case";

/**
 * Find and replace over the active worksheet. A cell matches when its whole
 * displayed value equals the Find text; the comparison ignores letter case
 * unless "Match case" is checked. "Find next" walks through the matches in
 * reading order and reports the reached one; "Replace all" writes every match
 * in one atomic request and reports how many cells were replaced, so a
 * rejected replacement leaves the grid at its last successful state.
 */
export function FindReplaceDialog({ open, onOpenChange, onFindNext, onReplaceAll }: FindReplaceDialogProps) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Each opening starts a fresh search: the fields, the flags and both lines
  // describe the run a viewer is about to make, never the previous one.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setFindText("");
    setReplaceText("");
    setMatchCase(false);
    setStatus(null);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const run = async (action: () => Promise<string>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(() => onFindNext(findText, matchCase), "Unable to find the next match");
  };

  return (
    <Dialog open={open} title="Find and replace" onOpenChange={onOpenChange}>
      <form className="find-replace" onSubmit={submit}>
        <FormField id={FIND_FIELD_ID} label="Find">
          <input
            id={FIND_FIELD_ID}
            type="text"
            value={findText}
            disabled={busy}
            onChange={(event) => setFindText(event.target.value)}
          />
        </FormField>
        <FormField id={REPLACE_FIELD_ID} label="Replace with">
          <input
            id={REPLACE_FIELD_ID}
            type="text"
            value={replaceText}
            disabled={busy}
            onChange={(event) => setReplaceText(event.target.value)}
          />
        </FormField>
        <div className="ui-field ui-field--checkbox">
          <label htmlFor={MATCH_CASE_FIELD_ID}>
            <input
              id={MATCH_CASE_FIELD_ID}
              type="checkbox"
              checked={matchCase}
              disabled={busy}
              onChange={(event) => setMatchCase(event.target.checked)}
            />
            Match case
          </label>
        </div>
        <p className="find-replace__status" role="status">
          {status ?? ""}
        </p>
        {error ? (
          <p className="find-replace__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="find-replace__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Find next
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => run(() => onReplaceAll(findText, replaceText, matchCase), "Unable to replace the cells")}
          >
            Replace all
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
