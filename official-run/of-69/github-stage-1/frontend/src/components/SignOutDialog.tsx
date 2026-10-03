import { Button, Dialog } from "../ui";

export interface SignOutDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void | Promise<void>;
}

export function SignOutDialog({ open, onOpenChange, onConfirm }: SignOutDialogProps) {
  return (
    <Dialog
      open={open}
      title="Sign out"
      description="Signing out ends only the current browser session. Other sessions and devices stay signed in."
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" type="button" onClick={() => void onConfirm()}>
            Confirm sign out
          </Button>
        </>
      }
    >
      <p>Do you want to end the current browser session?</p>
    </Dialog>
  );
}
