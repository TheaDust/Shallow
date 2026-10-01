import { useState, type FormEvent } from "react";

import { Button, Dialog, FormField, Menu, OptionCombobox } from "../../ui";
import { readFormValues } from "../../lib/forms";
import {
  addOrganizationMember,
  removeOrganizationMember,
  type OrganizationMember,
  type OrganizationRole,
} from "./org-api";

export interface OrganizationPeopleProps {
  /** Organization identifier taken from the address. */
  organization: string;
  members: OrganizationMember[];
  viewerRole: OrganizationRole | null;
  loading: boolean;
  onMembersChange(members: OrganizationMember[]): void;
}

const ROLE_OPTIONS: OrganizationRole[] = ["Member", "Owner"];

/**
 * People tab of the organization overview (REQ-2-2-3 / REQ-2-2-4).
 *
 * An organization Owner adds an existing account through "Add member" (the
 * form carries the "Username or email" field and the "Role" combobox) and
 * removes a member through that member's action menu; both writes are stored
 * server-side and the list is read back from the server response. Members who
 * are not Owners see the same list without any management control.
 */
export function OrganizationPeople({
  organization,
  members,
  viewerRole,
  loading,
  onMembersChange,
}: OrganizationPeopleProps) {
  const canManage = viewerRole === "Owner";
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<string>("Member");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [removingBusy, setRemovingBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = readFormValues(event.currentTarget, ["username"]);
    setErrors({});
    setMessage("");
    setSubmitting(true);
    const result = await addOrganizationMember(organization, {
      username: values.username ?? "",
      role,
    });
    setSubmitting(false);
    if (!result.ok) {
      // The form stays open so the username can be corrected and resubmitted.
      setErrors(result.errors);
      setMessage(Object.keys(result.errors).length > 0 ? "" : result.message);
      return;
    }
    onMembersChange(result.data.members);
    setAdding(false);
    setRole("Member");
  };

  const onConfirmRemove = async () => {
    if (!removing) return;
    setRemovingBusy(true);
    setRemoveError("");
    const result = await removeOrganizationMember(organization, removing);
    setRemovingBusy(false);
    if (!result.ok) {
      setRemoveError(Object.values(result.errors)[0] ?? result.message);
      return;
    }
    onMembersChange(result.data.members);
    setRemoving(null);
  };

  return (
    <section className="org-people" aria-label="People">
      {canManage ? (
        adding ? (
          <form className="org-people__form" onSubmit={onSubmit} noValidate>
            <FormField id="organization-member-username" label="Username or email" error={errors.username}>
              <input
                id="organization-member-username"
                name="username"
                type="text"
                autoComplete="off"
                aria-required="true"
                aria-invalid={errors.username ? true : undefined}
              />
            </FormField>
            <OptionCombobox
              id="organization-member-role"
              label="Role"
              value={role}
              options={ROLE_OPTIONS}
              onChange={setRole}
              error={errors.role}
            />
            {message ? <p className="org-people__error" role="alert">{message}</p> : null}
            <div className="org-people__actions">
              <Button type="submit" variant="primary" disabled={submitting}>Add member</Button>
              <Button
                onClick={() => {
                  setAdding(false);
                  setErrors({});
                  setMessage("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="org-people__actions">
            <Button variant="primary" onClick={() => setAdding(true)}>Add member</Button>
          </p>
        )
      ) : null}

      {loading ? <p role="status">Loading the members…</p> : null}
      {!loading && members.length === 0 ? (
        <p className="org-people__empty">This organization has no members yet.</p>
      ) : null}

      <ul className="org-people__list">
        {members.map((member) => (
          <li
            key={member.username}
            className="org-people__person"
            aria-label={`${member.username} ${member.role}`}
          >
            <span className="org-people__username">{member.username}</span>
            <span className="org-people__role">{member.role}</span>
            {canManage ? (
              <Menu
                triggerLabel={`Member menu ${member.username}`}
                menuLabel={`Member menu ${member.username}`}
                triggerContent="⋯"
                buttonVariant="ghost"
                items={[
                  {
                    id: "remove-from-organization",
                    label: "Remove from organization",
                    tone: "danger",
                    onSelect: () => {
                      setRemoveError("");
                      setRemoving(member.username);
                    },
                  },
                ]}
              />
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog
        open={removing !== null}
        title="Remove member"
        description="The member loses the organization membership, the team memberships in this organization and the direct repository grants of this organization."
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setRemoveError("");
          }
        }}
        actions={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" disabled={removingBusy} onClick={onConfirmRemove}>Remove</Button>
          </>
        }
      >
        {removeError ? <p role="alert">{removeError}</p> : null}
      </Dialog>
    </section>
  );
}
