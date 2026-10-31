import assert from "node:assert/strict";
import test from "node:test";
import { countGames, getGame, openDatabase, replaceLeague } from "./db";
import type { NormalizedGame, NormalizedSnapshot } from "./normalized";

test("a league replace lands in the local store", () => {
  const db = openDatabase(":memory:");
  const game: NormalizedGame = {
    id: "nhl-1",
    league: "nhl",
    startsAt: "2026-10-30T23:00:00Z",
    status: "final",
    season: "20262027",
    venue: "TD Garden",
    neutral: false,
    endedIn: "REG",
    homeAbbrev: "BOS",
    homeName: "Boston Bruins",
    homeLogo: null,
    awayAbbrev: "CHI",
    awayName: "Chicago Blackhawks",
    awayLogo: null,
    homeScore: 4,
    awayScore: 2,
    sourceName: "NHL Web API",
    sourceUrl: "https://www.nhl.com/schedule",
  };
  const snapshot: NormalizedSnapshot = {
    teamId: "nhl-BOS",
    league: "nhl",
    abbrev: "BOS",
    name: "Boston Bruins",
    logoUrl: null,
    teamUrl: null,
    wins: 8,
    losses: 4,
    otLosses: 1,
    tablePoints: 17,
    winPct: 0.6,
    pointsPct: 0.65,
    scoreFor: 40,
    scoreAgainst: 32,
    scoreDiff: 8,
    gamesPlayed: 13,
    rank: 4,
    rankScope: "league",
    conference: "Eastern",
    division: "Atlantic",
    sourceName: "NHL Web API — tabulka",
    sourceUrl: "https://www.nhl.com/standings",
    fetchedAt: "2026-10-31T12:00:00Z",
  };
  replaceLeague(db, "nhl", [game], [snapshot], "sample");
  assert.equal(countGames(db, "nhl"), 1);
  assert.equal(getGame(db, "nhl-1")?.homeTeamId, "nhl-BOS");
  assert.equal(getGame(db, "nhl-1")?.origin, "sample");
});
