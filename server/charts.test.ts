import assert from "node:assert/strict";
import test from "node:test";
import { buildMatchCharts } from "./charts";
import { INITIAL_ELO, predict } from "./model";

test("match charts cover every model factor in Czech", () => {
  const model = predict({
    league: "nhl",
    neutral: false,
    eloHome: 1540,
    eloAway: 1475,
    homeForm: 1.2,
    awayForm: -0.4,
    h2hGames: 3,
    h2hHomeWins: 2,
    h2hAwayWins: 1,
    injuriesKnown: true,
    homeOut: 1,
    homePartial: 0,
    awayOut: 0,
    awayPartial: 2,
  });
  const charts = buildMatchCharts({
    league: "nhl",
    homeAbbrev: "BOS",
    awayAbbrev: "CHI",
    neutral: false,
    model,
    formHome: [
      { opponentAbbrev: "TOR", teamScore: 4, opponentScore: 2 },
      { opponentAbbrev: "MTL", teamScore: 1, opponentScore: 3 },
    ],
    formAway: [{ opponentAbbrev: "DET", teamScore: 2, opponentScore: 2 }],
    h2h: [
      { startsAt: "2026-02-01T00:00:00Z", homeAbbrev: "BOS", awayAbbrev: "CHI", homeScore: 3, awayScore: 1 },
      { startsAt: "2026-01-10T00:00:00Z", homeAbbrev: "CHI", awayAbbrev: "BOS", homeScore: 4, awayScore: 2 },
      { startsAt: "2025-11-20T00:00:00Z", homeAbbrev: "BOS", awayAbbrev: "CHI", homeScore: 2, awayScore: 1 },
    ],
    chart: {
      eloHome: [
        { label: "start", value: INITIAL_ELO },
        { label: "2025-11-20", value: 1512 },
        { label: "2026-10-30", value: 1540 },
      ],
      eloAway: [
        { label: "start", value: INITIAL_ELO },
        { label: "2026-01-10", value: 1488 },
      ],
      homeSplit: { homeGames: 20, homeWins: 14, awayGames: 18, awayWins: 8 },
      awaySplit: { homeGames: 19, homeWins: 9, awayGames: 17, awayWins: 6 },
    },
  });
  assert.deepEqual(
    charts.map((chart) => chart.id),
    ["factors", "elo", "form", "h2h", "home-away", "injuries"],
  );
  for (const chart of charts) {
    assert.ok(chart.measures.length > 20);
    assert.ok(chart.effect.length > 20);
    assert.ok(chart.summary.length > 5);
  }
  assert.match(charts.find((chart) => chart.id === "factors")?.effect ?? "", /ne sázkový tip/);
  assert.equal(charts.find((chart) => chart.id === "h2h")?.series[0]?.points.length, 3);
  assert.match(charts.find((chart) => chart.id === "home-away")?.effect ?? "", /40 Elo/);
  assert.match(charts.find((chart) => chart.id === "form")?.effect ?? "", /0,35/);
});
