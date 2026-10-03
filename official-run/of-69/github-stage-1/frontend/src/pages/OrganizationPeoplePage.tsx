import { useEffect, useState, type FormEvent } from "react";

import { OrganizationLayout } from "../components/OrganizationLayout";
import type { OrganizationMember, OrganizationRole } from "../lib/organization-api";
import { addOrganizationMember, fetchOrganizationMembers, removeOrganizationMember } from "../lib/organization-api";
import { apiErrorMessage, useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";
import { Button, Combobox, Dialog, FormField, Menu } from "../ui";

const MEMBER_ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "owner", label: "Owner" },
];

/**
 * Organization People. An Owner directly adds a registered account as a
 * Member or Owner and removes members through the per-row “Member menu
 * <username>”. Membership is saved immediately — there is no invitation or
 * pending state.
 */
export function OrganizationPeoplePage({ organization }: { organization: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchOrganizationMembers(organization), [organization]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<OrganizationRole>("member");
  const [addError, setAddError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (detail.data) setMembers(detail.data.members);
  }, [detail.data]);

  const canManage = detail.data?.canManage ?? false;

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddError(null);
    setBusy(true);
    try {
      const response = await addOrganizationMember(organization, identifier, role);
      setMembers(response.members);
      setAdding(false);
      setIdentifier("");
      setRole("member");
    } catch (caught) {
      setAddError(apiErrorMessage(caught, "Unable to add the member."));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    setRemoveError(null);
    setBusy(true);
    try {
      const response = await removeOrganizationMember(organization, removeTarget);
      setMembers(response.members);
      setRemoveTarget(null);
    } catch (caught) {
      setRemoveError(apiErrorMessage(caught, "Unable to remove the member."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <OrganizationLayout
      organizationName={organization}
      organization={detail.data?.organization ?? null}
      heading="People"
      activeTab="people"
      account={account}
    >
      {detail.loading ? <p role="status">Loading people…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {canManage ? (
        adding ? (
          <form className="auth-form auth-form--inline" noValidate onSubmit={handleAdd}>
            <FormField id="member-identifier" label="Username or email" error={addError ?? undefined}>
              <input
                id="member-identifier"
                name="identifier"
                type="text"
                autoComplete="off"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </FormField>
            <Combobox
              label="Role"
              value={role}
              options={MEMBER_ROLE_OPTIONS}
              onChange={(event) => setRole(event.target.value as OrganizationRole)}
            />
            <Button type="submit" variant="primary" disabled={busy}>
              Add member
            </Button>
          </form>
        ) : (
          <p className="page-hint">
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add member
            </Button>
          </p>
        )
      ) : null}
      {detail.data ? (
        members.length > 0 ? (
          <ul className="member-list">
            {members.map((member) => (
              <li key={member.username} className="member-list__item">
                <span className="member-list__username">{member.username}</span>
                <span className="member-list__role">{member.role === "owner" ? "Owner" : "Member"}</span>
                {canManage ? (
                  <Menu
                    triggerLabel="⋯"
                    triggerAriaLabel={`Member menu ${member.username}`}
                    menuLabel={`Member menu ${member.username}`}
                    items={[
                      {
                        id: "remove",
                        label: "Remove from organization",
                        tone: "danger",
                        onSelect: () => {
                          setRemoveError(null);
                          setRemoveTarget(member.username);
                        },
                      },
                    ]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>This organization has no members.</p>
        )
      ) : null}
      <Dialog
        open={removeTarget !== null}
        title="Remove member"
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        description={removeTarget ? `Remove ${removeTarget} from this organization?` : undefined}
        actions={
          <>
            <Button onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleRemove} disabled={busy}>
              Remove
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
    </OrganizationLayout>
  );
}
