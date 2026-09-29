import { useState } from "react";

import { ApiError } from "../../lib/api";
import { removeOrganizationMember } from "../../org/org-api";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Menu } from "../../ui/Menu";

export interface MemberRowActionsProps {
  organizationName: string;
  username: string;
  onChanged(): void;
}

/**
 * REQ-2-2-4: the per-member action menu of the People page, rendered only for an
 * organization Owner. “Member menu <username>” opens the menuitem “Remove from
 * organization”, which opens a confirmation dialog whose confirming button is
 * “Remove”. A non-Owner never receives this control at all.
 */
export function MemberRowActions({ organizationName, username, onChanged }: MemberRowActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeOrganizationMember(organizationName, username);
      setConfirmOpen(false);
      onChanged();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 400
          ? failure.message
          : "Unable to remove the member. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Menu
        triggerLabel={`Member menu ${username}`}
        menuLabel={`Member menu ${username}`}
        items={[
          {
            id: "remove-from-organization",
            label: "Remove from organization",
            tone: "danger",
            onSelect: () => {
              setError(null);
              setConfirmOpen(true);
            },
          },
        ]}
      />
      <Dialog
        open={confirmOpen}
        title={`Remove ${username}`}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false);
        }}
        actions={
          <>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              Remove
            </Button>
            <Button disabled={busy} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <p>
          {`${username} loses this organization membership, their team memberships in it and their direct repository grants of it.`}
        </p>
        {error ? (
          <p className="auth-form__error" role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
