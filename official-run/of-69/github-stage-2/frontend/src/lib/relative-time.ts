const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * A relative timestamp such as “2 years ago”. The numeric style is used on
 * purpose: every past instant reads as “<count> <unit> ago”, so a page always
 * states how long ago a commit was recorded.
 */
export function relativeTime(value: string, now: number = Date.now()): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return value;
  const seconds = Math.round((then - now) / 1000);
  const magnitude = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  if (magnitude < MINUTE) return formatter.format(Math.round(seconds), "second");
  if (magnitude < HOUR) return formatter.format(Math.round(seconds / MINUTE), "minute");
  if (magnitude < DAY) return formatter.format(Math.round(seconds / HOUR), "hour");
  if (magnitude < MONTH) return formatter.format(Math.round(seconds / DAY), "day");
  if (magnitude < YEAR) return formatter.format(Math.round(seconds / MONTH), "month");
  return formatter.format(Math.round(seconds / YEAR), "year");
}
