import { useState, type ChangeEvent, type FormEvent } from "react";

import { createTeam, fetchOrganization, fetchOrganizationTeams, teamPath } from "../../org/org-api";
import type { TeamErrors } from "../../org/types";
import { Button } from "../../ui/Button";
import { Combobox } from "../../ui/Combobox";
import { FormField } from "../../ui/FormField";
import { navigate } from "../../lib/hash-route";
import { useAsyncData } from "../../org/use-async-data";
import { BusyMain, NotFoundPage, PanelMessage } from "../common";

export interface NewTeamPageProps {
  organizationName: string;
}

/**
 * REQ-2-2-1: the “New team” page of an organization. Only an organization Owner
 * reaches this form; the server re-checks the permission on submit.
 */
export function NewTeamPage({ organizationName }: NewTeamPageProps) {
  const organization = useAsyncData(() => fetchOrganization(organizationName), [organizationName]);
  const teams = useAsyncData(() => fetchOrganizationTeams(organizationName), [organizationName]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentTeamId, setParentTeamId] = useState("");
  const [errors, setErrors] = useState<TeamErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await createTeam(organizationName, { name, description, parentTeamId });
      if (result.ok) {
        setErrors({});
        navigate(teamPath(organizationName, result.team.name));
        return;
      }
      setErrors(result.errors);
    } catch {
      setFormError("Unable to create the team. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (organization.status === "loading") return <BusyMain />;
  if (organization.status === "error" || !organization.data) return <NotFoundPage />;

  const options = [
    { value: "", label: "No parent team" },
    ...(teams.data?.teams ?? []).map((team) => ({ value: team.id, label: team.name })),
  ];

  return (
    <main>
      <h1>New team</h1>
      <p>{organization.data.name}</p>
      {teams.status === "error" && teams.error ? (
        <PanelMessage>You need to be an organization Owner to create teams.</PanelMessage>
      ) : null}
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <FormField id="team-name" label="Team name" error={errors.name}>
          <input
            id="team-name"
            name="name"
            type="text"
            value={name}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="team-description" label="Description" error={errors.description}>
          <textarea
            id="team-description"
            name="description"
            rows={3}
            value={description}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDescription(event.target.value)}
          />
        </FormField>
        <Combobox
          id="team-parent"
          label="Parent team"
          options={options}
          value={parentTeamId}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => setParentTeamId(event.target.value)}
        />
        {errors.parentTeamId ? (
          <p className="auth-form__error" role="alert">
            {errors.parentTeamId}
          </p>
        ) : null}
        {formError ? (
          <p className="auth-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={submitting}>
          Create team
        </Button>
      </form>
    </main>
  );
}
