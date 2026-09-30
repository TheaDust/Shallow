import { useCallback, useEffect, useState } from "react";

import { readErrorFields } from "../lib/api";
import {
  addOrganizationMember,
  fetchOrganizationMembers,
  removeOrganizationMember,
  type OrganizationMember,
  type OrganizationSummary,
  type OrganizationViewer,
} from "../lib/organizations-api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { ListboxCombobox } from "../ui/ListboxCombobox";
import { Menu } from "../ui/Menu";

type LoadState = "loading" | "ready" | "forbidden" | "error";

interface AddMemberFormProps {
  login: string;
  onAdded(): void;
  onCancel(): void;
}

/**
 * Direct member addition (REQ-2-2-3): the Owner enters the username or verified
 * email of an existing account and confirms, with no invitation or Pending step.
 * The opening button is hidden while this form is shown, so the submission
 * button is the only action named "Add member".
 */
function AddMemberForm({ login, onAdded, onCancel }: AddMemberFormProps) {
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState("member");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="organization-add-member"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setErrors({});
        try {
          await addOrganizationMember(login, { identifier, role: role === "owner" ? "owner" : "member" });
          onAdded();
        } catch (error) {
          // A failed submission keeps the form and the typed identifier so the
          // Owner can correct it and submit again.
          setErrors(readErrorFields(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormField id="organization-member-identifier" label="Username or email" error={errors.identifier}>
        <input
          id="organization-member-identifier"
          type="text"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />
      </FormField>
      <FormField id="organization-member-role" label="Role" error={errors.role}>
        <ListboxCombobox
          id="organization-member-role"
          label="Role"
          value={role}
          onChange={setRole}
          options={[
            { value: "member", label: "Member" },
            { value: "owner", label: "Owner" },
          ]}
        />
      </FormField>
      <div className="organization-add-member__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Add member
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export interface OrganizationPeoplePanelProps {
  organization: OrganizationSummary;
}

/**
 * "People" tab of the organization overview (REQ-2-1-1, REQ-2-2-3, REQ-2-2-4):
 * the member list with the Member/Owner role, the Owner's member actions and the
 * removal confirmation. Only an Owner sees a member menu, and the server refuses
 * every removal a non-Owner or the last-Owner rule forbids.
 */
export function OrganizationPeoplePanel({ organization }: OrganizationPeoplePanelProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [viewer, setViewer] = useState<OrganizationViewer | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OrganizationMember | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState("loading");
    fetchOrganizationMembers(organization.login)
      .then(
        (payload) => {
          if (!active) return;
          setViewer(payload.viewer);
          setMembers(payload.members);
          setState("ready");
        },
        (error: unknown) => {
          if (!active) return;
          setState((error as { status?: number }).status === 403 ? "forbidden" : "error");
        },
      );
    return () => {
      active = false;
    };
  }, [organization.login, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  if (state === "loading") {
    return (
      <section aria-labelledby="organization-people-heading">
        <h2 id="organization-people-heading">People</h2>
        <p role="status">Loading members…</p>
      </section>
    );
  }

  if (state === "forbidden") {
    return (
      <section aria-labelledby="organization-people-heading">
        <h2 id="organization-people-heading">People</h2>
        <p role="alert">You must be an organization member to view its people.</p>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section aria-labelledby="organization-people-heading">
        <h2 id="organization-people-heading">People</h2>
        <p role="alert">The member list could not be loaded. Reload the page to try again.</p>
      </section>
    );
  }

  const isOwner = viewer?.isOwner === true;
  const ownerCount = members.filter((member) => member.role === "owner").length;
  // An Owner whose removal would leave the organization without any Owner is not
  // removable, so the row exposes no member menu at all.
  const isRemovable = (member: OrganizationMember) =>
    !(member.role === "owner" && ownerCount <= 1);

  const confirmRemoval = async () => {
    if (!removing) return;
    setRemovalError(null);
    try {
      await removeOrganizationMember(organization.login, removing.username);
      setRemoving(null);
      setStatus("Member removed.");
      reload();
    } catch (error) {
      setRemovalError(
        error instanceof Error && error.message ? error.message : "The member could not be removed.",
      );
    }
  };

  return (
    <section aria-labelledby="organization-people-heading">
      <h2 id="organization-people-heading">People</h2>
      {status ? <p role="status">{status}</p> : null}
      {isOwner && !adding ? (
        <p>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add member
          </Button>
        </p>
      ) : null}
      {isOwner && adding ? (
        <AddMemberForm
          login={organization.login}
          onAdded={() => {
            setAdding(false);
            setStatus("Member added.");
            reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      <ul className="organization-members">
        {members.map((member) => (
          <li key={member.accountId} className="organization-members__item">
            <article className="organization-member">
              <span className="organization-member__username">{member.username}</span>
              <span className="organization-member__role">
                {member.role === "owner" ? "Owner" : "Member"}
              </span>
              {isOwner && isRemovable(member) ? (
                <Menu
                  triggerLabel="Member menu"
                  triggerAriaLabel={`Member menu ${member.username}`}
                  triggerContent={<span aria-hidden="true">⋮</span>}
                  items={[
                    {
                      id: "remove",
                      label: "Remove from organization",
                      tone: "danger",
                      onSelect: () => {
                        setRemovalError(null);
                        setRemoving(member);
                      },
                    },
                  ]}
                />
              ) : null}
            </article>
          </li>
        ))}
      </ul>
      {removing ? (
        <Dialog
          open
          title="Remove member"
          description="Removing a member deletes the organization membership, the team memberships of that account in this organization and its direct grants on repositories of this organization. The account itself and its personal repositories stay."
          closeLabel="Close"
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          actions={
            <>
              <Button variant="danger" onClick={confirmRemoval}>
                Remove
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
            </>
          }
        >
          {removalError ? <p role="alert">{removalError}</p> : null}
          <p>Remove {removing.username} from {organization.name}?</p>
        </Dialog>
      ) : null}
    </section>
  );
}
