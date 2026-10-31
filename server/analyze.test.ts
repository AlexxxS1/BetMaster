import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSchedule, type AnalysisGame } from "./analyze";
import { INITIAL_ELO } from "./model";

function game(overrides: Partial<AnalysisGame> & Pick<AnalysisGame, "id" | "startsAt">): AnalysisGame {
  return {
    league: "nhl",
    status: "final",
    neutral: false,
    endedIn: "REG",
    homeTeamId: "nhl-A",
    awayTeamId: "nhl-B",
    homeScore: 3,
    awayScore: 1,
    ...overrides,
  };
}

test("a later result does not change the earlier prediction", () => {
  const first = game({ id: "g1", startsAt: "2026-10-01T00:00:00Z" });
  const second = game({
    id: "g2",
    startsAt: "2026-10-05T00:00:00Z",
    status: "scheduled",
    homeTeamId: "nhl-A",
    awayTeamId: "nhl-C",
    homeScore: null,
    awayScore: null,
  });
  const alone = analyzeSchedule([first], [], new Set());
  const both = analyzeSchedule([first, second], [], new Set());
  assert.equal(alone.get("g1")?.model.homeWinProb, both.get("g1")?.model.homeWinProb);
  assert.ok((both.get("g2")?.eloHome ?? 0) > INITIAL_ELO);
  assert.equal(both.get("g2")?.eloAway, INITIAL_ELO);
});

test("current injuries are hidden from retro probabilities", () => {
  const played = game({ id: "played", startsAt: "2026-10-02T00:00:00Z", homeScore: 2, awayScore: 4 });
  const upcoming = game({
    id: "next",
    startsAt: "2026-10-08T00:00:00Z",
    status: "scheduled",
    homeScore: null,
    awayScore: null,
  });
  const injuries = [{ teamId: "nhl-A", status: "Out" }];
  const analyzed = analyzeSchedule([played, upcoming], injuries, new Set(["nhl"]));
  assert.equal(analyzed.get("played")?.injuriesApplied, false);
  assert.equal(analyzed.get("played")?.model.factors.absence.used, false);
  assert.equal(analyzed.get("next")?.injuriesApplied, true);
  assert.ok((analyzed.get("next")?.model.factors.absence.logit ?? 0) < 0);
});

test("overtime loss is not a regulation loss in the form row", () => {
  const played = game({
    id: "ot",
    startsAt: "2026-10-01T00:00:00Z",
    endedIn: "OT",
    homeScore: 2,
    awayScore: 3,
  });
  const upcoming = game({
    id: "next",
    startsAt: "2026-10-03T00:00:00Z",
    status: "scheduled",
    homeTeamId: "nhl-B",
    awayTeamId: "nhl-C",
    homeScore: null,
    awayScore: null,
  });
  const analyzed = analyzeSchedule([played, upcoming], [], new Set());
  assert.equal(analyzed.get("upcoming") ? null : analyzed.get("next")?.formHome[0]?.result, "W");
  const next = analyzeSchedule(
    [
      played,
      game({
        id: "home-again",
        startsAt: "2026-10-04T00:00:00Z",
        status: "scheduled",
        homeScore: null,
        awayScore: null,
      }),
    ],
    [],
    new Set(),
  );
  assert.equal(next.get("home-again")?.formHome[0]?.result, "OTL");
});

test("head-to-head keeps every meeting in the loaded history", () => {
  const meetings = [1, 2, 3, 4, 5, 6].map((day) =>
    game({
      id: `m${day}`,
      startsAt: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z`,
      homeScore: day % 2 === 0 ? 1 : 4,
      awayScore: day % 2 === 0 ? 3 : 2,
    }),
  );
  const upcoming = game({
    id: "next",
    startsAt: "2026-03-01T00:00:00Z",
    status: "scheduled",
    homeScore: null,
    awayScore: null,
  });
  const analyzed = analyzeSchedule([...meetings, upcoming], [], new Set(), "next");
  const next = analyzed.get("next");
  assert.equal(next?.h2h.length, 6);
  assert.equal(next?.model.factors.h2h.used, true);
  assert.equal(next?.formHome.length, 5);
  assert.ok((next?.chart?.eloHome.length ?? 0) > 1);
  assert.equal(next?.chart?.homeSplit.homeGames, 6);
});
