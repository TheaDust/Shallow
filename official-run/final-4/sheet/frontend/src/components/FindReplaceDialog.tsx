import { useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { nextMatchIndex } from "../domain/find";

export interface FindReplaceDialogProps {
  open: boolean;
  /** Selection anchor when the dialog opens: where "Find next" starts reading. */
  startAnchor: string;
  onOpenChange(open: boolean): void;
  /** Coordinates of the active worksheet's matching cells, in grid order. */
  matches(query: string, matchCase: boolean): string[];
  /** Selects (and persists) one matching cell of the active worksheet. */
  onSelect(coordinate: string): void;
  /**
   * Replaces every matching cell in one atomic write and resolves with the
   * number of replaced cells. A rejection reports its message in the dialog and
   * leaves the worksheet at its last successful state.
   */
  onReplaceAll(query: string, replacement: string, matchCase: boolean): Promise<number>;
}

const FIND_FIELD_ID = "find-replace-query";
const REPLACE_FIELD_ID = "find-replace-replacement";
const MATCH_CASE_ID = "find-replace-match-case";

/**
 * "Find and replace" of the "Edit" menu. A cell matches when its whole
 * displayed value equals the "Find" text; "Match case" turns the comparison
 * case-sensitive. "Find next" walks the matches in grid order (wrapping around)
 * and selects each one, and "Replace all" rewrites every match of the active
 * worksheet in a single request, so the reported count and the stored cells
 * always agree.
 */
export function FindReplaceDialog({
  open,
  startAnchor,
  onOpenChange,
  matches,
  onSelect,
  onReplaceAll,
}: FindReplaceDialogProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Cell the next "Find next" reads from: the selection, then the last match. */
  const [cursor, setCursor] = useState<string | null>(null);
  const wasOpen = useRef(open);

  // Every open starts a fresh search from the current selection, so a previous
  // dialog's counts and messages are never carried over.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setQuery("");
    setReplacement("");
    setMatchCase(false);
    setMessage("");
    setError(null);
    setBusy(false);
    setCursor(null);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const findNext = () => {
    setError(null);
    const found = matches(query, matchCase);
    if (found.length === 0) {
      setMessage("No matches");
      return;
    }
    const index = nextMatchIndex(found, cursor ?? startAnchor);
    const coordinate = found[index];
    setCursor(coordinate);
    onSelect(coordinate);
    setMessage(`Match ${index + 1} of ${found.length}`);
  };

  const replaceAll = () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    onReplaceAll(query, replacement, matchCase)
      .then((count) => {
        setMessage(`Replaced ${count} cells`);
        setBusy(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to replace the cells");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Find and replace" onOpenChange={onOpenChange}>
      <div className="find-replace">
        <FormField id={FIND_FIELD_ID} label="Find">
          <input
            id={FIND_FIELD_ID}
            type="text"
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
        </FormField>
        <FormField id={REPLACE_FIELD_ID} label="Replace with">
          <input
            id={REPLACE_FIELD_ID}
            type="text"
            value={replacement}
            disabled={busy}
            onChange={(event) => setReplacement(event.target.value)}
          />
        </FormField>
        <div className="find-replace__option">
          <input
            id={MATCH_CASE_ID}
            type="checkbox"
            checked={matchCase}
            disabled={busy}
            onChange={(event) => setMatchCase(event.target.checked)}
          />
          <label htmlFor={MATCH_CASE_ID}>Match case</label>
        </div>
        <p className="find-replace__message" role="status">
          {message}
        </p>
        {error ? (
          <p className="find-replace__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="find-replace__actions">
          <Button onClick={findNext} disabled={busy}>
            Find next
          </Button>
          <Button variant="primary" onClick={replaceAll} disabled={busy}>
            Replace all
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
