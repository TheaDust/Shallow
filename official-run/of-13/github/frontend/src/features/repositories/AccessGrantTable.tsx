import { useEffect, useState } from "react";

import {
  REPOSITORY_ROLE_OPTIONS,
  type AccessGrant,
} from "../../lib/repository-access-api";
import { Button, Combobox } from "../../ui";

export interface AccessGrantTableProps {
  grants: AccessGrant[];
  savingId: string | null;
  onSave(grant: AccessGrant, role: string): void;
}

/**
 * The stored authorization list: one row per subject with a native Role select
 * and a Save button. Selecting another role replaces the stored one.
 */
export function AccessGrantTable({ grants, savingId, onSave }: AccessGrantTableProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // A fresh server list is authoritative: pending edits are dropped so the
  // control always shows the stored role.
  useEffect(() => {
    setDrafts({});
  }, [grants]);

  if (grants.length === 0) {
    return (
      <p className="repository-access__empty" role="status">
        No access granted yet.
      </p>
    );
  }

  return (
    <table className="repository-access__table">
      <thead>
        <tr>
          <th scope="col">Subject</th>
          <th scope="col">Role</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {grants.map((grant) => {
          const value = drafts[grant.id] ?? grant.role;
          return (
            <tr key={grant.id} aria-label={grant.subjectName}>
              <td>{grant.subjectName}</td>
              <td>
                <Combobox
                  id={`grant-role-${grant.id}`}
                  label="Role"
                  options={REPOSITORY_ROLE_OPTIONS}
                  value={value}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [grant.id]: event.target.value }))
                  }
                />
              </td>
              <td>
                <Button
                  disabled={savingId !== null}
                  onClick={() => onSave(grant, value)}
                >
                  Save
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
