import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisGame } from "./analyze";
import { openDatabase, replaceLeague, listRecordedPicks } from "./db";
import type { NormalizedGame } from "./normalized";
import {
  NHL_RESULT_RULE,
  favoredSide,
  gradeFinals,
  gradeOutcome,
  recordResponse,
  settleRecordedPicks,
  winnerSide,
} from "./record";

test("NHL overtime and a draw follow the public rule", () => {
  assert.equal(NHL_RESULT_RULE.includes("\n"), false);
  assert.match(NHL_RESULT_RULE, /prodloužení/);
  assert.match(NHL_RESULT_RULE, /nájezdech/);
  assert.match(NHL_RESULT_RULE, /[Rr]emíza/);
  assert.equal(winnerSide(3, 2), "home");
  assert.equal(gradeOutcome("away", winnerSide(3, 4)), true);
  assert.equal(gradeOutcome("home", winnerSide(2, 2)), false);
  assert.equal(gradeOutcome(favoredSide(0.5), winnerSide(4, 1)), null);
});

test("a walk-forward grade ignores the game itself and later games", () => {
  const early = finalGame("early", "2026-01-01T00:00:00Z", 2, 1);
  const later = finalGame("later", "2026-02-01T00:00:00Z", 0, 9);
  const upset = finalGame("upset", "2026-01-03T00:00:00Z", 0, 10);
  const both = gradeFinals([early, later]);
  const alone = gradeFinals([early]);
  assert.equal(both[0]?.homeWinProb, alone[0]?.homeWinProb);
  const gradedUpset = gradeFinals([upset])[0];
  assert.ok(gradedUpset);
  assert.ok(gradedUpset.homeWinProb > 0.5);
  assert.equal(gradedUpset.success, false);
});

test("a stored pick can move until the opening time and is graded once", () => {
  const db = openDatabase(":memory:");
  replaceLeague(db, "nhl", [pastGame(), futureGame(2, 1)], [], "live");
  settleRecordedPicks(db, new Date("2026-10-01T12:00:00Z"));
  const first = listRecordedPicks(db).find((pick) => pick.gameId === "nhl-future");
  assert.ok(first);
  assert.equal(first.gradedAt, null);
  assert.ok(first.homeWinProb > 0.5);

  replaceLeague(db, "nhl", [pastGame(), futureGame(2, 1)], [], "live");
  settleRecordedPicks(db, new Date("2026-10-20T12:00:00Z"));
  const frozen = listRecordedPicks(db).find((pick) => pick.gameId === "nhl-future");
  assert.equal(frozen?.homeWinProb, first.homeWinProb);
  assert.equal(frozen?.recordedAt, first.recordedAt);

  replaceLeague(db, "nhl", [pastGame(), { ...futureGame(4, 1), status: "final" }], [], "live");
  settleRecordedPicks(db, new Date("2026-10-21T12:00:00Z"));
  const graded = listRecordedPicks(db).find((pick) => pick.gameId === "nhl-future");
  assert.equal(graded?.success, true);
  assert.equal(graded?.homeScore, 4);

  replaceLeague(db, "nhl", [pastGame(), { ...futureGame(1, 6), status: "final" }], [], "live");
  settleRecordedPicks(db, new Date("2026-10-22T12:00:00Z"));
  const again = listRecordedPicks(db).find((pick) => pick.gameId === "nhl-future");
  assert.equal(again?.success, true);
  assert.equal(again?.homeScore, 4);

  const report = recordResponse(db, new Date("2026-10-22T12:00:00Z"));
  assert.equal(report.live.all.successful, 1);
  assert.equal(report.backtest.all.total >= 1, true);
  assert.equal(report.recent.some((row) => row.id === "nhl-future" && row.source === "live"), true);
  assert.equal(report.recent.some((row) => row.id === "nhl-future" && row.source === "backtest"), false);
});

function finalGame(id: string, startsAt: string, homeScore: number, awayScore: number): AnalysisGame {
  return {
    id,
    league: "nhl",
    startsAt,
    status: "final",
    neutral: false,
    endedIn: "SO",
    homeTeamId: "nhl-BOS",
    awayTeamId: "nhl-CHI",
    homeScore,
    awayScore,
  };
}

function pastGame(): NormalizedGame {
  return game("nhl-past", "2026-09-01T23:00:00Z", "final", 3, 2);
}

function futureGame(homeScore: number | null, awayScore: number | null): NormalizedGame {
  return game("nhl-future", "2026-10-15T23:00:00Z", "scheduled", homeScore, awayScore);
}

function game(
  id: string,
  startsAt: string,
  status: NormalizedGame["status"],
  homeScore: number | null,
  awayScore: number | null,
): NormalizedGame {
  return {
    id,
    league: "nhl",
    startsAt,
    status,
    season: "20262027",
    venue: null,
    neutral: false,
    endedIn: status === "final" ? "OT" : null,
    homeAbbrev: "BOS",
    homeName: "Boston Bruins",
    homeLogo: null,
    awayAbbrev: "CHI",
    awayName: "Chicago Blackhawks",
    awayLogo: null,
    homeScore,
    awayScore,
    sourceName: "test",
    sourceUrl: "https://www.nhl.com/schedule",
  };
}
