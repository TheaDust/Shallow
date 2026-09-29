import { useEffect, useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import { Button, FormField } from "../../ui";
import {
  createTeam,
  getOrganization,
  listTeams,
  type FieldErrors,
  type OrganizationOverview,
  type TeamInfo,
} from "./api";

export function NewTeamPage({ orgId }: { orgId: string }) {
  const [overview, setOverview] = useState<OrganizationOverview | null>(null);
  const [teams, setTeams] = useState<TeamInfo[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOrganization(orgId)
      .then((organization) => {
        if (cancelled) return;
        setOverview(organization);
        if (organization.myRole !== "owner") setDenied(true);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    listTeams(orgId)
      .then((list) => {
        if (!cancelled) setTeams(list);
      })
      .catch(() => {
        if (!cancelled) setTeams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      const result = await createTeam(orgId, {
        name,
        description,
        parentId: parentId === "" ? null : parentId,
      });
      if (result.ok) {
        navigate(`/orgs/${orgId}/teams/${result.team.name}`);
      } else {
        setErrors(result.errors);
      }
    } finally {
      setBusy(false);
    }
  };

  if (denied) {
    return (
      <section className="org-form-page">
        <h1>New team</h1>
        <p role="alert" className="page-error">
          Access denied
        </p>
      </section>
    );
  }
  if (!overview || !teams) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  return (
    <section className="org-form-page">
      <h1>New team</h1>
      <p className="org-form-page__context">{overview.displayName} ({orgId})</p>
      <form className="org-form" onSubmit={submit} noValidate>
        <FormField id="team-name" label="Team name" error={errors.name}>
          <input
            id="team-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="team-description" label="Description">
          <input
            id="team-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <FormField id="team-parent" label="Parent team" error={errors.parentId}>
          <select
            id="team-parent"
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">No parent</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </FormField>
        <Button type="submit" variant="primary" disabled={busy}>
          Create team
        </Button>
      </form>
    </section>
  );
}
