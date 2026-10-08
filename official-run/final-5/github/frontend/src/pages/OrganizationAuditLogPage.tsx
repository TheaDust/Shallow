import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { formatTimestamp } from "../lib/format";
import { replace } from "../lib/hash-route";
import { fetchOrganizationAuditLog, type OrganizationAuditEvent } from "../lib/org-api";
import { useAsyncData } from "../lib/use-async";
import { Combobox, type ComboboxOption } from "../ui/Combobox";

const ALL_ACTIONS = "All actions";

/**
 * Organization Audit log (REQ-2-4). A semantic table lists the persisted
 * organization actions an Owner may read. The "Filter action" combobox narrows
 * the visible rows only; the selected action lives in the hash search string so
 * a reload restores the same filtered list and clearing it shows every event.
 */
export function OrganizationAuditLogPage({
  organizationId,
  filter,
}: {
  organizationId: string;
  filter: string;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchOrganizationAuditLog(organizationId),
    [organizationId],
  );

  if (status === "error" && error) {
    return (
      <main className="page">
        <section className="page__body organization">
          <ErrorHeading error={error} />
        </section>
      </main>
    );
  }

  const events: OrganizationAuditEvent[] = data?.events ?? [];
  const actions = [...new Set(events.map((event) => event.action))].sort();
  const options: ComboboxOption[] = [
    { value: "", label: ALL_ACTIONS },
    ...actions.map((action) => ({ value: action, label: action })),
  ];
  // The selected action always stays selectable, even before its events load.
  if (filter && !actions.includes(filter)) options.push({ value: filter, label: filter });

  const visible = filter ? events.filter((event) => event.action === filter) : events;

  const choose = (value: string) => {
    const trimmed = value.trim();
    replace(
      `/orgs/${encodeURIComponent(organizationId)}/audit-log`,
      trimmed ? new URLSearchParams({ action: trimmed }) : undefined,
    );
  };

  return (
    <main className="page">
      <section className="page__body organization">
        <h1 className="organization__title">Audit log</h1>
        <div className="audit-log__filter">
          <Combobox
            id="audit-log-filter"
            label="Filter action"
            options={options}
            value={filter}
            disabled={status === "loading"}
            onChange={(event) => choose(event.target.value)}
          />
        </div>
        {status === "loading" ? <LoadingNote label="Loading audit log…" /> : null}
        {status === "ready" ? (
          <table className="access-table audit-log__table">
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
                  <td>{formatTimestamp(event.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </main>
  );
}
