/** Renders an ISO timestamp as the calendar date shown in organization lists. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  return parsed.toISOString().slice(0, 10);
}
