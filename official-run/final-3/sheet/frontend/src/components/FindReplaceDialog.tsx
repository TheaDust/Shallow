import { useEffect, useId, useState } from "react";

import { matchCoordinates, matchNumber, nextMatchCoordinate } from "../domain/find";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface FindReplaceDialogProps {
  open: boolean;
  /** Raw cell texts of the active worksheet, the values that decide a match. */
  cells: Record<string, string>;
  /** Currently selected cell; the search continues after it in row-major order. */
  anchor: string;
  /** Selects one matching cell; the worksheet stores the new selection. */
  onSelectCell(coordinate: string): void;
  /** Replaces every match; resolves with the number of cells that changed. */
  onReplaceAll(request: { find: string; replaceWith: string; matchCase: boolean }): Promise<number>;
  onOpenChange(open: boolean): void;
}

/**
 * "Find and replace" dialog of the active worksheet. A cell matches when its
 * whole value equals the Find text (case-insensitively unless "Match case" is
 * checked). "Find next" selects the following match and reports its position
 * as `Match <current> of <total>`; "Replace all" rewrites every match through
 * the server and reports `Replaced <count> cells`.
 */
export function FindReplaceDialog({
  open,
  cells,
  anchor,
  onSelectCell,
  onReplaceAll,
  onOpenChange,
}: FindReplaceDialogProps) {
  const [find, setFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const findId = useId();
  const replaceId = useId();

  // Reopening starts a fresh search: the previous text and report are gone.
  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setError(null);
  }, [open]);

  const findNext = () => {
    setError(null);
    const matches = matchCoordinates(cells, { find, matchCase });
    const next = nextMatchCoordinate(matches, anchor);
    if (next === null) {
      setMessage("Match 0 of 0");
      return;
    }
    onSelectCell(next);
    setMessage(`Match ${matchNumber(matches, next)} of ${matches.length}`);
  };

  const replaceAll = async () => {
    if (find === "") {
      setMessage(null);
      setError("Enter the text to find");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const replaced = await onReplaceAll({ find, replaceWith, matchCase });
      setMessage(`Replaced ${replaced} cells`);
    } catch (caught) {
      setMessage(null);
      setError(caught instanceof Error ? caught.message : "Unable to replace the cells");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Find and replace"
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button onClick={findNext}>Find next</Button>
          <Button variant="primary" onClick={() => void replaceAll()} disabled={busy}>
            Replace all
          </Button>
        </>
      }
    >
      <FormField id={findId} label="Find">
        <input id={findId} type="text" value={find} onChange={(event) => setFind(event.target.value)} />
      </FormField>
      <FormField id={replaceId} label="Replace with">
        <input
          id={replaceId}
          type="text"
          value={replaceWith}
          onChange={(event) => setReplaceWith(event.target.value)}
        />
      </FormField>
      <label className="ui-checkbox">
        <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
        Match case
      </label>
      {message ? (
        <p className="ui-dialog__message" role="status">
          {message}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </Dialog>
  );
}
