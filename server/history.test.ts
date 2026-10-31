import assert from "node:assert/strict";
import test from "node:test";
import { coversHistory, historyBounds, historyNote, startsInWindow } from "./history";

test("the history window is about a year back and a short schedule ahead", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const bounds = historyBounds(now);
  assert.equal(bounds.start, "2025-10-31");
  assert.equal(bounds.end, "2026-11-10");
  assert.equal(startsInWindow("2025-11-02T00:00:00Z", now), true);
  assert.equal(startsInWindow("2025-10-01T00:00:00Z", now), false);
  assert.equal(startsInWindow("2026-12-01T00:00:00Z", now), false);
  assert.equal(coversHistory("2025-11-04T00:00:00Z", now), true);
  assert.equal(coversHistory("2026-10-20T00:00:00Z", now), false);
  const note = historyNote("2025-11-01T00:00:00Z", "2025-11-02T00:00:00Z", now);
  assert.match(note, /365 dní/);
  assert.match(note, /api-web\.nhle\.com/);
  assert.match(note, /site\.api\.espn\.com/);
  assert.match(note, /nba\.com ani Livesport/);
});
