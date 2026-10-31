import assert from "node:assert/strict";
import test from "node:test";
import { mapEspnEvent, mapEspnInjuries } from "./sources/espn";
import { mapNhlGame, mapNhlStanding } from "./sources/nhl";

test("NHL schedule game maps without taking odds", () => {
  const mapped = mapNhlGame({
    id: 2026020214,
    season: 20262027,
    gameType: 2,
    neutralSite: false,
    startTimeUTC: "2026-10-30T22:00:00Z",
    gameState: "OFF",
    gameCenterLink: "/gamecenter/njd-vs-vgk/2026/10/30/2026020214",
    venue: { default: "T-Mobile Arena" },
    gameOutcome: { lastPeriodType: "REG" },
    oddsPartners: [{ name: "should-not-matter" }],
    awayTeam: {
      abbrev: "NJD",
      placeName: { default: "New Jersey" },
      commonName: { default: "Devils" },
      logo: "https://assets.nhle.com/logos/nhl/svg/NJD_light.svg",
      score: 5,
    },
    homeTeam: {
      abbrev: "VGK",
      placeName: { default: "Vegas" },
      commonName: { default: "Golden Knights" },
      score: 2,
    },
  });
  assert.equal(mapped?.id, "nhl-2026020214");
  assert.equal(mapped?.homeName, "Vegas Golden Knights");
  assert.equal(mapped?.awayScore, 5);
  assert.equal(mapped?.status, "final");
  assert.equal(mapped?.sourceUrl, "https://www.nhl.com/gamecenter/njd-vs-vgk/2026/10/30/2026020214");
  assert.equal(JSON.stringify(mapped).includes("should-not-matter"), false);
});

test("preseason NHL games are skipped", () => {
  assert.equal(mapNhlGame({ id: 1, gameType: 1, awayTeam: {}, homeTeam: {} }), null);
});

test("NHL standings become a pre-match rating with a public link", () => {
  const row = mapNhlStanding(
    {
      teamAbbrev: { default: "CAR" },
      teamName: { default: "Carolina Hurricanes" },
      wins: 11,
      losses: 2,
      otLosses: 2,
      points: 24,
      pointPctg: 0.8,
      goalFor: 56,
      goalAgainst: 36,
      goalDifferential: 20,
      gamesPlayed: 15,
      leagueSequence: 1,
      conferenceName: "Eastern",
      divisionName: "Metropolitan",
    },
    "2026-10-31T12:00:00Z",
  );
  assert.equal(row?.teamId, "nhl-CAR");
  assert.equal(row?.tablePoints, 24);
  assert.equal(row?.sourceUrl, "https://www.nhl.com/standings");
});

test("ESPN scoreboard and injury rows map into the local shape", () => {
  const game = mapEspnEvent(
    {
      id: "401909277",
      date: "2026-10-30T23:00Z",
      season: { year: 2027, type: 2 },
      status: { type: { state: "post", completed: true, detail: "Final", name: "STATUS_FINAL" } },
      competitions: [
        {
          neutralSite: false,
          venue: { fullName: "Capital One Arena" },
          competitors: [
            { homeAway: "home", score: "95", team: { abbreviation: "WSH", displayName: "Washington Wizards", logo: "https://example.test/wsh.png" } },
            { homeAway: "away", score: "79", team: { abbreviation: "CHA", displayName: "Charlotte Hornets" } },
          ],
        },
      ],
      links: [{ rel: ["summary"], href: "https://www.espn.com/nba/game/_/gameId/401909277" }],
    },
    "nba",
  );
  assert.equal(game?.id, "nba-401909277");
  assert.equal(game?.homeScore, 95);
  assert.equal(game?.sourceName, "ESPN public scoreboard");

  const injuries = mapEspnInjuries(
    {
      injuries: [
        {
          id: "1",
          displayName: "Atlanta Hawks",
          injuries: [
            {
              status: "Out",
              shortComment: "Gueye is out.",
              date: "2026-10-19T19:38Z",
              athlete: { id: "99", displayName: "Mouhamed Gueye", links: [{ rel: ["playercard"], href: "https://www.espn.com/nba/player/_/id/99" }] },
            },
            { status: "Probable", athlete: { displayName: "Someone Else" } },
          ],
        },
      ],
    },
    "nba",
  );
  assert.equal(injuries.length, 1);
  assert.equal(injuries[0]?.playerName, "Mouhamed Gueye");
  assert.equal(injuries[0]?.sourceUrl, "https://www.espn.com/nba/player/_/id/99");
});
