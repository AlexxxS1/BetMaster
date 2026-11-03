import assert from "node:assert/strict";
import test from "node:test";
import {
  ANGLE_DISCLAIMER,
  ANGLE_RESPONSIBLE,
  amountPhrase,
  evaluateAngles,
  marketShown,
  proposeThreshold,
  renderDetail,
  renderMatchStatement,
  renderTeamStatement,
  wilsonLower,
  type AngleGame,
} from "./angles";
import { mapNhlBox } from "./boxscore";
import { insertBoxes, listBoxes, openDatabase, replaceLeague } from "./db";
import type { NormalizedGame } from "./normalized";

const NOW = new Date("2026-04-01T10:00:00Z");
const BANNED = /kurz|sázkovk|vklad|elo|váha|váhy|vzorec|logit|sigmoid|bookmaker/i;

test("the public line uses averages and a threshold from the distribution", () => {
  assert.equal(
    renderMatchStatement({
      awayName: "Atlanta",
      homeName: "Lakers",
      awayAvg: 120,
      homeAvg: 110,
      threshold: 210,
      unit: "body",
      flavor: "score",
    }),
    "Atlanta má průměr 120 bodů na zápas, Lakers 110. Ve vzájemném zápase by mělo padnout aspoň 210 bodů.",
  );
  assert.equal(amountPhrase(1, "goly"), "1 gól");
  assert.equal(amountPhrase(2, "goly"), "2 góly");
  assert.equal(amountPhrase(5, "goly"), "5 gólů");
  assert.equal(amountPhrase(1.2, "goly"), "1,2 gólu");
  assert.equal(amountPhrase(22, "strely"), "22 střely");
  assert.equal(amountPhrase(25, "strely"), "25 střel");
  assert.equal(
    renderTeamStatement({
      teamName: "Boston Bruins",
      average: 3.4,
      venue: "away",
      venueAvg: 3.1,
      threshold: 2,
      unit: "goly",
    }),
    "Boston Bruins dává průměrně 3,4 gólu na zápas. Venku je to 3,1 gólu. V tomhle zápase by měli dát aspoň 2 góly.",
  );
  assert.equal(ANGLE_DISCLAIMER, "Tohle je analýza zápasu, ne tip k sázce.");
  assert.match(ANGLE_RESPONSIBLE, /^18\+/);
  assert.match(renderDetail({
    confidence: 0.62,
    confidenceHits: 31,
    confidenceN: 50,
    fallback: false,
    backtestRate: 0.58,
    backtestHits: 116,
    backtestN: 200,
  }), /Není to jistota/);
});

test("the threshold is a lower piece of the prior distribution, never a vacuous zero", () => {
  const prior = [100, 110, 120, 130, 140, 150, 160, 170, 180, 200];
  const line = proposeThreshold(prior, 180, 1);
  assert.ok(line);
  assert.equal(line.q, 0.85);
  assert.equal(line.threshold, 160);
  assert.equal(proposeThreshold(prior, 120, 1), null);
  assert.equal(proposeThreshold([0, 0, 0, 0, 1], 1.2, 1), null);
  assert.equal(marketShown(44, 80), false);
  assert.equal(marketShown(48, 80), true);
  assert.equal(marketShown(80, 79), false);
  assert.ok(wilsonLower(44, 80) <= 0.5);
  assert.ok(wilsonLower(48, 80) > 0.5);
});

test("a flat season does not invent a line", () => {
  const games: AngleGame[] = [];
  for (let i = 0; i < 120; i += 1) {
    games.push(nbaGame(i, "A", "B", "Atlanta", "Lakers", 110, 110));
  }
  const report = evaluateAngles(games, NOW);
  assert.equal(report.graded.length, 0);
  assert.equal(report.lines.length, 0);
  assert.equal(report.markets.every((market) => market.shown === false), true);
});

test("a walk-forward line ignores the game itself and later games", () => {
  const games = skillSeason(60);
  const future = nbaGame(10_000, "H", "G", "Atlanta", "Lakers", null, null, "2026-04-02T18:00:00Z", "scheduled");
  const report = evaluateAngles([...games, future], NOW);
  assert.ok(report.graded.length > 0);
  const sample = report.graded[Math.min(30, report.graded.length - 1)];
  assert.ok(sample);
  const index = games.findIndex((game) => game.id === sample.gameId);
  assert.ok(index >= 0);
  const prefix = evaluateAngles(games.slice(0, index + 1), NOW);
  const earlier = prefix.graded.find(
    (row) => row.gameId === sample.gameId && row.market === sample.market && row.subject === sample.subject,
  );
  assert.equal(earlier?.threshold, sample.threshold);
  assert.equal(earlier?.q, sample.q);

  const later = games.map((game, i) => (i > index ? { ...game, homeScore: 400, awayScore: 400 } : game));
  const after = evaluateAngles(later, NOW);
  const moved = after.graded.find(
    (row) => row.gameId === sample.gameId && row.market === sample.market && row.subject === sample.subject,
  );
  assert.equal(moved?.threshold, sample.threshold);

  const own = games.map((game, i) => (i === index ? { ...game, homeScore: 1, awayScore: 1 } : game));
  const leaked = evaluateAngles(own, NOW);
  const changed = leaked.graded.find(
    (row) => row.gameId === sample.gameId && row.market === sample.market && row.subject === sample.subject,
  );
  assert.equal(changed?.threshold, sample.threshold);
  assert.equal(changed?.hit, false);

  const total = report.markets.find((market) => market.market === "nba-total-points");
  const team = report.markets.find((market) => market.market === "nba-team-points");
  assert.equal(total?.shown, true);
  assert.equal(team?.shown, true);
  const upcoming = report.lines.filter((line) => line.gameId === future.id);
  const totalLine = upcoming.find((line) => line.market === "nba-total-points");
  assert.ok(totalLine);
  assert.match(totalLine.text, /Lakers má průměr/);
  assert.match(totalLine.text, /Atlanta/);
  assert.match(totalLine.text, /aspoň/);
  assert.ok((changed?.threshold ?? 0) > 2);
  for (const line of report.lines) {
    assert.match(line.detail, /Není to jistota/);
    assert.equal(BANNED.test(line.text), false);
    assert.equal(BANNED.test(line.detail), false);
  }
});

test("a short sample stays hidden even when a few lines would clear a coin flip", () => {
  const report = evaluateAngles(skillSeason(10), NOW);
  assert.ok(report.graded.length > 0);
  assert.equal(report.lines.length, 0);
  assert.equal(report.markets.every((market) => market.shown === false), true);
});

test("power-play goals are summed from skaters and a missing shot total is not invented", () => {
  const box = mapNhlBox("nhl-2026020235", {
    homeTeam: { sog: 27, score: 1 },
    awayTeam: { sog: 22, score: 2 },
    powerPlayOpportunities: 7,
    playerByGameStats: {
      homeTeam: {
        forwards: [{ powerPlayGoals: 1, sog: 4 }, { powerPlayGoals: 0, sog: 10 }],
        defense: [{ powerPlayGoals: 1, sog: 13 }],
        goalies: [{ powerPlayGoals: 0, sog: 0 }],
      },
      awayTeam: {
        forwards: [{ powerPlayGoals: 0, sog: 22 }],
        defense: [],
        goalies: [],
      },
    },
  });
  assert.deepEqual(box, {
    gameId: "nhl-2026020235",
    homeShots: 27,
    awayShots: 22,
    homePpGoals: 2,
    awayPpGoals: 0,
  });
  assert.equal(
    mapNhlBox("nhl-1", {
      homeTeam: { score: 3 },
      awayTeam: { sog: 10 },
      playerByGameStats: { homeTeam: { forwards: [{ sog: 30, powerPlayGoals: 4 }] } },
    }),
    null,
  );
  const shotsOnly = mapNhlBox("nhl-2", { homeTeam: { sog: 30 }, awayTeam: { sog: 20 } });
  assert.equal(shotsOnly?.homePpGoals, null);
  assert.equal(shotsOnly?.homeShots, 30);
});

test("a saved NHL boxscore survives a fresh schedule load", () => {
  const db = openDatabase(":memory:");
  const game = nhlFinal("nhl-2026020235");
  replaceLeague(db, "nhl", [game], [], "live");
  insertBoxes(db, [{ gameId: game.id, homeShots: 27, awayShots: 22, homePpGoals: 1, awayPpGoals: 0 }]);
  replaceLeague(db, "nhl", [game], [], "live");
  const stored = listBoxes(db);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.homeShots, 27);
  assert.equal(stored[0]?.homePpGoals, 1);
});

function skillSeason(rounds: number): AngleGame[] {
  const teams = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const names = ["Hawks", "Celtics", "Nets", "Hornets", "Bulls", "Cavaliers", "Mavericks", "Nuggets"];
  const skill = [90, 98, 106, 114, 122, 130, 138, 146];
  const games: AngleGame[] = [];
  let n = 0;
  for (let round = 0; round < rounds; round += 1) {
    for (let k = 0; k < 4; k += 1) {
      const home = (k + round) % 8;
      const away = (k + round + 4) % 8;
      games.push(
        nbaGame(
          n,
          teams[home] ?? "A",
          teams[away] ?? "B",
          names[home] ?? "Hawks",
          names[away] ?? "Celtics",
          skill[home] ?? 100,
          skill[away] ?? 100,
          new Date(Date.UTC(2025, 9, 1) + n * 3 * 60 * 60 * 1000).toISOString(),
        ),
      );
      n += 1;
    }
  }
  return games;
}

function nbaGame(
  n: number,
  home: string,
  away: string,
  homeName: string,
  awayName: string,
  homeScore: number | null,
  awayScore: number | null,
  startsAt = new Date(Date.UTC(2025, 9, 1) + n * 3 * 60 * 60 * 1000).toISOString(),
  status: AngleGame["status"] = "final",
): AngleGame {
  return {
    id: `nba-${n}`,
    league: "nba",
    startsAt,
    status,
    neutral: false,
    homeId: `nba-${home}`,
    awayId: `nba-${away}`,
    homeName,
    awayName,
    homeAbbrev: home,
    awayAbbrev: away,
    homeScore,
    awayScore,
    homeShots: null,
    awayShots: null,
    homePpGoals: null,
    awayPpGoals: null,
  };
}

function nhlFinal(id: string): NormalizedGame {
  return {
    id,
    league: "nhl",
    startsAt: "2026-11-03T02:00:00Z",
    status: "final",
    season: "20262027",
    venue: null,
    neutral: false,
    endedIn: "REG",
    homeAbbrev: "SJS",
    homeName: "San Jose Sharks",
    homeLogo: null,
    awayAbbrev: "CGY",
    awayName: "Calgary Flames",
    awayLogo: null,
    homeScore: 1,
    awayScore: 2,
    sourceName: "test",
    sourceUrl: "https://www.nhl.com/schedule",
  };
}
