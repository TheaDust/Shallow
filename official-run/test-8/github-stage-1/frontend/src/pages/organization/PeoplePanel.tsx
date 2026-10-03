import { useState, type FormEvent } from "react";

import {
  ORGANIZATION_ROLE_OPTIONS,
  addOrganizationMember,
  fetchOrganizationPeople,
  removeOrganizationMember,
  type PersonSummary,
} from "../../api/organizations";
import { fieldErrorsOf, messageOf } from "../../api/auth";
import { useAsyncData } from "../../lib/useAsyncData";
import { Button, Combobox, Dialog, FormField, Menu } from "../../ui";

/**
 * The “People” tab: organization members with their Member/Owner role.
 *
 * An Owner gets the “Add member” form (a direct membership write with no
 * invitation step) and, per member row, the “Member menu <username>” entry that
 * removes the membership after a confirmation. A non-Owner only reads the list.
 */
export function PeoplePanel({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useAsyncData(() => fetchOrganizationPeople(slug), [slug]);
  const [adding, setAdding] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState("member");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [removalTarget, setRemovalTarget] = useState<PersonSummary | null>(null);

  const canManage = data?.organization.role === "owner";
  const people = data?.people ?? [];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setFieldError(null);
    setFormError(null);
    try {
      await addOrganizationMember(slug, { username: identifier, role });
      setIdentifier("");
      setRole("member");
      setAdding(false);
      reload();
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      const message = fields.username ?? fields.role;
      if (message) setFieldError(message);
      else setFormError(messageOf(failure, "Unable to add member"));
    } finally {
      setPending(false);
    }
  };

  const confirmRemoval = async () => {
    if (!removalTarget) return;
    setPending(true);
    setFormError(null);
    try {
      await removeOrganizationMember(slug, removalTarget.username);
      setRemovalTarget(null);
      reload();
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      setFormError(fields.username ?? messageOf(failure, "Unable to remove member"));
      setRemovalTarget(null);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="organization-panel">
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}
      {removalTarget ? (
        <Dialog
          open
          title="Remove from organization"
          description={`Removing ${removalTarget.username} also ends their team memberships and direct repository access in this organization.`}
          onOpenChange={(next) => {
            if (!next) setRemovalTarget(null);
          }}
          actions={
            <>
              <Button variant="secondary" onClick={() => setRemovalTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={pending} onClick={() => void confirmRemoval()}>
                Remove
              </Button>
            </>
          }
        >
          <p>{`Remove ${removalTarget.username} from this organization?`}</p>
        </Dialog>
      ) : null}
      {/* The confirmation dialog owns the interaction while it is open, so the
          member list and the add-member form behind it are hidden from
          assistive technology until it closes. */}
      <div className="organization-panel__content" aria-hidden={removalTarget ? "true" : undefined}>
        {canManage ? (
          adding ? (
            <form className="account-form" aria-label="Add member" noValidate onSubmit={(event) => void submit(event)}>
              <FormField id={`add-member-username-${slug}`} label="Username or email" error={fieldError ?? undefined}>
                <input
                  id={`add-member-username-${slug}`}
                  name="username"
                  type="text"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
              </FormField>
              <Combobox
                id={`add-member-role-${slug}`}
                label="Role"
                options={ORGANIZATION_ROLE_OPTIONS}
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
              <Button type="submit" variant="primary" disabled={pending}>
                Add member
              </Button>
            </form>
          ) : (
            <p>
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add member
              </Button>
            </p>
          )
        ) : null}
        {data && !error ? (
          <ul className="people-list">
            {people.map((person) => (
              <li key={person.username} className="people-list__item">
                <span className="people-list__username">{person.username}</span>
                <span className="people-list__role">{person.role}</span>
                {canManage ? (
                  <Menu
                    triggerLabel={`Member menu ${person.username}`}
                    items={[
                      {
                        id: `remove-${person.username}`,
                        label: "Remove from organization",
                        tone: "danger",
                        onSelect: () => setRemovalTarget(person),
                      },
                    ]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
