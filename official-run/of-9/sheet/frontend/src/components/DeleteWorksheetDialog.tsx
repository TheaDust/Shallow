import type { Worksheet } from "../domain/types";
import { Button, Dialog } from "../ui";

export interface DeleteWorksheetDialogProps {
  open: boolean;
  sheet: Worksheet | null;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

/**
 * Confirmation dialog for the worksheet tab menu's Delete command. The visible
 * description names the target worksheet; confirming permanently removes its
 * data, formulas, filters, validation rules and pivot results.
 */
export function DeleteWorksheetDialog({ open, sheet, busy, onOpenChange, onConfirm }: DeleteWorksheetDialogProps) {
  const name = sheet?.name ?? "";
  return (
    <Dialog
      open={open}
      title="Delete worksheet"
      description={`Delete ${name}? This will permanently remove its data, formulas, filters, validation rules and pivot results.`}
      onOpenChange={onOpenChange}
      actions={
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          Delete worksheet
        </Button>
      }
    >
      <p>This action cannot be undone.</p>
    </Dialog>
  );
}
