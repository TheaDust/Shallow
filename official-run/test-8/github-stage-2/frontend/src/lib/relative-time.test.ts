import { expect, it } from "vitest";

import { relativeTime } from "./relative-time";

it("describes a past commit time relatively and always ends in ago", () => {
  const now = Date.now();
  for (const milliseconds of [5_000, 90_000, 3 * 3_600_000, 4 * 86_400_000, 400 * 86_400_000]) {
    const label = relativeTime(new Date(now - milliseconds).toISOString());
    expect(label).toMatch(/ago$/);
  }
});

it("keeps an unreadable value instead of inventing a time", () => {
  expect(relativeTime(null)).toBe("unknown");
  expect(relativeTime("not-a-date")).toBe("not-a-date");
});
