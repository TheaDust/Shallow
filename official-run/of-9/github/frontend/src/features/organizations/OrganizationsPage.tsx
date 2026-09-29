import { useEffect, useState } from "react";

import { listOrganizations, type OrganizationInfo } from "./api";

export function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<OrganizationInfo[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listOrganizations()
      .then((list) => {
        if (!cancelled) setOrganizations(list);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section className="organizations">
        <h1>Your organizations</h1>
        <p role="alert" className="page-error">
          Unable to load organizations.
        </p>
      </section>
    );
  }
  if (!organizations) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  return (
    <section className="organizations">
      <div className="organizations__header">
        <h1>Your organizations</h1>
        <a className="ui-button ui-button--primary organizations__new" href="#/organizations/new">
          New organization
        </a>
      </div>
      {organizations.length === 0 ? (
        <p className="organizations__empty">You are not a member of any organization.</p>
      ) : (
        <ul className="organizations__list">
          {organizations.map((organization) => (
            <li key={organization.id} className="organizations__item">
              <a
                href={`#/orgs/${organization.id}`}
                className="organizations__name"
              >
                {organization.displayName}
              </a>
              <span className="organizations__id">{organization.id}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
