import { useEffect, useState, type FormEvent } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { Button, Combobox, Dialog, FormField, Menu } from "../ui";
import { addOrganizationMember, fetchOrganizationMembers, removeOrganizationMember } from "./api";
import { organizationRoleLabel } from "./format";
import type { OrganizationMember, OrganizationRole } from "./types";

export interface OrganizationPeopleProps {
  slug: string;
  /** Only an organization Owner sees the add-member and remove-member controls. */
  canManage: boolean;
}

const LOAD_ERROR = "We could not load the members. Try again.";
const ADD_ERROR = "We could not add the member. Try again.";
const REMOVE_ERROR = "We could not remove the member. Try again.";

const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "owner", label: "Owner" },
];

/**
 * People page of one organization. An Owner adds an existing account directly
 * by username or verified email (Member by default) and removes a member
 * through that member's own menu; both write immediately and the list reflects
 * the stored state. A non-Owner only reads the member list.
 */
export function OrganizationPeople({ slug, canManage }: OrganizationPeopleProps) {
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [selectedRole, setSelectedRole] = useState<OrganizationRole>("member");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<OrganizationMember | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMembers(null);
    setFailed(false);
    setFormOpen(false);
    setPendingRemoval(null);
    fetchOrganizationMembers(slug)
      .then((next) => {
        if (!cancelled) setMembers(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldError(undefined);
    setFormError(null);
    try {
      setMembers(await addOrganizationMember(slug, { identifier, role: selectedRole }));
      setIdentifier("");
      setFormOpen(false);
    } catch (failure) {
      const errors = fieldErrorsOf(failure);
      if (errors?.identifier) setFieldError(errors.identifier);
      else setFormError(errorMessageOf(failure) ?? ADD_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(member: OrganizationMember) {
    if (busy) return;
    setBusy(true);
    setRemovalError(null);
    try {
      setMembers(await removeOrganizationMember(slug, member.username));
      setPendingRemoval(null);
    } catch (failure) {
      setRemovalError(errorMessageOf(failure) ?? REMOVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (failed) return <p role="alert">{LOAD_ERROR}</p>;
  if (members === null) return <p role="status">Loading members…</p>;

  return (
    <div className="org-people">
      {canManage ? (
        formOpen ? (
          <form className="app-form" noValidate onSubmit={handleAdd}>
            <FormField id="organization-member-identifier" label="Username or email" error={fieldError}>
              <input
                id="organization-member-identifier"
                name="identifier"
                type="text"
                autoComplete="off"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </FormField>
            <Combobox
              id="organization-member-role"
              label="Role"
              options={ROLE_OPTIONS}
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value as OrganizationRole)}
            />
            <div className="app-form__actions">
              <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
                Add member
              </Button>
            </div>
          </form>
        ) : (
          <div className="app-form__actions">
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              Add member
            </Button>
          </div>
        )
      ) : null}
      {formError ? (
        <p className="app-form__error" role="alert">
          {formError}
        </p>
      ) : null}
      {members.length === 0 ? (
        <p className="org-people__empty">This organization has no members yet.</p>
      ) : (
        <ul className="member-list" aria-label="Organization members">
          {members.map((member) => (
            <li key={member.username} className="member-list__item">
              <span className="member-list__username">{member.username}</span>
              <span className="member-list__role">{organizationRoleLabel(member.role)}</span>
              {canManage ? (
                <Menu
                  triggerLabel={`Member menu ${member.username}`}
                  triggerContent="⋯"
                  menuLabel={`Member menu ${member.username}`}
                  items={[
                    {
                      id: "remove",
                      label: "Remove from organization",
                      tone: "danger",
                      onSelect: () => {
                        setRemovalError(null);
                        setPendingRemoval(member);
                      },
                    },
                  ]}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && pendingRemoval ? (
        <Dialog
          open
          title="Remove from organization"
          showClose={false}
          description="The membership and this account's team memberships and direct repository grants in this organization are deleted. Access held by teams stays."
          onOpenChange={(open) => {
            if (!open) setPendingRemoval(null);
          }}
          actions={
            <>
              <Button variant="secondary" onClick={() => setPendingRemoval(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                aria-busy={busy}
                onClick={() => {
                  void handleRemove(pendingRemoval);
                }}
              >
                Remove
              </Button>
            </>
          }
        >
          {removalError ? (
            <p className="app-form__error" role="alert">
              {removalError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
