import { AppHeader } from "../components/AppHeader";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { formatTimestamp } from "../lib/format";
import { replace } from "../lib/hash-route";
import { fetchOrganizationAuditEvents } from "../lib/org-api";
import { organizationHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { Combobox, type ComboboxOption } from "../ui/Combobox";

/**
 * Audit log of one organization (REQ-2-4). The server returns the persisted
 * actions only to an Owner; the page mirrors that refusal instead of hiding it.
 * The selected action filter travels in the address (`?action=`), so a reload
 * restores the same filtered list, and clearing it restores every event.
 */
export function OrganizationAuditLogPage({
  organizationId,
  action,
}: {
  organizationId: string;
  action: string;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchOrganizationAuditEvents(organizationId),
    [organizationId],
  );

  const events = data?.events ?? [];
  const actions = events
    .map((event) => event.action)
    .filter((value, index, all) => all.indexOf(value) === index);
  const selected = actions.includes(action) ? action : "";
  const visible = selected === "" ? events : events.filter((event) => event.action === selected);
  const options: ComboboxOption[] = [
    { value: "", label: "All actions" },
    ...actions.map((value) => ({ value, label: value })),
  ];

  /** The filter only changes the address and this view, never the organization. */
  const applyFilter = (next: string) => {
    const search = new URLSearchParams();
    if (next) search.set("action", next);
    replace(`/orgs/${encodeURIComponent(organizationId)}/audit-log`, search);
  };

  if (status === "error" && error) {
    return (
      <main className="page">
        <AppHeader />
        <section className="page__body organization">
          <ErrorHeading error={error} />
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body organization">
        <nav className="organization__breadcrumb" aria-label="Organization">
          <a href={organizationHash(organizationId)}>
            {data?.organization.displayName ?? organizationId}
          </a>
        </nav>
        <h1 className="organization__title">Audit log</h1>
        <div className="audit-log__filter">
          <Combobox
            id="filter-action"
            label="Filter action"
            value={selected}
            options={options}
            onChange={(event) => applyFilter(event.currentTarget.value)}
          />
        </div>
        {status === "loading" ? <LoadingNote label="Loading audit log…" /> : null}
        {data ? (
          <table className="audit-log__table">
            <thead>
              <tr>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
                <tr key={event.id}>
                  <td>{event.actor}</td>
                  <td>{event.action}</td>
                  <td>{event.target}</td>
                  <td>{formatTimestamp(event.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </main>
  );
}
