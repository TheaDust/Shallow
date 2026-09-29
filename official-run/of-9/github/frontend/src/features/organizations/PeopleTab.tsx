import { useEffect, useState, type FormEvent } from "react";

import { Button, Combobox, Dialog, FormField, Menu } from "../../ui";
import {
  addOrganizationMember,
  listPeople,
  removeOrganizationMember,
  type MemberInfo,
  type MembershipRole,
} from "./api";

interface PeopleTabProps {
  orgId: string;
  isOwner: boolean;
}

export function PeopleTab({ orgId, isOwner }: PeopleTabProps) {
  const [people, setPeople] = useState<MemberInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<MembershipRole>("member");
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [removing, setRemoving] = useState<MemberInfo | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const refresh = async () => {
    setPeople(await listPeople(orgId));
  };

  useEffect(() => {
    let cancelled = false;
    setPeople(null);
    listPeople(orgId)
      .then((list) => {
        if (!cancelled) setPeople(list);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const submitAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (addBusy) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const result = await addOrganizationMember(orgId, { username, role });
      if (result.ok) {
        setUsername("");
        setRole("member");
        setAdding(false);
        await refresh();
      } else {
        setAddError(
          result.errors.general ??
            result.errors.username ??
            result.errors.role ??
            "Unable to add member",
        );
      }
    } finally {
      setAddBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      const result = await removeOrganizationMember(orgId, removing.username);
      if (result.ok) {
        setRemoving(null);
        await refresh();
      } else {
        setRemoveError(
          result.errors.general ??
            result.errors.username ??
            "Unable to remove member",
        );
      }
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <div className="org-people">
      {isOwner ? (
        <Button
          variant="primary"
          onClick={() => setAdding((value) => !value)}
        >
          Add member
        </Button>
      ) : null}
      {isOwner && adding ? (
        <form className="org-people__add" onSubmit={submitAdd} noValidate>
          <FormField
            id={`people-username-${orgId}`}
            label="Username or email"
            error={addError ?? undefined}
          >
            <input
              id={`people-username-${orgId}`}
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </FormField>
          <Combobox
            id={`people-role-${orgId}`}
            label="Role"
            value={role === "owner" ? "Owner" : "Member"}
            onChange={(event) =>
              setRole(event.target.value === "Owner" ? "owner" : "member")
            }
            options={[
              { value: "Member", label: "Member" },
              { value: "Owner", label: "Owner" },
            ]}
          />
          <Button type="submit" variant="primary" disabled={addBusy}>
            Add member
          </Button>
        </form>
      ) : null}
      {!people ? (
        <p role="status" className="page-status">
          Loading…
        </p>
      ) : (
        <ul className="people-list">
          {people.map((member) => (
            <li key={member.username} className="people-list__item">
              <span className="people-list__username">{member.username}</span>
              <span className="people-list__role">
                {member.role === "owner" ? "Owner" : "Member"}
              </span>
              {isOwner ? (
                <Menu
                  triggerLabel={`Member menu ${member.username}`}
                  menuLabel={`Member actions for ${member.username}`}
                  buttonVariant="ghost"
                  items={[
                    {
                      id: `remove-${member.username}`,
                      label: "Remove from organization",
                      tone: "danger",
                      onSelect: () => {
                        setRemoveError(null);
                        setRemoving(member);
                      },
                    },
                  ]}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={removing !== null}
        title="Remove member"
        description={
          removing
            ? `Remove ${removing.username} from the organization?`
            : undefined
        }
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={removeBusy} onClick={() => void confirmRemove()}>
              Remove
            </Button>
          </>
        }
      >
        {removeError ? (
          <p role="alert" className="page-error">
            {removeError}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
