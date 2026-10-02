import { useEffect, useState, type FormEvent } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { useSession } from "../auth/SessionContext";
import { navigate } from "../lib/hash-route";
import { ApiError } from "../lib/api";
import {
  fetchOwnerNamespaces,
  fetchRepositoryView,
  forkRepository,
} from "../repositories/api";
import { repositoryPath } from "../repositories/routes";
import type { RepositoryNamespace, RepositoryOwnerKind, RepositoryView } from "../repositories/types";
import type { RepositoryVisibility } from "../organizations/types";
import { Button, FormField, fieldDescriptionIds } from "../ui";

export interface ForkRepositoryPageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
}

interface ForkFormErrors {
  name?: string;
  owner?: string;
}

const FALLBACK_ERROR = "We could not create the fork. Try again.";

function namespaceValue(namespace: RepositoryNamespace): string {
  return `${namespace.kind}:${namespace.id}`;
}

function namespaceOf(namespaces: readonly RepositoryNamespace[], value: string): RepositoryNamespace | null {
  return namespaces.find((namespace) => namespaceValue(namespace) === value) ?? null;
}

/**
 * Fork form of one source repository. It defaults to the personal namespace of
 * the signed-in account, the source name and an allowed visibility, so the name
 * is the only value that has to be edited. The server checks Read access on the
 * source and creation permission in the target namespace and stores the new
 * fork with its source-repository link; a rejected submission stays on the form
 * and creates nothing.
 */
export function ForkRepositoryPage({ ownerKind, owner, name }: ForkRepositoryPageProps) {
  const { account } = useSession();
  const [source, setSource] = useState<RepositoryView | null>(null);
  const [sourceFailure, setSourceFailure] = useState<"notFound" | "denied" | "failed" | null>(null);
  const [namespaces, setNamespaces] = useState<RepositoryNamespace[] | null>(null);
  const [ownerValue, setOwnerValue] = useState("");
  const [forkName, setForkName] = useState(name);
  const [visibility, setVisibility] = useState<RepositoryVisibility>("public");
  const [errors, setErrors] = useState<ForkFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setSourceFailure(null);
    fetchRepositoryView(ownerKind, owner, name)
      .then((next) => {
        if (cancelled) return;
        setSource(next);
        setForkName(next.name);
        setVisibility(next.visibility);
      })
      .catch((failure) => {
        if (cancelled) return;
        if (failure instanceof ApiError && failure.status === 403) setSourceFailure("denied");
        else if (failure instanceof ApiError && failure.status === 404) setSourceFailure("notFound");
        else setSourceFailure("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerKind, owner, name]);

  useEffect(() => {
    let cancelled = false;
    if (!account) return () => { cancelled = true; };
    fetchOwnerNamespaces(account.username)
      .then((next) => {
        if (cancelled) return;
        setNamespaces(next);
        setOwnerValue((current) => (current.length > 0 ? current : namespaceValue(next[0])));
      })
      .catch(() => {
        if (cancelled) return;
        const fallback: RepositoryNamespace[] = [{ kind: "account", id: account.username, label: account.username }];
        setNamespaces(fallback);
        setOwnerValue((current) => (current.length > 0 ? current : namespaceValue(fallback[0])));
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  const privateSource = source?.visibility === "private";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const target = namespaceOf(namespaces ?? [], ownerValue);
    if (!target) {
      setErrors({ owner: "Select an owner namespace" });
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const fork = await forkRepository(ownerKind, owner, name, {
        ownerKind: target.kind,
        owner: target.id,
        name: forkName,
        // A private source always produces a private fork.
        visibility: privateSource ? "private" : visibility,
      });
      navigate(repositoryPath(target.kind, target.id, fork.name));
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      if (fieldErrors) setErrors({ name: fieldErrors.name, owner: fieldErrors.owner });
      else setFormError(errorMessageOf(failure) ?? FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (sourceFailure === "notFound") {
    return (
      <section className="page page--narrow">
        <h1>Repository not found</h1>
        <p className="page__lead">The address does not match a repository visible to you.</p>
      </section>
    );
  }

  if (sourceFailure === "denied") {
    return (
      <section className="page page--narrow">
        <h1>Access denied</h1>
        <p className="page__lead">Your account cannot read this private repository.</p>
      </section>
    );
  }

  if (sourceFailure === "failed") {
    return (
      <section className="page page--narrow">
        <p role="alert">We could not load this repository. Try again.</p>
      </section>
    );
  }

  if (!source) {
    return (
      <section className="page">
        <p role="status">Loading repository…</p>
      </section>
    );
  }

  return (
    <section className="page page--narrow">
      <p className="repository-breadcrumb">
        <a className="repository-breadcrumb__owner" href={sourceLink(ownerKind, owner, name)}>
          {source.owner.name}/{source.name}
        </a>
      </p>
      <h1>Create a new fork</h1>
      <p className="page__lead">
        A fork is an independent copy: the default branch of the source is copied once and later
        changes never write back to the source repository.
      </p>
      <form className="app-form" aria-label="Create a new fork" noValidate onSubmit={handleSubmit}>
        <FormField
          id="fork-owner"
          label="Owner"
          error={errors.owner}
          description="Your personal namespace is selected by default."
        >
          <select
            id="fork-owner"
            name="owner"
            value={ownerValue}
            aria-describedby={fieldDescriptionIds("fork-owner", {
              description: true,
              error: Boolean(errors.owner),
            })}
            onChange={(event) => setOwnerValue(event.target.value)}
          >
            {(namespaces ?? []).map((namespace) => (
              <option key={namespaceValue(namespace)} value={namespaceValue(namespace)}>
                {namespace.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="fork-name" label="Repository name" error={errors.name}>
          <input
            id="fork-name"
            name="name"
            type="text"
            autoComplete="off"
            value={forkName}
            aria-describedby={fieldDescriptionIds("fork-name", { error: Boolean(errors.name) })}
            onChange={(event) => setForkName(event.target.value)}
          />
        </FormField>
        <fieldset className="ui-field">
          <legend>Visibility</legend>
          <div className="app-form__choices">
            <label className="app-form__choice">
              <input
                type="radio"
                name="fork-visibility"
                value="public"
                checked={!privateSource && visibility === "public"}
                disabled={privateSource}
                onChange={() => setVisibility("public")}
              />
              Public
            </label>
            <label className="app-form__choice">
              <input
                type="radio"
                name="fork-visibility"
                value="private"
                checked={privateSource || visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              Private
            </label>
          </div>
          {privateSource ? (
            <p className="ui-field__description">A private source repository always produces a private fork.</p>
          ) : null}
        </fieldset>
        {formError ? (
          <p className="app-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="app-form__actions">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            Create fork
          </Button>
        </div>
      </form>
    </section>
  );
}

function sourceLink(ownerKind: RepositoryOwnerKind, owner: string, name: string): string {
  return `#${repositoryPath(ownerKind, owner, name)}`;
}
