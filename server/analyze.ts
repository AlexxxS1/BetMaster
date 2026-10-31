import type { FormResult, League } from "../shared/types";
import { applyResult, classifyAbsence, INITIAL_ELO, predict, type ModelResult } from "./model";
import type { EndedIn } from "./normalized";

export type AnalysisGame = {
  id: string;
  league: League;
  startsAt: string;
  status: "scheduled" | "live" | "final" | "postponed";
  neutral: boolean;
  endedIn: EndedIn | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
};

export type InjuryInput = {
  teamId: string;
  status: string;
};

export type FormRow = {
  gameId: string;
  startsAt: string;
  opponentId: string;
  teamScore: number;
  opponentScore: number;
  result: FormResult;
};

export type H2HRow = {
  gameId: string;
  startsAt: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId: string | null;
};

export type VenueSplit = {
  homeGames: number;
  homeWins: number;
  awayGames: number;
  awayWins: number;
};

export type EloPoint = {
  label: string;
  value: number;
};

export type ChartSnapshot = {
  eloHome: EloPoint[];
  eloAway: EloPoint[];
  homeSplit: VenueSplit;
  awaySplit: VenueSplit;
};

export type GameAnalysis = {
  model: ModelResult;
  eloHome: number;
  eloAway: number;
  formHome: FormRow[];
  formAway: FormRow[];
  h2h: H2HRow[];
  injuriesApplied: boolean;
  chart?: ChartSnapshot;
};

export function analyzeSchedule(
  games: AnalysisGame[],
  injuries: InjuryInput[],
  injuryLeagues: ReadonlySet<League>,
  focusId?: string,
): Map<string, GameAnalysis> {
  const sorted = [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const elo = new Map<string, number>();
  const eloPath = new Map<string, EloPoint[]>();
  const splits = new Map<string, VenueSplit>();
  const history: AnalysisGame[] = [];
  const out = new Map<string, GameAnalysis>();
  const absence = countAbsences(injuries);

  for (const game of sorted) {
    const eloHome = elo.get(game.homeTeamId) ?? INITIAL_ELO;
    const eloAway = elo.get(game.awayTeamId) ?? INITIAL_ELO;
    const homePast = recentFinals(history, game.homeTeamId, 5);
    const awayPast = recentFinals(history, game.awayTeamId, 5);
    const meetings = priorMeetings(history, game.homeTeamId, game.awayTeamId);
    const h2h = countH2H(meetings, game.homeTeamId);
    const chart =
      game.id === focusId
        ? {
            eloHome: [...pathOf(eloPath, game.homeTeamId)],
            eloAway: [...pathOf(eloPath, game.awayTeamId)],
            homeSplit: { ...splitOf(splits, game.homeTeamId) },
            awaySplit: { ...splitOf(splits, game.awayTeamId) },
          }
        : undefined;
    const homeAbs = absence.get(game.homeTeamId) ?? { out: 0, partial: 0 };
    const awayAbs = absence.get(game.awayTeamId) ?? { out: 0, partial: 0 };
    const injuriesApplied = game.status !== "final" && injuryLeagues.has(game.league);
    const model = predict({
      league: game.league,
      neutral: game.neutral,
      eloHome,
      eloAway,
      homeForm: averageMargin(homePast, game.homeTeamId),
      awayForm: averageMargin(awayPast, game.awayTeamId),
      h2hGames: meetings.length,
      h2hHomeWins: h2h.wins,
      h2hAwayWins: h2h.losses,
      injuriesKnown: injuriesApplied,
      homeOut: homeAbs.out,
      homePartial: homeAbs.partial,
      awayOut: awayAbs.out,
      awayPartial: awayAbs.partial,
    });
    out.set(game.id, {
      model,
      eloHome,
      eloAway,
      formHome: homePast.map((item) => toForm(item, game.homeTeamId)).reverse(),
      formAway: awayPast.map((item) => toForm(item, game.awayTeamId)).reverse(),
      h2h: meetings.slice(-24).reverse().map(toH2H),
      injuriesApplied,
      chart,
    });

    if (
      game.status === "final" &&
      game.homeScore != null &&
      game.awayScore != null &&
      game.homeScore !== game.awayScore
    ) {
      const next = applyResult(
        eloHome,
        eloAway,
        (game.homeScore ?? 0) > (game.awayScore ?? 0),
        game.league,
        game.neutral,
      );
      elo.set(game.homeTeamId, next.eloHome);
      elo.set(game.awayTeamId, next.eloAway);
      const label = game.startsAt.slice(0, 10);
      pathOf(eloPath, game.homeTeamId).push({ label, value: next.eloHome });
      pathOf(eloPath, game.awayTeamId).push({ label, value: next.eloAway });
      noteSplit(splits, game);
    }
    history.push(game);
  }

  return out;
}

function recentFinals(history: AnalysisGame[], teamId: string, limit: number): AnalysisGame[] {
  const rows: AnalysisGame[] = [];
  for (let index = history.length - 1; index >= 0 && rows.length < limit; index -= 1) {
    const game = history[index];
    if (game.status !== "final" || game.homeScore == null || game.awayScore == null) continue;
    if (game.homeTeamId !== teamId && game.awayTeamId !== teamId) continue;
    rows.push(game);
  }
  return rows.reverse();
}

function averageMargin(games: AnalysisGame[], teamId: string): number | null {
  if (games.length === 0) return null;
  const total = games.reduce((sum, game) => {
    const mine = game.homeTeamId === teamId ? game.homeScore ?? 0 : game.awayScore ?? 0;
    const opp = game.homeTeamId === teamId ? game.awayScore ?? 0 : game.homeScore ?? 0;
    return sum + mine - opp;
  }, 0);
  return total / games.length;
}

function priorMeetings(history: AnalysisGame[], homeTeamId: string, awayTeamId: string): AnalysisGame[] {
  return history.filter(
    (game) =>
      game.status === "final" &&
      game.homeScore != null &&
      game.awayScore != null &&
      ((game.homeTeamId === homeTeamId && game.awayTeamId === awayTeamId) ||
        (game.homeTeamId === awayTeamId && game.awayTeamId === homeTeamId)),
  );
}

function countH2H(games: AnalysisGame[], currentHomeId: string): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const game of games) {
    const homeScore = game.homeTeamId === currentHomeId ? game.homeScore ?? 0 : game.awayScore ?? 0;
    const awayScore = game.homeTeamId === currentHomeId ? game.awayScore ?? 0 : game.homeScore ?? 0;
    if (homeScore > awayScore) wins += 1;
    else if (awayScore > homeScore) losses += 1;
  }
  return { wins, losses };
}

function toForm(game: AnalysisGame, teamId: string): FormRow {
  const home = game.homeTeamId === teamId;
  const teamScore = home ? game.homeScore ?? 0 : game.awayScore ?? 0;
  const opponentScore = home ? game.awayScore ?? 0 : game.homeScore ?? 0;
  let result: FormResult = teamScore > opponentScore ? "W" : "L";
  if (result === "L" && (game.endedIn === "OT" || game.endedIn === "SO")) result = "OTL";
  return {
    gameId: game.id,
    startsAt: game.startsAt,
    opponentId: home ? game.awayTeamId : game.homeTeamId,
    teamScore,
    opponentScore,
    result,
  };
}

function toH2H(game: AnalysisGame): H2HRow {
  const home = game.homeScore ?? 0;
  const away = game.awayScore ?? 0;
  return {
    gameId: game.id,
    startsAt: game.startsAt,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    homeScore: home,
    awayScore: away,
    winnerTeamId: home === away ? null : home > away ? game.homeTeamId : game.awayTeamId,
  };
}

function pathOf(paths: Map<string, EloPoint[]>, teamId: string): EloPoint[] {
  let path = paths.get(teamId);
  if (!path) {
    path = [{ label: "start", value: INITIAL_ELO }];
    paths.set(teamId, path);
  }
  return path;
}

function splitOf(splits: Map<string, VenueSplit>, teamId: string): VenueSplit {
  let split = splits.get(teamId);
  if (!split) {
    split = { homeGames: 0, homeWins: 0, awayGames: 0, awayWins: 0 };
    splits.set(teamId, split);
  }
  return split;
}

function noteSplit(splits: Map<string, VenueSplit>, game: AnalysisGame): void {
  if (game.neutral || game.homeScore == null || game.awayScore == null || game.homeScore === game.awayScore) return;
  const home = splitOf(splits, game.homeTeamId);
  home.homeGames += 1;
  if (game.homeScore > game.awayScore) home.homeWins += 1;
  const away = splitOf(splits, game.awayTeamId);
  away.awayGames += 1;
  if (game.awayScore > game.homeScore) away.awayWins += 1;
}

function countAbsences(injuries: InjuryInput[]): Map<string, { out: number; partial: number }> {
  const map = new Map<string, { out: number; partial: number }>();
  for (const injury of injuries) {
    const kind = classifyAbsence(injury.status);
    if (kind === "none") continue;
    const current = map.get(injury.teamId) ?? { out: 0, partial: 0 };
    if (kind === "out") current.out += 1;
    else current.partial += 1;
    map.set(injury.teamId, current);
  }
  return map;
}
