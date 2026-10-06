import { useState, type FormEvent } from "react";

import { ApiError } from "../lib/api";
import {
  addOrganizationMember,
  fetchOrganizationMembers,
  removeOrganizationMember,
} from "../lib/org-api";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { Menu } from "../ui/Menu";
import { ErrorNote, LoadingNote } from "./ViewState";

const ROLE_OPTIONS = [
  { value: "Member", label: "Member" },
  { value: "Owner", label: "Owner" },
];

/**
 * People tab of the organization overview. Members and their roles are always
 * visible; an Owner additionally gets the direct "Add member" form and, on each
 * row, a "Member menu <username>" with the removal flow.
 */
export function OrganizationPeople({
  organizationId,
  viewerRole,
}: {
  organizationId: string;
  viewerRole: string | null;
}) {
  const { status, data, error, reload } = useAsyncData(
    () => fetchOrganizationMembers(organizationId),
    [organizationId],
  );
  const [adding, setAdding] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState("Member");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const isOwner = viewerRole === "Owner";

  const closeForm = () => {
    setAdding(false);
    setIdentifier("");
    setRole("Member");
    setFormError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await addOrganizationMember(organizationId, {
        identifier: identifier.trim(),
        role,
      });
      if (result.ok) {
        closeForm();
        reload();
      } else {
        setFormError(result.fieldErrors.identifier ?? result.fieldErrors.role ?? result.message);
      }
    } catch {
      setFormError("Unable to add the member. Please try again.");
    }
    setBusy(false);
  };

  const confirmRemove = async () => {
    const member = confirming;
    if (!member || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeOrganizationMember(organizationId, member);
      setConfirming(null);
      reload();
    } catch (caught) {
      setRemoveError(
        caught instanceof ApiError ? caught.message : "Unable to remove the member. Please try again.",
      );
    }
    setRemoving(false);
  };

  return (
    <div className="org-people">
      {isOwner ? (
        adding ? (
          <form className="org-people__form" aria-label="Add member" onSubmit={submit} noValidate>
            <FormField id="org-member-identifier" label="Username or email" error={formError ?? undefined}>
              <input
                id="org-member-identifier"
                name="identifier"
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </FormField>
            <Combobox
              id="org-member-role"
              label="Role"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
            <div className="org-people__actions">
              <Button type="submit" variant="primary" disabled={busy}>
                Add member
              </Button>
              <Button variant="secondary" onClick={closeForm}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="org-people__actions">
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add member
            </Button>
          </p>
        )
      ) : null}

      {status === "loading" ? <LoadingNote label="Loading members…" /> : null}
      {status === "error" && error ? <ErrorNote error={error} onRetry={reload} /> : null}
      {status === "ready" && data ? (
        data.length === 0 ? (
          <p className="org-people__empty">This organization has no members yet.</p>
        ) : (
          <ul className="member-list" aria-label="Members">
            {data.map((member) => (
              <li key={member.username} className="member-list__item">
                <span className="member-list__name">{member.username}</span>
                <span className="member-list__role">{member.role}</span>
                {isOwner ? (
                  <Menu
                    triggerLabel={`Member menu ${member.username}`}
                    triggerContent={<span aria-hidden="true">⋯</span>}
                    menuLabel={`Member menu ${member.username}`}
                    buttonVariant="ghost"
                    items={[
                      {
                        id: "remove-from-organization",
                        label: "Remove from organization",
                        tone: "danger",
                        onSelect: () => {
                          setRemoveError(null);
                          setConfirming(member.username);
                        },
                      },
                    ]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {confirming !== null ? (
        <Dialog
          open
          title="Remove from organization"
          onOpenChange={(next) => {
            if (!next) {
              setConfirming(null);
              setRemoveError(null);
            }
          }}
          actions={
            <>
              <Button variant="danger" disabled={removing} onClick={confirmRemove}>
                Remove
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirming(null);
                  setRemoveError(null);
                }}
              >
                Cancel
              </Button>
            </>
          }
        >
          <p>
            {`Removing ${confirming} also removes their team memberships and direct repository access grants in this organization.`}
          </p>
          {removeError ? (
            <p className="org-people__error" role="alert">
              {removeError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
