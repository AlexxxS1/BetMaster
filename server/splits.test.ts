import assert from "node:assert/strict";
import test from "node:test";
import { mapEspnSplits, mapNhlSplits } from "./splits";

test("NHL club stats become season comparisons without a power-play rate", () => {
  const stats = mapNhlSplits(
    {
      skaters: [
        { goals: 4, shots: 20, powerPlayGoals: 2, shorthandedGoals: 1, gamesPlayed: 6 },
        { goals: 1, shots: 10, powerPlayGoals: 0, shorthandedGoals: 0, gamesPlayed: 5 },
      ],
      goalies: [{ goals: 0, saves: 80, shotsAgainst: 90, gamesPlayed: 6 }],
    },
    { gamesPlayed: 6, goalFor: 6, goalAgainst: 12 },
  );
  assert.ok(stats);
  const byKey = new Map(stats.map((item) => [item.key, item.value]));
  assert.equal(byKey.get("goalsPerGame"), 1);
  assert.equal(byKey.get("goalsAgainstPerGame"), 2);
  assert.equal(byKey.get("shotsPerGame"), 5);
  assert.equal(byKey.get("shootingPct"), 16.7);
  assert.equal(byKey.get("powerPlayGoals"), 2);
  assert.equal(byKey.get("shorthandedGoals"), 1);
  assert.equal(byKey.get("savePct"), 88.9);
  assert.equal(stats.some((item) => /přesilovek %|penalty|vhaz/i.test(item.label)), false);
  assert.equal(stats.find((item) => item.key === "goalsAgainstPerGame")?.better, "low");
});

test("empty NHL club stats are skipped", () => {
  assert.equal(mapNhlSplits({ skaters: [], goalies: [] }, { gamesPlayed: 4, goalFor: 3 }), null);
});

test("ESPN team statistics keep shooting splits and skip unnamed fields", () => {
  const mapped = mapEspnSplits({
    team: { abbreviation: "bos" },
    results: {
      stats: {
        categories: [
          {
            stats: [
              { name: "avgPoints", value: 120.84 },
              { name: "threePointFieldGoalPct", value: 37.37 },
              { name: "fieldGoalPct", value: 47.4 },
              { name: "freeThrowPct", value: 76.39 },
              { name: "avgRebounds", value: 43.6 },
              { name: "avgAssists", value: 27.8 },
              { name: "avgTurnovers", value: 15.2 },
              { name: "avgSteals", value: 9.2 },
              { name: "avgBlocks", value: 3.4 },
              { name: "avgThreePointFieldGoalsMade", value: 14.8 },
              { name: "minutes", value: 0 },
            ],
          },
        ],
      },
    },
  });
  assert.equal(mapped?.abbrev, "BOS");
  const keys = mapped?.stats.map((item) => item.key);
  assert.deepEqual(keys, [
    "pointsPerGame",
    "threePointPct",
    "threesPerGame",
    "fieldGoalPct",
    "freeThrowPct",
    "reboundsPerGame",
    "assistsPerGame",
    "turnoversPerGame",
    "stealsPerGame",
    "blocksPerGame",
  ]);
  assert.equal(mapped?.stats.find((item) => item.key === "threePointPct")?.value, 37.4);
  assert.equal(mapped?.stats.find((item) => item.key === "turnoversPerGame")?.better, "low");
});
