import { ConditionalFormattingDialog } from "./ConditionalFormattingDialog";
import { NamedRangesDialog } from "./NamedRangesDialog";
import { deleteConditionalFormat, saveConditionalFormat, saveNamedRange } from "../lib/workbook-api";
import type { Workbook, Worksheet } from "../domain/types";

/** Which of the workbook's reference and formatting dialogs is open. */
export type ReferenceFormattingDialogName = "named" | "conditional" | null;

export interface ReferenceFormattingDialogsProps {
  open: ReferenceFormattingDialogName;
  onOpenChange(open: ReferenceFormattingDialogName): void;
  /** Workbook owning the named ranges; its id addresses the write endpoints. */
  workbook: Workbook;
  /** Worksheet the conditional-formatting rules and the selection belong to. */
  worksheet: Worksheet;
  /** A1 area of the current selection, the target range of a new rule. */
  selectionRange: string;
  /** Stores the workbook state the server answered with. */
  onSaved(workbook: Workbook): void;
}

/**
 * The two reference and formatting dialogs of the editor: the workbook's
 * "Named ranges" and the active worksheet's "Conditional formatting". Saving a
 * name or a rule goes through the workbook API and hands the stored state back,
 * so the grid repaints from the authoritative answer; a rejection is reported
 * inside the dialog, which stays open with the typed values.
 */
export function ReferenceFormattingDialogs({
  open,
  onOpenChange,
  workbook,
  worksheet,
  selectionRange,
  onSaved,
}: ReferenceFormattingDialogsProps) {
  return (
    <>
      <NamedRangesDialog
        open={open === "named"}
        namedRanges={workbook.namedRanges ?? []}
        onOpenChange={(next) => onOpenChange(next ? "named" : null)}
        onSave={async (entry) => {
          onSaved(await saveNamedRange(workbook.id, entry));
        }}
      />
      <ConditionalFormattingDialog
        open={open === "conditional"}
        range={selectionRange}
        rules={worksheet.conditionalFormats ?? []}
        onOpenChange={(next) => onOpenChange(next ? "conditional" : null)}
        onSave={async (rule) => {
          onSaved(await saveConditionalFormat(workbook.id, worksheet.id, rule));
        }}
        onDelete={async (id) => {
          onSaved(await deleteConditionalFormat(workbook.id, worksheet.id, id));
        }}
      />
    </>
  );
}
