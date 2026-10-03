import { useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { navigate } from "../lib/hash-route";
import { Button, Dialog } from "../ui";

export interface SignOutDialogProps {
  open: boolean;
  onDismiss(): void;
}

/**
 * Confirmation dialog for the sign-out workflow. Only "Confirm sign out" ends
 * the current browser session; cancelling or closing keeps it, together with
 * the page the user was on.
 */
export function SignOutDialog({ open, onDismiss }: SignOutDialogProps) {
  const { signOut } = useAuth();
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    await signOut();
    setPending(false);
    navigate("/");
  };

  return (
    <Dialog
      open={open}
      title="Sign out"
      description="Signing out ends only the session in this browser. Other browsers stay signed in."
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      actions={
        <>
          <Button onClick={onDismiss}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={() => void confirm()}>
            Confirm sign out
          </Button>
        </>
      }
    >
      <p>You must sign in again to reach your account, organizations, and repositories in this browser.</p>
    </Dialog>
  );
}
