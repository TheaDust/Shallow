import { AppHeader } from "../components/AppHeader";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { formatTimestamp } from "../lib/format";
import { fetchOrganizationAuditLog } from "../lib/org-api";
import { replace } from "../lib/hash-route";
import { useAsyncData } from "../lib/use-async";
import { Combobox } from "../ui/Combobox";

/** The value that clears the filter and restores every persisted event. */
const ALL_ACTIONS = "";

/**
 * Organization audit log (REQ-2-4): the persisted organization actions of one
 * organization as a semantic table. Only its Owner may read it — the server
 * applies the same rule — and the "Filter action" combobox only narrows the
 * displayed rows, so it never changes the organization state. The selected
 * action travels in the hash, so a reload restores the same filtered list.
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
  const actions = [...new Set(events.map((event) => event.action))];
  const selected = action.trim();
  // A selected action that no stored event carries stays selectable, so the
  // combobox always shows the filter the address names.
  const selectable = selected && !actions.includes(selected) ? [selected, ...actions] : actions;
  const options = [
    { value: ALL_ACTIONS, label: "All actions" },
    ...[...selectable].sort().map((value) => ({ value, label: value })),
  ];
  const visible = selected ? events.filter((event) => event.action === selected) : events;

  const changeAction = (value: string) => {
    const params = new URLSearchParams();
    if (value) params.set("action", value);
    replace(`/orgs/${encodeURIComponent(organizationId)}/audit-log`, params);
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body audit-log">
        <h1 className="audit-log__title">Audit log</h1>
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {status === "loading" ? <LoadingNote label="Loading audit log…" /> : null}
        {data ? (
          <>
            <Combobox
              id="audit-log-action"
              label="Filter action"
              options={options}
              value={selected}
              onChange={(event) => changeAction(event.target.value)}
            />
            <table className="audit-log__table">
              <caption className="audit-log__caption">
                {`Organization actions of ${data.organization.displayName}`}
              </caption>
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
            {visible.length === 0 && events.length > 0 ? (
              <p className="audit-log__empty">No audit events match this filter.</p>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
