import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiCreateRepository, apiOrganizations } from '../api';
import { navigate, useRedirectTo } from '../router';
import { useSession } from '../session';
import type { CreateRepositoryErrors } from '../types';

interface OwnerOption {
  name: string;
  type: 'user' | 'organization';
}

/**
 * REQ-3-2-1 repository-creation page, opened by the "New repository" link in
 * the signed-in workspace. The form labels are "Owner" (a select whose first
 * option is the signed-in user's personal namespace, so submission works
 * without changing it), "Repository name", and "Description"; visibility is a
 * pair of radio controls "Public" and "Private"; initialization is the
 * checkbox "Add a README file"; submission uses the button "Create
 * repository". Organization namespaces are offered only when the signed-in
 * user has organization-Owner permission there. Server-side field errors are
 * shown next to the corresponding control and input is retained; on success
 * the new repository overview page is opened.
 */
export default function CreateRepositoryPage() {
  const { auth } = useSession();
  const username =
    auth.status === 'ready' && auth.user ? auth.user.username : null;
  const needsAuth = auth.status !== 'ready' || !auth.user;
  useRedirectTo('#/signin', needsAuth);

  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [initialize, setInitialize] = useState(false);
  const [errors, setErrors] = useState<CreateRepositoryErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (needsAuth || username === null) {
      return;
    }
    let cancelled = false;
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
      setOwner((previous) => (previous !== '' ? previous : options[0]?.name ?? ''));
    });
    return () => {
      cancelled = true;
    };
  }, [needsAuth, username]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    try {
      const result = await apiCreateRepository({
        owner,
        name,
        description,
        visibility,
        initialize,
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

  return (
    <div className="account-access-page create-repository-page">
      <h1>Create a new repository</h1>
      <form className="account-access-form create-repository-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="repository-owner">Owner</label>
          <select
            id="repository-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            aria-describedby={errors.owner ? 'repository-owner-error' : undefined}
            aria-invalid={errors.owner ? true : undefined}
          >
            {owners.map((option) => (
              <option key={`${option.type}:${option.name}`} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
          {errors.owner ? (
            <p id="repository-owner-error" className="field-error">
              {errors.owner}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="repository-name">Repository name</label>
          <input
            id="repository-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={errors.name ? 'repository-name-error' : undefined}
            aria-invalid={errors.name ? true : undefined}
          />
          {errors.name ? (
            <p id="repository-name-error" className="field-error">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="repository-description">Description</label>
          <textarea
            id="repository-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <fieldset className="visibility-fieldset">
          <legend>Visibility</legend>
          <label className="radio-option">
            <input
              type="radio"
              name="visibility"
              value="public"
              checked={visibility === 'public'}
              onChange={() => setVisibility('public')}
            />
            Public
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="visibility"
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

        <div className="field field-checkbox">
          <input
            id="add-readme"
            type="checkbox"
            checked={initialize}
            onChange={(e) => setInitialize(e.target.checked)}
          />
          <label htmlFor="add-readme">Add a README file</label>
        </div>

        <button type="submit" className="primary-button" disabled={submitting}>
          Create repository
        </button>
      </form>
    </div>
  );
}
