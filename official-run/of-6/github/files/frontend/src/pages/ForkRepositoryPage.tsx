import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiForkRepository, apiOrganizations, apiRepository } from '../api';
import { navigate, useRedirectTo } from '../router';
import { useSession } from '../session';
import type { ForkRepositoryErrors, RepositoryOverview } from '../types';

interface ForkRepositoryPageProps {
  owner: string;
  name: string;
}

interface OwnerOption {
  name: string;
  type: 'user' | 'organization';
}

/**
 * REQ-3-2-2 fork form, opened from the "Fork" button on a readable source
 * repository overview. The form defaults to the signed-in user's personal
 * namespace and an allowed visibility, so submitting after editing only the
 * name works. The user can select a personal or organization namespace where
 * they have creation permission, keep or enter a valid new repository name,
 * and choose Public/Private (a private source can only be forked as Private).
 * The server validates access on the source, creation permission in the
 * target namespace, name uniqueness, and visibility; field errors are shown
 * next to the corresponding control and input is retained. On success the new
 * fork overview page is opened.
 */
export default function ForkRepositoryPage({ owner, name }: ForkRepositoryPageProps) {
  const { auth } = useSession();
  const username = auth.status === 'ready' && auth.user ? auth.user.username : null;
  const needsAuth = auth.status !== 'ready' || !auth.user;
  useRedirectTo('#/signin', needsAuth);

  const [source, setSource] = useState<RepositoryOverview | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [targetOwner, setTargetOwner] = useState('');
  const [forkName, setForkName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [errors, setErrors] = useState<ForkRepositoryErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (needsAuth) {
      return;
    }
    let cancelled = false;
    apiRepository(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setSource(result.repository);
        setForkName(result.repository.name);
        setDescription(result.repository.description);
        setVisibility(
          result.repository.visibility === 'private' ? 'private' : 'public'
        );
      } else if (result.status === 403) {
        setDenied(true);
      } else {
        setNotFound(true);
      }
    });
    if (username !== null) {
      apiOrganizations().then((result) => {
        if (cancelled) {
          return;
        }
        const options: OwnerOption[] = [{ name: username, type: 'user' }];
        if (result.ok) {
          for (const organization of result.organizations) {
            if (organization.role === 'owner') {
              options.push({ name: organization.name, type: 'organization' });
            }
          }
        }
        setOwners(options);
        setTargetOwner((previous) =>
          previous !== '' ? previous : options[0]?.name ?? ''
        );
      });
    }
    return () => {
      cancelled = true;
    };
  }, [needsAuth, username, owner, name]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || source === null) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    try {
      const result = await apiForkRepository(owner, name, {
        owner: targetOwner,
        name: forkName,
        description,
        visibility,
      });
      if (result.ok) {
        navigate(
          `#/repositories/${encodeURIComponent(result.repository.owner)}/${encodeURIComponent(
            result.repository.name
          )}`
        );
      } else {
        setErrors(result.errors);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (needsAuth) {
    return null;
  }

  if (denied) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to fork this repository.
        </p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="repository-page">
        <h1>Repository not found</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  if (source === null) {
    return (
      <div className="repository-page">
        <p className="loading">Loading…</p>
      </div>
    );
  }

  return (
    <div className="account-access-page fork-repository-page">
      <h1>Fork repository</h1>
      <p className="muted-text">
        Forking {source.owner}/{source.name}
      </p>
      <form
        className="account-access-form fork-repository-form"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="field">
          <label htmlFor="fork-owner">Owner</label>
          <select
            id="fork-owner"
            value={targetOwner}
            onChange={(e) => setTargetOwner(e.target.value)}
            aria-describedby={errors.owner ? 'fork-owner-error' : undefined}
            aria-invalid={errors.owner ? true : undefined}
          >
            {owners.map((option) => (
              <option key={`${option.type}:${option.name}`} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
          {errors.owner ? (
            <p id="fork-owner-error" className="field-error">
              {errors.owner}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="fork-name">Repository name</label>
          <input
            id="fork-name"
            type="text"
            value={forkName}
            onChange={(e) => setForkName(e.target.value)}
            aria-describedby={errors.name ? 'fork-name-error' : undefined}
            aria-invalid={errors.name ? true : undefined}
          />
          {errors.name ? (
            <p id="fork-name-error" className="field-error">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="fork-description">Description</label>
          <textarea
            id="fork-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <fieldset className="visibility-fieldset">
          <legend>Visibility</legend>
          <label className="radio-option">
            <input
              type="radio"
              name="fork-visibility"
              value="public"
              checked={visibility === 'public'}
              disabled={source.visibility === 'private'}
              onChange={() => setVisibility('public')}
            />
            Public
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="fork-visibility"
              value="private"
              checked={visibility === 'private'}
              onChange={() => setVisibility('private')}
            />
            Private
          </label>
          {errors.visibility ? (
            <p className="field-error">{errors.visibility}</p>
          ) : null}
        </fieldset>

        <button type="submit" className="primary-button" disabled={submitting}>
          Create fork
        </button>
      </form>
    </div>
  );
}
