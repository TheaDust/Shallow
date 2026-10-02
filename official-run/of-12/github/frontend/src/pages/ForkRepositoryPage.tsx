import { useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { navigate } from "../lib/hash-route";
import { readFormValues } from "../lib/forms";
import { useSession } from "../lib/session";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { forkRepository } from "../features/repositories/repository-api";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface ForkRepositoryPageProps {
  owner: string;
  name: string;
}

const FIELD_IDS = {
  owner: "fork-owner",
  name: "fork-name",
};

/**
 * Fork form reached from the "Fork" button of a source repository overview
 * (REQ-3-2-2).
 *
 * It defaults to the signed-in account's personal namespace and the source
 * visibility, so a fork can be created after editing only the name. The server
 * re-checks the read permission on the source, the creation permission in the
 * target namespace and the name, so a rejected fork leaves no repository
 * behind. A private source can only be forked as a private repository.
 */
export function ForkRepositoryPage({ owner, name }: ForkRepositoryPageProps) {
  const { state, repository: source } = useRepositoryOverview(owner, name);
  const { user, loading } = useSession();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!source || state !== "ready") return <RepositoryLoadState state={state} />;

  const privateSource = source.visibility === "private";
  const owners = user
    ? [
        { value: user.username, label: user.username },
        ...user.organizations
          .filter((organization) => organization.role === "Owner")
          .map((organization) => ({ value: organization.name, label: organization.name })),
      ]
    : [];

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readFormValues(form, ["owner", "name", "visibility"]);
    setErrors({});
    setMessage(null);
    setSubmitting(true);
    const result = await forkRepository(source.owner, source.name, {
      owner: values.owner ?? "",
      name: values.name ?? "",
      visibility: values.visibility === "private" ? "private" : "public",
    });
    setSubmitting(false);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage(result.errors.name || result.errors.owner ? null : result.message);
      return;
    }
    navigate(`/${result.data.owner}/${result.data.name}`);
  };

  return (
    <main className="fork-repository-page">
      <h1>Create a new fork</h1>
      <p className="fork-repository-page__source">
        Forking <a href={`#/${source.owner}/${source.name}`}>{source.name}</a> ({source.fullName}).
      </p>
      {loading ? <p role="status">Loading…</p> : null}
      {!loading && !user ? (
        <p className="fork-repository-page__signed-out">
          You need to sign in to fork this repository. <a href="#/sign-in">Sign in</a>
        </p>
      ) : null}
      {user ? (
        <form className="repository-form" onSubmit={onSubmit} noValidate>
          <FormField id={FIELD_IDS.owner} label="Owner" error={errors.owner}>
            <select id={FIELD_IDS.owner} name="owner" defaultValue={user.username}>
              {owners.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id={FIELD_IDS.name} label="Repository name" error={errors.name}>
            <input
              id={FIELD_IDS.name}
              name="name"
              type="text"
              autoComplete="off"
              defaultValue={source.name}
            />
          </FormField>

          <fieldset className="repository-form__group">
            <legend>Visibility</legend>
            <label className="repository-form__choice">
              <input
                type="radio"
                name="visibility"
                value="public"
                defaultChecked={!privateSource}
                disabled={privateSource}
              />{" "}
              Public
            </label>
            <label className="repository-form__choice">
              <input type="radio" name="visibility" value="private" defaultChecked={privateSource} /> Private
            </label>
          </fieldset>
          {privateSource ? (
            <p className="repository-form__hint">A fork of a private repository is always private.</p>
          ) : null}

          {message ? (
            <p className="repository-form__error" role="alert">
              {message}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={submitting}>
            Create fork
          </Button>
        </form>
      ) : null}
    </main>
  );
}
