import { useState } from "react";

import { Button } from "../../ui";
import {
  saveRepositoryAccess,
  subjectKey,
  type AccessGrant,
  type RepositoryAccessDetail,
} from "./access-api";

export interface AccessGrantTableProps {
  owner: string;
  name: string;
  grants: readonly AccessGrant[];
  roles: readonly string[];
  canManage: boolean;
  onDetailChange(detail: RepositoryAccessDetail): void;
}

/**
 * Authorization list of the Manage-access page (REQ-2-3).
 *
 * Every subject appears in exactly one row whose accessible name contains the
 * subject name. The row carries the native "Role" select and the "Save"
 * button; saving replaces the stored role instead of adding a second record.
 */
export function AccessGrantTable({
  owner,
  name,
  grants,
  roles,
  canManage,
  onDetailChange,
}: AccessGrantTableProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const save = async (grant: AccessGrant) => {
    const key = subjectKey(grant);
    setBusy(key);
    setError("");
    const result = await saveRepositoryAccess(owner, name, {
      subjectType: grant.subjectType,
      subject: grant.name,
      role: drafts[key] ?? grant.role,
    });
    setBusy(null);
    if (!result.ok) {
      setError(Object.values(result.errors)[0] ?? result.message);
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    onDetailChange(result.data);
  };

  if (grants.length === 0) {
    return <p className="access-grants__empty">No one has direct access to this repository yet.</p>;
  }

  return (
    <div className="access-grants">
      {error ? <p className="access-grants__error" role="alert">{error}</p> : null}
      <table className="access-grants__table">
        <thead>
          <tr>
            <th scope="col">Subject</th>
            <th scope="col">Type</th>
            <th scope="col">Role</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {grants.map((grant) => {
            const key = subjectKey(grant);
            return (
              <tr key={key} className="access-grants__row">
                <td className="access-grants__subject">{grant.name}</td>
                <td className="access-grants__type">
                  {grant.subjectType === "team" ? "Team" : "Member"}
                </td>
                <td className="access-grants__role">
                  <select
                    aria-label="Role"
                    value={drafts[key] ?? grant.role}
                    disabled={!canManage || busy === key}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDrafts((current) => ({ ...current, [key]: value }));
                    }}
                  >
                    {roles.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </td>
                <td className="access-grants__actions">
                  {canManage ? (
                    <Button disabled={busy === key} onClick={() => void save(grant)}>Save</Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
