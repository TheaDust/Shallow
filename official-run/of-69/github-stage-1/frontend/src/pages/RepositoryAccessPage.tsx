import { useEffect, useState, type FormEvent } from "react";

import { RepositoryLayout } from "../components/RepositoryLayout";
import type { AccessGrant, RepositoryRole, TeamOption } from "../lib/organization-api";
import {
  REPOSITORY_ROLE_LABELS,
  REPOSITORY_ROLES,
  addRepositoryTeamGrant,
  fetchRepositoryAccess,
  updateRepositoryGrant,
} from "../lib/organization-api";
import { apiErrorMessage, useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";
import { Button, Combobox, Dialog, FormField } from "../ui";

const ROLE_OPTIONS = REPOSITORY_ROLES.map((role) => ({ value: role, label: REPOSITORY_ROLE_LABELS[role] }));

/**
 * Repository “Manage access”. A repository Admin can grant a team a role and
 * change the role of an existing access row. Saving edits the existing grant
 * record instead of creating another one.
 */
export function RepositoryAccessPage({ organization, repository }: { organization: string; repository: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchRepositoryAccess(organization, repository), [organization, repository]);
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [rowRoles, setRowRoles] = useState<Record<string, RepositoryRole>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [newRole, setNewRole] = useState<RepositoryRole>("write");
  const [pageError, setPageError] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    setGrants(detail.data.grants);
    setTeams(detail.data.teams);
    setRowRoles(Object.fromEntries(detail.data.grants.map((grant) => [grant.id, grant.role])));
  }, [detail.data]);

  function applyResponse(response: { grants: AccessGrant[]; teams: TeamOption[] }) {
    setGrants(response.grants);
    setTeams(response.teams);
    setRowRoles(Object.fromEntries(response.grants.map((grant) => [grant.id, grant.role])));
  }

  const matchingTeams = teams.filter((team) => team.name.toLowerCase().includes(query.trim().toLowerCase()));

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPickerError(null);
    if (!selectedTeam) {
      setPickerError("Select a team to add");
      return;
    }
    setBusy(true);
    try {
      applyResponse(await addRepositoryTeamGrant(organization, repository, selectedTeam, newRole));
      setPickerOpen(false);
      setQuery("");
      setSelectedTeam("");
      setNewRole("write");
    } catch (caught) {
      setPickerError(apiErrorMessage(caught, "Unable to add the team."));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(grant: AccessGrant) {
    setPageError(null);
    setBusy(true);
    try {
      applyResponse(await updateRepositoryGrant(organization, repository, grant.id, rowRoles[grant.id] ?? grant.role));
    } catch (caught) {
      setPageError(apiErrorMessage(caught, "Unable to save the role."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RepositoryLayout
      organizationName={organization}
      repositoryName={repository}
      organizationDisplayName={detail.data?.organization.displayName}
      activeSection="access"
      canManage={detail.data?.canManage ?? false}
      account={account}
      heading="Manage access"
    >
      {detail.loading ? <p role="status">Loading access…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {/* While the picker is open it is the only interactive surface, so its
          “Add” button and “Role” combobox are unambiguous. */}
      {detail.data && !pickerOpen ? (
        <>
          <p className="page-hint">
            <Button variant="primary" onClick={() => setPickerOpen(true)}>
              Add people or teams
            </Button>
          </p>
          {pageError ? (
            <p className="form-error" role="alert">
              {pageError}
            </p>
          ) : null}
          <table className="access-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Change role</th>
                <th scope="col">Save</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id}>
                  <td>{grant.name}</td>
                  <td>{REPOSITORY_ROLE_LABELS[grant.role]}</td>
                  <td>
                    <Combobox
                      label="Role"
                      value={rowRoles[grant.id] ?? grant.role}
                      options={ROLE_OPTIONS}
                      onChange={(event) =>
                        setRowRoles((current) => ({
                          ...current,
                          [grant.id]: event.target.value as RepositoryRole,
                        }))
                      }
                    />
                  </td>
                  <td>
                    <Button onClick={() => handleSave(grant)} disabled={busy}>
                      Save
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {pickerOpen ? (
        <Dialog
          open
          title="Add people or teams"
          onOpenChange={(open) => {
            setPickerOpen(open);
            if (!open) setPickerError(null);
          }}
        >
          <form className="auth-form" noValidate onSubmit={handleAdd}>
            <FormField id="access-search" label="Search" error={pickerError ?? undefined}>
              <input
                id="access-search"
                name="search"
                type="text"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </FormField>
            <fieldset className="access-picker">
              <legend>Team</legend>
              {matchingTeams.length > 0 ? (
                matchingTeams.map((team) => (
                  <label key={team.name} className="access-picker__option">
                    <input
                      type="radio"
                      name="repository-team"
                      value={team.name}
                      checked={selectedTeam === team.name}
                      onChange={() => setSelectedTeam(team.name)}
                    />
                    {team.name}
                  </label>
                ))
              ) : (
                <p>No teams match your search.</p>
              )}
            </fieldset>
            <Combobox
              label="Role"
              value={newRole}
              options={ROLE_OPTIONS}
              onChange={(event) => setNewRole(event.target.value as RepositoryRole)}
            />
            <Button type="submit" variant="primary" disabled={busy}>
              Add
            </Button>
          </form>
        </Dialog>
      ) : null}
    </RepositoryLayout>
  );
}
