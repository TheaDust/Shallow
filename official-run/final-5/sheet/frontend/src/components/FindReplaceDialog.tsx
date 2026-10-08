import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import type { FindRequest, ReplaceRequest } from "../domain/find-replace";

export interface FindReplaceDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /**
   * Selects the next matching cell and returns the message to display, or
   * `null` when the search matches nothing.
   */
  onFindNext(request: FindRequest): string | null;
  /**
   * Replaces every matching cell of the active worksheet and returns the
   * message to display; a rejected replacement rejects with its message.
   */
  onReplaceAll(request: ReplaceRequest): Promise<string>;
}

/**
 * Dialog of the "Find and replace" command. A cell matches when its entire
 * displayed value equals the Find text; "Match case" switches between a
 * case-insensitive and a case-sensitive comparison. "Find next" walks the
 * matching cells one by one (the page selects them and reports the position),
 * "Replace all" rewrites every match of the active worksheet in one atomic
 * request, so the replacement persists after a refresh.
 */
export function FindReplaceDialog({ open, onOpenChange, onFindNext, onReplaceAll }: FindReplaceDialogProps) {
  const [find, setFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);
  const findId = useId();
  const replaceId = useId();
  const caseId = useId();

  // A fresh dialog starts empty (and case-insensitive), during render so the
  // first committed paint already shows the defaults.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setFind("");
    setReplaceWith("");
    setMatchCase(false);
    setMessage(null);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const request: FindRequest = { find, matchCase };

  const submitFindNext = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setMessage(onFindNext(request));
  };

  const replaceAll = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onReplaceAll({ ...request, replaceWith })
      .then((result) => setMessage(result))
      .catch((caught: unknown) => {
        setMessage(null);
        setError(caught instanceof Error ? caught.message : "Unable to replace the matching cells");
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={open} title="Find and replace" onOpenChange={onOpenChange}>
      <form className="find-replace" onSubmit={submitFindNext}>
        <FormField id={findId} label="Find">
          <input
            id={findId}
            type="text"
            value={find}
            autoFocus
            disabled={busy}
            onChange={(event) => setFind(event.target.value)}
          />
        </FormField>
        <FormField id={replaceId} label="Replace with">
          <input
            id={replaceId}
            type="text"
            value={replaceWith}
            disabled={busy}
            onChange={(event) => setReplaceWith(event.target.value)}
          />
        </FormField>
        <label className="find-replace__case" htmlFor={caseId}>
          <input
            id={caseId}
            type="checkbox"
            checked={matchCase}
            disabled={busy}
            onChange={(event) => setMatchCase(event.target.checked)}
          />
          <span>Match case</span>
        </label>
        <div className="find-replace__actions">
          <Button type="submit" variant="secondary" disabled={busy}>
            Find next
          </Button>
          <Button type="button" variant="primary" onClick={replaceAll} disabled={busy}>
            Replace all
          </Button>
        </div>
        {message ? (
          <p className="find-replace__message" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="find-replace__error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
