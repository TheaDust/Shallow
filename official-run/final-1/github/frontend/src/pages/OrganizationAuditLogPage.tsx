import { AppHeader } from "../components/AppHeader";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { replace } from "../lib/hash-route";
import { fetchOrganizationAuditLog, type OrganizationAuditEvent } from "../lib/org-api";
import { useAsyncData } from "../lib/use-async";
import { Combobox } from "../ui/Combobox";

/**
 * The selected `Filter action` value as stored in the address. An absent or
 * unknown value means "no filter", so every persisted event stays listed.
 */
export function activeAuditAction(action: string, available: readonly string[]): string {
  return available.includes(action) ? action : "";
}

/** The rows of one filtered view; filtering never changes the stored events. */
export function auditRows(
  events: readonly OrganizationAuditEvent[],
  action: string,
): OrganizationAuditEvent[] {
  return action ? events.filter((event) => event.action === action) : [...events];
}

/**
 * Organization audit log (REQ-2-4): the persisted organization actions as a
 * semantic table. Only an organization Owner may open it, so the entry point
 * lives on the overview and the server rejects everyone else. The selected
 * action stays in the hash search string, so a reload keeps the same rows.
 */
export function OrganizationAuditLogPage({
  organizationId,
  action,
}: {
  organizationId: string;
  action: string;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchOrganizationAuditLog(organizationId),
    [organizationId],
  );

  const events = data?.events ?? [];
  const actions = data?.actions ?? [];
  const selected = activeAuditAction(action, actions);
  const rows = auditRows(events, selected);

  const selectAction = (value: string) => {
    const search = new URLSearchParams();
    if (value) search.set("action", value);
    replace(`/orgs/${encodeURIComponent(organizationId)}/audit-log`, search);
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body audit-log">
        {status === "error" && error ? (
          // An ordinary Member (or anyone else the server rejects) sees the
          // failure instead of the log; the heading only appears with the data.
          <ErrorHeading error={error} />
        ) : (
          <>
            <h1 className="audit-log__title">Audit log</h1>
            {status === "loading" && !data ? <LoadingNote label="Loading audit log…" /> : null}
            {data ? (
              <>
                <Combobox
                  id="audit-log-filter"
                  label="Filter action"
                  options={[
                    { value: "", label: "All actions" },
                    ...actions.map((entry) => ({ value: entry, label: entry })),
                  ]}
                  value={selected}
                  onChange={(event) => selectAction(event.target.value)}
                />
                {rows.length === 0 ? (
                  <p className="audit-log__empty">No organization actions match this filter.</p>
                ) : (
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
                      {rows.map((event) => (
                        <tr key={event.id} className="audit-log__row">
                          <td>{event.actor}</td>
                          <td>{event.action}</td>
                          <td>{event.target}</td>
                          <td>{event.timestamp}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
