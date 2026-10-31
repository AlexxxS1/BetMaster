import assert from "node:assert/strict";
import test from "node:test";
import {
  applyResult,
  classifyAbsence,
  INITIAL_ELO,
  predict,
  type ModelInput,
} from "./model";

function input(overrides: Partial<ModelInput> = {}): ModelInput {
  return {
    league: "nhl",
    neutral: false,
    eloHome: INITIAL_ELO,
    eloAway: INITIAL_ELO,
    homeForm: null,
    awayForm: null,
    h2hGames: 0,
    h2hHomeWins: 0,
    h2hAwayWins: 0,
    injuriesKnown: false,
    homeOut: 0,
    homePartial: 0,
    awayOut: 0,
    awayPartial: 0,
    ...overrides,
  };
}

test("equal teams keep a home edge, neutral ice does not", () => {
  const home = predict(input());
  const neutral = predict(input({ neutral: true }));
  assert.ok(home.homeWinProb > 0.5);
  assert.ok(Math.abs(neutral.homeWinProb - 0.5) < 1e-9);
  assert.equal(neutral.factors.home.used, false);
});

test("a higher Elo rating raises the home probability", () => {
  const base = predict(input({ neutral: true }));
  const stronger = predict(input({ neutral: true, eloHome: 1600, eloAway: 1450 }));
  assert.ok(stronger.homeWinProb > base.homeWinProb);
});

test("recent scoring margin moves the probability and is unused without games", () => {
  const flat = predict(input({ neutral: true }));
  const hot = predict(input({ neutral: true, homeForm: 2, awayForm: -1 }));
  assert.ok(hot.homeWinProb > flat.homeWinProb);
  assert.equal(hot.factors.form.used, true);
  assert.equal(flat.factors.form.used, false);
});

test("head-to-head needs two meetings", () => {
  const one = predict(input({ neutral: true, h2hGames: 1, h2hHomeWins: 1 }));
  const two = predict(input({ neutral: true, h2hGames: 2, h2hHomeWins: 2 }));
  assert.equal(one.factors.h2h.used, false);
  assert.equal(one.factors.h2h.logit, 0);
  assert.equal(two.factors.h2h.used, true);
  assert.ok(two.homeWinProb > one.homeWinProb);
});

test("listed absences lower the depleted team", () => {
  const clear = predict(input({ neutral: true, injuriesKnown: true }));
  const hurt = predict(input({ neutral: true, injuriesKnown: true, homeOut: 2 }));
  assert.ok(hurt.homeWinProb < clear.homeWinProb);
  assert.ok(hurt.factors.absence.logit < 0);
});

test("factor logits add up to the model logit", () => {
  const result = predict(
    input({
      eloHome: 1540,
      eloAway: 1480,
      homeForm: 1.2,
      awayForm: -0.4,
      h2hGames: 3,
      h2hHomeWins: 2,
      h2hAwayWins: 1,
      injuriesKnown: true,
      awayPartial: 1,
    }),
  );
  const sum = Object.values(result.factors).reduce((total, factor) => total + factor.logit, 0);
  assert.ok(Math.abs(sum - result.logit) < 1e-9);
  assert.ok(result.homeWinProb > 0 && result.homeWinProb < 1);
  assert.ok(result.scoreLeanHome > result.scoreLeanAway);
});

test("Elo updates are zero-sum and reward the winner", () => {
  const next = applyResult(1500, 1500, true, "nba", false);
  assert.ok(Math.abs(next.eloHome + next.eloAway - 3000) < 1e-9);
  assert.ok(next.eloHome > 1500);
  assert.ok(next.eloAway < 1500);
});

test("absence labels match the public injury feeds", () => {
  assert.equal(classifyAbsence("Out"), "out");
  assert.equal(classifyAbsence("Injured Reserve"), "out");
  assert.equal(classifyAbsence("Suspension"), "out");
  assert.equal(classifyAbsence("Day-To-Day"), "partial");
  assert.equal(classifyAbsence("Probable"), "none");
});
