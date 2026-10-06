import { useEffect, useState, type FormEvent } from "react";

import { findMatches, nextMatchIndex, replaceUpdates } from "../domain/find";
import { parseCellName } from "../domain/grid";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface FindReplaceDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Displayed value of every used cell of the active worksheet. */
  displayValues: Record<string, string>;
  /** Anchor of the current selection, the cell "Find next" searches after. */
  selectionAnchor: string;
  /** Selects one cell of the grid (and persists the selection). */
  onSelectCell(coordinate: string): void;
  /** Writes every replacement cell in one atomic request. */
  onReplaceCells(updates: Array<{ coordinate: string; value: string }>): Promise<void>;
}

const FIND_FIELD_ID = "find-replace-find";
const REPLACE_FIELD_ID = "find-replace-replace";

/**
 * "Find and replace" of the active worksheet. A cell matches when its whole
 * displayed value equals the "Find" text, ignoring letter case unless "Match
 * case" is checked. "Find next" selects the next matching cell and reports its
 * position as "Match <current> of <total>"; "Replace all" rewrites every match
 * in one atomic request and reports "Replaced <count> cells". A rejected
 * replacement shows its message instead and leaves the grid unchanged.
 */
export function FindReplaceDialog({
  open,
  onOpenChange,
  displayValues,
  selectionAnchor,
  onSelectCell,
  onReplaceCells,
}: FindReplaceDialogProps) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  /** Result of the last command, shown as it is while the dialog stays open. */
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFindText("");
      setReplaceText("");
      setMatchCase(false);
      setStatus(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const matches = () => findMatches(displayValues, findText, matchCase);

  const findNext = () => {
    setError(null);
    const found = matches();
    if (found.length === 0) {
      setStatus("Match 0 of 0");
      return;
    }
    const index = nextMatchIndex(found, parseCellName(selectionAnchor));
    const match = found[index];
    onSelectCell(match.coordinate);
    setStatus(`Match ${index + 1} of ${found.length}`);
  };

  const replaceAll = async () => {
    if (busy) return;
    const updates = replaceUpdates(matches(), replaceText);
    setError(null);
    if (updates.length === 0) {
      setStatus("Replaced 0 cells");
      return;
    }
    setBusy(true);
    try {
      await onReplaceCells(updates);
      setStatus(`Replaced ${updates.length} cells`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to replace the cells");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    findNext();
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
        <div className="find-replace__case">
          <input
            id="find-replace-match-case"
            type="checkbox"
            checked={matchCase}
            disabled={busy}
            onChange={(event) => setMatchCase(event.target.checked)}
          />
          <label htmlFor="find-replace-match-case">Match case</label>
        </div>
        <div className="find-replace__actions">
          <Button type="submit" disabled={busy}>
            Find next
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void replaceAll()}>
            Replace all
          </Button>
        </div>
        {status ? <p role="status">{status}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </Dialog>
  );
}
