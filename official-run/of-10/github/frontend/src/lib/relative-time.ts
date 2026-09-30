const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function unitFor(seconds: number): { count: number; label: string } {
  if (seconds < MINUTE) return { count: seconds, label: "second" };
  if (seconds < HOUR) return { count: Math.round(seconds / MINUTE), label: "minute" };
  if (seconds < DAY) return { count: Math.round(seconds / HOUR), label: "hour" };
  if (seconds < MONTH) return { count: Math.round(seconds / DAY), label: "day" };
  if (seconds < YEAR) return { count: Math.round(seconds / MONTH), label: "month" };
  return { count: Math.round(seconds / YEAR), label: "year" };
}

/**
 * Relative timestamp of a stored record: a stored time in the past reads
 * "<n> <unit> ago" (REQ-4-2-1), a future time keeps the inverse wording.
 */
export function relativeTime(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = Math.round((now.getTime() - date.getTime()) / 1000);
  const magnitude = Math.abs(delta);
  const { count, label } = unitFor(magnitude);
  const plural = count === 1 ? label : `${label}s`;
  return delta >= 0 ? `${count} ${plural} ago` : `in ${count} ${plural}`;
}
