import type { League } from "../shared/types";

export const INITIAL_ELO = 1500;
export const K_FACTOR = 24;
export const HOME_ELO: Record<League, number> = { nhl: 40, nba: 70 };
export const FORM_WEIGHT = 0.35;
export const H2H_WEIGHT = 0.2;
export const FORM_DIVISOR: Record<League, number> = { nhl: 1.5, nba: 12 };
export const SCORE_BASE: Record<League, number> = { nhl: 3.05, nba: 112 };
export const SCORE_SCALE: Record<League, number> = { nhl: 1.5, nba: 18 };
const LN10 = Math.log(10);

export type AbsenceClass = "out" | "partial" | "none";

export type ModelInput = {
  league: League;
  neutral: boolean;
  eloHome: number;
  eloAway: number;
  homeForm: number | null;
  awayForm: number | null;
  h2hGames: number;
  h2hHomeWins: number;
  h2hAwayWins: number;
  injuriesKnown: boolean;
  homeOut: number;
  homePartial: number;
  awayOut: number;
  awayPartial: number;
};

export type ModelFactor = {
  logit: number;
  used: boolean;
};

export type ModelResult = {
  homeWinProb: number;
  logit: number;
  scoreLeanHome: number;
  scoreLeanAway: number;
  factors: {
    home: ModelFactor & { homeEloAdv: number };
    elo: ModelFactor & { eloHome: number; eloAway: number };
    form: ModelFactor & { homeAvg: number | null; awayAvg: number | null; edge: number };
    h2h: ModelFactor & { games: number; homeWins: number; awayWins: number };
    absence: ModelFactor & {
      homeOut: number;
      homePartial: number;
      awayOut: number;
      awayPartial: number;
    };
  };
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function classifyAbsence(status: string): AbsenceClass {
  const text = status.trim().toLowerCase();
  if (!text || text === "probable" || text === "active") return "none";
  if (/\bout\b|injured reserve|\bir\b|out for season|suspended|suspension/.test(text)) {
    return "out";
  }
  if (/doubt|question|day-to-day|day to day|game time decision|\bgtd\b/.test(text)) {
    return "partial";
  }
  return "none";
}

export function eloExpected(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function applyResult(
  eloHome: number,
  eloAway: number,
  homeWon: boolean,
  league: League,
  neutral: boolean,
): { eloHome: number; eloAway: number } {
  const expected = eloExpected(eloHome + (neutral ? 0 : HOME_ELO[league]), eloAway);
  const score = homeWon ? 1 : 0;
  const delta = K_FACTOR * (score - expected);
  return { eloHome: eloHome + delta, eloAway: eloAway - delta };
}

export function sigmoid(logit: number): number {
  return 1 / (1 + Math.exp(-logit));
}

function eloLogit(diff: number): number {
  return (LN10 * diff) / 400;
}

export function predict(input: ModelInput): ModelResult {
  const homeEloAdv = input.neutral ? 0 : HOME_ELO[input.league];
  const homeLogit = eloLogit(homeEloAdv);
  const eloDiffLogit = eloLogit(input.eloHome - input.eloAway);

  const formKnown = input.homeForm !== null || input.awayForm !== null;
  const formEdge = formKnown
    ? clamp(
        ((input.homeForm ?? 0) - (input.awayForm ?? 0)) / FORM_DIVISOR[input.league],
        -1,
        1,
      )
    : 0;
  const formLogit = formKnown ? FORM_WEIGHT * formEdge : 0;

  const h2hUsed = input.h2hGames >= 2;
  const h2hEdge = h2hUsed
    ? (input.h2hHomeWins - input.h2hAwayWins) / input.h2hGames
    : 0;
  const h2hLogit = h2hUsed ? H2H_WEIGHT * h2hEdge : 0;

  const absenceLoad = (full: number, partial: number) => full * 0.06 + partial * 0.02;
  const absenceLogit = input.injuriesKnown
    ? clamp(
        absenceLoad(input.awayOut, input.awayPartial) -
          absenceLoad(input.homeOut, input.homePartial),
        -0.24,
        0.24,
      )
    : 0;

  const logit = homeLogit + eloDiffLogit + formLogit + h2hLogit + absenceLogit;
  const homeWinProb = sigmoid(logit);
  const edge = homeWinProb - 0.5;
  const swing = edge * SCORE_SCALE[input.league] * 2;

  return {
    homeWinProb,
    logit,
    scoreLeanHome: SCORE_BASE[input.league] + swing,
    scoreLeanAway: SCORE_BASE[input.league] - swing,
    factors: {
      home: { logit: homeLogit, used: !input.neutral, homeEloAdv },
      elo: {
        logit: eloDiffLogit,
        used: true,
        eloHome: input.eloHome,
        eloAway: input.eloAway,
      },
      form: {
        logit: formLogit,
        used: formKnown,
        homeAvg: input.homeForm,
        awayAvg: input.awayForm,
        edge: formEdge,
      },
      h2h: {
        logit: h2hLogit,
        used: h2hUsed,
        games: input.h2hGames,
        homeWins: input.h2hHomeWins,
        awayWins: input.h2hAwayWins,
      },
      absence: {
        logit: absenceLogit,
        used: input.injuriesKnown,
        homeOut: input.homeOut,
        homePartial: input.homePartial,
        awayOut: input.awayOut,
        awayPartial: input.awayPartial,
      },
    },
  };
}

export function assumptionLines(): string[] {
  return [
    `Elo začíná na ${INITIAL_ELO} a po každém odehraném zápase se posune koeficientem K = ${K_FACTOR}. Minulá sezóna se nepřenáší.`,
    `Domácí výhoda je ${HOME_ELO.nhl} Elo v NHL a ${HOME_ELO.nba} Elo v NBA. Jsou to ručně zvolené konstanty (historicky zhruba 55–60 % výher domácích), ne odhad z kurzů.`,
    `Forma je průměrný rozdíl skóre z nejvýše pěti předchozích zápasů. Váha ve vzorci je ${FORM_WEIGHT}.`,
    `Vzájemné zápasy se započtou až od dvou společných utkání. Váha je ${H2H_WEIGHT}, schválně nízká.`,
    "Plná absence (Out, injured reserve, suspension) posune logit týmu o 0,06, částečná (day-to-day) o 0,02, dohromady nejvýše o ±0,24. Důležitost hráče model nezná.",
    "Váhy nejsou natrénovaná regrese. Jsou to zveřejněné konstanty, aby šel výsledek dopočítat.",
    "Vítěz zápasu včetně prodloužení a nájezdů bere 1, poražený 0. Remízy model neřeší.",
    "U odehraného zápasu se dnešní absence do pravděpodobnosti nepočítají. Máme jen aktuální seznam, ne sestavu před výkopem.",
    "Výstup je analýza zápasu, ne doporučení k sázce.",
  ];
}

export const FORMULA =
  "logit = ln(10)/400 × domácí výhoda + ln(10)/400 × (Elo domácí − Elo hosté) + 0,35 × forma + 0,20 × vzájemné zápasy + absence. P(domácí) = 1 / (1 + e^(−logit)).";
