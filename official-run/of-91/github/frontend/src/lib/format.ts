/** Locale-independent rendering of a stored ISO timestamp. */
export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const RELATIVE_UNITS: ReadonlyArray<readonly [number, string]> = [
  [YEAR, "year"],
  [MONTH, "month"],
  [DAY, "day"],
  [HOUR, "hour"],
  [MINUTE, "minute"],
];

/**
 * Relative wording of a stored timestamp ("5 days ago"), used by the read-only
 * commit views. A timestamp older than a year is shown as its calendar date,
 * the way the history list distinguishes older records from recent ones; a
 * timestamp that cannot be parsed is shown unchanged.
 */
export function formatRelativeTime(value: string, now: number = Date.now()): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  const difference = now - time;
  const magnitude = Math.abs(difference);
  if (magnitude >= YEAR) return formatTimestamp(value);
  if (magnitude < MINUTE) return difference < 0 ? "in a few seconds" : "just now";
  for (const [size, name] of RELATIVE_UNITS) {
    if (magnitude >= size) {
      const count = Math.max(1, Math.floor(magnitude / size));
      const label = `${count} ${name}${count === 1 ? "" : "s"}`;
      return difference < 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return "just now";
}
