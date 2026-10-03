import { useEffect, useState, type FormEvent } from "react";

import { fieldErrorsOf, messageOf, type Account, type FieldErrors } from "../../api/auth";
import {
  fetchRepository,
  forkRepository,
  type RepositoryVisibility,
} from "../../api/organizations";
import { RepositoryOwnerField, RepositoryVisibilityField } from "../../components/RepositoryForm";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash, navigate } from "../../lib/hash-route";
import { useAsyncData } from "../../lib/useAsyncData";
import { Button, FormField } from "../../ui";

/**
 * The fork form of a source repository, reached from the source overview’s
 * “Fork” button.
 *
 * It defaults to the signed-in user’s personal namespace, the source name and
 * an allowed visibility, so only the name has to be edited to submit. A private
 * source keeps the Private choice fixed, and the server validates both the read
 * permission on the source and the creation permission in the target namespace.
 */
export function ForkRepositoryPage({
  account,
  ownerLogin,
  repositoryName,
}: {
  account: Account;
  ownerLogin: string;
  repositoryName: string;
}) {
  const { data, error, loading } = useAsyncData(
    () => fetchRepository(ownerLogin, repositoryName),
    [ownerLogin, repositoryName],
  );
  const source = data?.repository ?? null;

  const [owner, setOwner] = useState(account.username);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<RepositoryVisibility | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The source decides the defaults; they are only applied once, so a value the
  // user already typed is never overwritten by a reload.
  useEffect(() => {
    if (!source) return;
    setName((current) => current || source.name);
    setVisibility((current) => current ?? source.visibility);
  }, [source]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await forkRepository(ownerLogin, repositoryName, {
        owner,
        name,
        visibility: visibility ?? source?.visibility ?? "public",
      });
      navigate(`/repositories/${result.repository.owner?.login ?? owner}/${result.repository.name}`);
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(failure, "Fork failed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <main>
      <SiteHeader account={account} />
      <h1>Create a new fork</h1>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {source && !error ? (
        <>
          <p className="fork-source">
            Fork of{" "}
            <a href={makeHash(`/repositories/${ownerLogin}/${repositoryName}`)}>{source.name}</a>
          </p>
          <form
            className="account-form"
            aria-label="Create a new fork"
            noValidate
            onSubmit={(event) => void submit(event)}
          >
            <RepositoryOwnerField account={account} value={owner} onChange={setOwner} />
            {errors.owner ? (
              <p className="form-error" role="alert">
                {errors.owner}
              </p>
            ) : null}
            <FormField id="fork-repository-name" label="Repository name" error={errors.name}>
              <input
                id="fork-repository-name"
                name="repositoryName"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <RepositoryVisibilityField
              value={visibility ?? source.visibility}
              privateOnly={source.visibility === "private"}
              onChange={setVisibility}
            />
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <Button type="submit" variant="primary" disabled={pending}>
              Create fork
            </Button>
          </form>
        </>
      ) : null}
    </main>
  );
}
