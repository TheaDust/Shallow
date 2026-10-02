import { useState, type FormEvent } from "react";

import {
  addOrganizationMember,
  removeOrganizationMember,
  type OrganizationMember,
} from "../../lib/organizations-api";
import { fieldErrorsOf, messageOf, type FieldErrors } from "../../lib/session-api";
import { Button, Dialog, FormField, Menu, fieldDescriptionIds } from "../../ui";
import { roleLabel } from "./format";

export interface OrganizationPeoplePanelProps {
  organizationName: string;
  members: OrganizationMember[];
  canManage: boolean;
  onChanged(): void;
}

const ROLE_OPTIONS = [
  { value: "Member", label: "Member" },
  { value: "Owner", label: "Owner" },
] as const;

/**
 * The "People" tab. An Owner adds an existing account directly (no invitation
 * or pending state) and can remove a member through that member's action menu.
 */
export function OrganizationPeoplePanel({
  organizationName,
  members,
  canManage,
  onChanged,
}: OrganizationPeoplePanelProps) {
  const [adding, setAdding] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<string>("Member");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await addOrganizationMember(organizationName, { identifier, role });
      setFieldErrors({});
      setIdentifier("");
      setAdding(false);
      onChanged();
    } catch (error) {
      // The form stays open so the identifier can be corrected and resubmitted.
      const errors = fieldErrorsOf(error);
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) {
        setFailure(messageOf(error, "Unable to add that member right now."));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removing || busy) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await removeOrganizationMember(organizationName, removing);
      setRemoving(null);
      onChanged();
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setRemoveError(
        Object.values(errors)[0] ?? messageOf(error, "Unable to remove that member right now."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="organization-people" aria-label="People">
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
      {canManage && !adding ? (
        <p className="organization-people__actions">
          <Button
            onClick={() => {
              setAdding(true);
              setFailure(null);
            }}
          >
            Add member
          </Button>
        </p>
      ) : null}
      {canManage && adding ? (
        <form className="organization-people__form" noValidate onSubmit={handleAdd}>
          <FormField
            id="member-identifier"
            label="Username or email"
            error={fieldErrors.identifier}
          >
            <input
              id="member-identifier"
              name="identifier"
              type="text"
              autoComplete="off"
              aria-describedby={fieldDescriptionIds("member-identifier", {
                error: Boolean(fieldErrors.identifier),
              })}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </FormField>
          <FormField id="member-role" label="Role" error={fieldErrors.role}>
            <select
              id="member-role"
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Add member
          </Button>
        </form>
      ) : null}
      <table className="organization-table">
        <thead>
          <tr>
            <th scope="col">Username</th>
            <th scope="col">Role</th>
            {canManage ? <th scope="col">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.username}>
              <td>{member.username}</td>
              <td>{roleLabel(member.role)}</td>
              {canManage ? (
                <td>
                  <Menu
                    triggerLabel={`Member menu ${member.username}`}
                    menuLabel={`Member menu ${member.username}`}
                    triggerContent={
                      <span className="ui-menu__glyph" aria-hidden="true">
                        ⋯
                      </span>
                    }
                    items={[
                      {
                        id: `remove-${member.username}`,
                        label: "Remove from organization",
                        tone: "danger",
                        onSelect: () => {
                          setRemoveError(null);
                          setRemoving(member.username);
                        },
                      },
                    ]}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog
        open={removing !== null}
        title="Remove member"
        description={
          removing
            ? `This removes ${removing} from the organization and revokes access granted through it.`
            : undefined
        }
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setRemoveError(null);
          }
        }}
        actions={
          <>
            <Button variant="danger" disabled={busy} onClick={() => void confirmRemove()}>
              Remove
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setRemoving(null);
                setRemoveError(null);
              }}
            >
              Cancel
            </Button>
          </>
        }
      >
        {removeError ? (
          <p className="form-error" role="alert">
            {removeError}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}
