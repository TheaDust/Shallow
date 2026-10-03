/**
 * Relative timestamps for commit records, e.g. “3 days ago”. Any distance in
 * the past stays readable (“less than a minute ago” instead of “0 seconds”), so
 * a commit time is never rendered as an absolute date on a history record.
 */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return "unknown";
  const then = Date.parse(value);
  if (Number.isNaN(then)) return value;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "less than a minute ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Absolute value for a `<time title>` so the relative label stays verifiable. */
export function absoluteTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
