import { ErrorNote, LoadingNote } from "../components/ViewState";
import { fetchOrganizationAuditLog } from "../lib/org-api";
import { replace } from "../lib/hash-route";
import { formatTimestamp } from "../lib/format";
import { useAsyncData } from "../lib/use-async";
import { Combobox } from "../ui/Combobox";

/** The clear entry of the "Filter action" combobox: no action is selected. */
const ALL_ACTIONS = "";

/**
 * Organization audit log (REQ-2-4). The table lists the persisted organization
 * actions with an actor, action, target and timestamp; the "Filter action"
 * combobox only narrows what is displayed (it never changes organization
 * state), and the selected action travels in the hash so a reload restores the
 * same filtered view. Only an organization Owner reaches this page.
 */
export function OrganizationAuditLogPage({
  organizationId,
  action = "",
}: {
  organizationId: string;
  action?: string;
}) {
  const { status, data, error, reload } = useAsyncData(
    () => fetchOrganizationAuditLog(organizationId),
    [organizationId],
  );

  const events = data?.events ?? [];
  const selectedAction = events.some((event) => event.action === action) ? action : "";
  // One option per action type the stored events carry, in the order the events
  // first show it, plus the clear entry that restores the whole list.
  const actionOptions = [
    { value: ALL_ACTIONS, label: "All actions" },
    ...Array.from(new Set(events.map((event) => event.action))).map((name) => ({
      value: name,
      label: name,
    })),
  ];
  const visibleEvents = selectedAction
    ? events.filter((event) => event.action === selectedAction)
    : events;

  const selectAction = (value: string) => {
    // The filter belongs in the address (so a reload restores the same view)
    // without pushing one history entry per selection.
    const search = new URLSearchParams();
    if (value.trim()) search.set("action", value.trim());
    replace(`/orgs/${encodeURIComponent(organizationId)}/audit-log`, search);
  };

  return (
    <main className="page">
      <section className="page__body audit-log">
        <h1 className="organizations__title">Audit log</h1>
        {status === "loading" ? <LoadingNote label="Loading audit log…" /> : null}
        {status === "error" && error ? <ErrorNote error={error} onRetry={reload} /> : null}
        {status === "ready" && data ? (
          <>
            <div className="audit-log__filter">
              <Combobox
                label="Filter action"
                options={actionOptions}
                value={selectedAction}
                onChange={(event) => selectAction(event.target.value)}
              />
            </div>
            <table className="audit-table">
              <thead>
                <tr>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((event) => (
                  <tr
                    key={event.id}
                    className="audit-table__row"
                    aria-label={`${event.actor} ${event.action} ${event.target}`}
                  >
                    <td className="audit-table__actor">{event.actor}</td>
                    <td className="audit-table__action">{event.action}</td>
                    <td className="audit-table__target">{event.target}</td>
                    <td className="audit-table__timestamp">
                      <time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleEvents.length === 0 ? (
              <p className="audit-log__empty">
                {events.length === 0
                  ? "This organization has no audit events yet."
                  : "No audit events match the selected action."}
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
