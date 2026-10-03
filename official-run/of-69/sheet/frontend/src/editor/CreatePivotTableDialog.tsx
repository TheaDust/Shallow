import { useState } from "react";

import { ApiError } from "../lib/api";
import { createPivotTable } from "../domain/workbook-api";
import type { Workbook } from "../domain/types";
import { Button, Dialog } from "../ui";

export const PIVOT_CREATE_ERROR = "Unable to create the pivot table. Please try again.";

export interface CreatePivotTableDialogProps {
  workbookId: string;
  /** Worksheet holding the selected source range. */
  sourceWorksheetId: string;
  /** The selected rectangle the pivot reads, shown as "Source range: <cell range>". */
  range: string;
  onOpenChange(open: boolean): void;
  onCreated(workbook: Workbook): void;
}

/**
 * "Create pivot table" dialog (REQ-5-3-1): it shows the source range, offers the
 * "New worksheet" destination and creates the pivot-result worksheet on "Create". The
 * source worksheet is only read, and a failure keeps the workbook as it was.
 */
export function CreatePivotTableDialog({
  workbookId,
  sourceWorksheetId,
  range,
  onOpenChange,
  onCreated,
}: CreatePivotTableDialogProps) {
  const [destination, setDestination] = useState("new");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      onCreated(await createPivotTable(workbookId, { sourceWorksheetId, range }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : PIVOT_CREATE_ERROR);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Create pivot table"
      description={`Source range: ${range}`}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={create} disabled={saving}>
            Create
          </Button>
        </>
      }
    >
      <fieldset className="pivot-dialog__destinations">
        <legend>Destination</legend>
        <label>
          <input
            type="radio"
            name="pivot-destination"
            value="new"
            checked={destination === "new"}
            onChange={() => setDestination("new")}
          />
          {" "}
          New worksheet
        </label>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </Dialog>
  );
}
