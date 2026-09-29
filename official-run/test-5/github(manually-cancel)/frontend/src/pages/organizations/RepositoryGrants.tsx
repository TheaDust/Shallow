import { useEffect, useState, type ChangeEvent } from "react";

import { saveRepositoryGrant } from "../../org/org-api";
import { REPOSITORY_ROLE_OPTIONS, repositoryRoleLabel } from "../../org/repository-access";
import type { RepositoryGrant, RepositoryRole } from "../../org/types";
import { Button } from "../../ui/Button";

interface GrantRowProps {
  ownerName: string;
  repositoryName: string;
  grant: RepositoryGrant;
  canManage: boolean;
  onSaved(): void;
}

/** One stored grant: the subject name, a native select labeled “Role” and “Save”. */
function GrantRow({ ownerName, repositoryName, grant, canManage, onSaved }: GrantRowProps) {
  const [role, setRole] = useState<RepositoryRole>(grant.role);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRole(grant.role);
  }, [grant.id, grant.role]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveRepositoryGrant(ownerName, repositoryName, {
        subjectType: grant.subjectType,
        subjectId: grant.subjectId,
        role,
      });
      if (result.ok) {
        onSaved();
        return;
      }
      setError(result.errors.role ?? result.errors.subject ?? "Unable to save the role.");
      setRole(grant.role);
    } catch {
      setError("Unable to save the role. Please try again.");
      setRole(grant.role);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>{grant.subjectName}</td>
      <td>
        {canManage ? (
          <select
            aria-label="Role"
            value={role}
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setRole(event.target.value as RepositoryRole)
            }
          >
            {REPOSITORY_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          repositoryRoleLabel(grant.role)
        )}
      </td>
      <td>
        {canManage ? (
          <>
            <Button disabled={busy} onClick={() => void save()}>
              Save
            </Button>
            {error ? (
              <p className="auth-form__error" role="alert">
                {error}
              </p>
            ) : null}
          </>
        ) : null}
      </td>
    </tr>
  );
}

export interface RepositoryGrantsProps {
  ownerName: string;
  repositoryName: string;
  grants: readonly RepositoryGrant[];
  canManage: boolean;
  onSaved(): void;
}

/**
 * REQ-2-3: the authorization list. Every row is one stored grant for this
 * repository; only one direct record per subject exists, and saving a different
 * role replaces the stored role.
 */
export function RepositoryGrants({
  ownerName,
  repositoryName,
  grants,
  canManage,
  onSaved,
}: RepositoryGrantsProps) {
  if (grants.length === 0) {
    return <p className="manage-access__empty">No one has direct access to this repository.</p>;
  }
  return (
    <table className="data-table manage-access__grants">
      <thead>
        <tr>
          <th scope="col">Subject</th>
          <th scope="col">Role</th>
          {canManage ? <th scope="col">Actions</th> : null}
        </tr>
      </thead>
      <tbody>
        {grants.map((grant) => (
          <GrantRow
            key={grant.id}
            ownerName={ownerName}
            repositoryName={repositoryName}
            grant={grant}
            canManage={canManage}
            onSaved={onSaved}
          />
        ))}
      </tbody>
    </table>
  );
}
