import type { League, RecordCounts, RecordMonth, RecordResponse, RecordRow } from "../shared/types";
import { analyzeSchedule, type AnalysisGame } from "./analyze";
import {
  gradeRecordedOnce,
  listGames,
  listInjuries,
  listRecordedPicks,
  listSources,
  listTeams,
  savePrematchPick,
  type AppDatabase,
  type RecordedPick,
} from "./db";
import type { StoredGame, StoredTeam } from "./normalized";

export const NHL_RESULT_RULE =
  "V NHL se počítá vítěz zápasu i po prodloužení nebo nájezdech; remíza by se jako úspěch nepočítala.";

export function favoredSide(homeWinProb: number): "home" | "away" | null {
  if (homeWinProb > 0.5) return "home";
  if (homeWinProb < 0.5) return "away";
  return null;
}

export function winnerSide(homeScore: number, awayScore: number): "home" | "away" | null {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return null;
}

export function gradeOutcome(
  favored: "home" | "away" | null,
  winner: "home" | "away" | null,
): boolean | null {
  if (favored == null) return null;
  if (winner == null) return false;
  return favored === winner;
}

export function gradeFinals(games: AnalysisGame[]): { id: string; homeWinProb: number; success: boolean }[] {
  const analyses = analyzeSchedule(games, [], new Set());
  const graded = [];
  for (const game of games) {
    if (game.status !== "final" || game.homeScore == null || game.awayScore == null) continue;
    const prob = analyses.get(game.id)?.model.homeWinProb;
    if (prob == null) continue;
    const success = gradeOutcome(favoredSide(prob), winnerSide(game.homeScore, game.awayScore));
    if (success == null) continue;
    graded.push({ id: game.id, homeWinProb: prob, success });
  }
  return graded;
}

export function settleRecordedPicks(db: AppDatabase, now = new Date()): void {
  const { games, analyses } = loadAnalyses(db);
  const nowIso = now.toISOString();
  for (const game of games) {
    if (game.status !== "scheduled") continue;
    if (nowIso >= game.startsAt) continue;
    const prob = analyses.get(game.id)?.model.homeWinProb;
    if (prob == null) continue;
    savePrematchPick(db, {
      gameId: game.id,
      league: game.league,
      recordedAt: nowIso,
      startsAt: game.startsAt,
      homeWinProb: prob,
      favored: favoredSide(prob) ?? "even",
    });
  }
  const byId = new Map(games.map((game) => [game.id, game]));
  for (const pick of listRecordedPicks(db)) {
    if (pick.gradedAt) continue;
    const game = byId.get(pick.gameId);
    if (!game || game.status !== "final" || game.homeScore == null || game.awayScore == null) continue;
    const favored = pick.favored === "even" ? null : pick.favored;
    gradeRecordedOnce(
      db,
      pick.gameId,
      nowIso,
      gradeOutcome(favored, winnerSide(game.homeScore, game.awayScore)),
      game.homeScore,
      game.awayScore,
    );
  }
}

export function recordResponse(db: AppDatabase, now = new Date()): RecordResponse {
  settleRecordedPicks(db, now);
  const { games, teams, analyses } = loadAnalyses(db);
  const picks = listRecordedPicks(db);
  const liveIds = new Set(picks.map((pick) => pick.gameId));
  const backtestRows = games.flatMap((game) => {
    if (liveIds.has(game.id)) return [];
    const row = backtestRow(game, teams, analyses.get(game.id)?.model.homeWinProb);
    return row ? [row] : [];
  });
  const liveRows = picks.flatMap((pick) => {
    const row = liveRow(pick, games, teams);
    return row ? [row] : [];
  });
  return {
    rule: NHL_RESULT_RULE,
    backtest: { ...buckets(backtestRows), even: backtestEven(games, liveIds, teams, analyses) },
    live: {
      ...buckets(liveRows),
      pending: picks.filter((pick) => pick.gradedAt == null).length,
      even: picks.filter((pick) => pick.favored === "even" && pick.gradedAt != null).length,
    },
    months: monthsOf([...backtestRows, ...liveRows]),
    recent: [...backtestRows, ...liveRows]
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt) || b.id.localeCompare(a.id))
      .slice(0, 30),
  };
}

function backtestRow(
  game: StoredGame,
  teams: Map<string, StoredTeam>,
  homeWinProb: number | undefined,
): RecordRow | null {
  if (game.status !== "final" || game.homeScore == null || game.awayScore == null || homeWinProb == null) {
    return null;
  }
  const favored = favoredSide(homeWinProb);
  const success = gradeOutcome(favored, winnerSide(game.homeScore, game.awayScore));
  if (!favored || success == null) return null;
  return rowFrom(game, teams, {
    favored,
    homeWinProb,
    success,
    source: "backtest",
    recordedAt: null,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
  });
}

function liveRow(pick: RecordedPick, games: StoredGame[], teams: Map<string, StoredTeam>): RecordRow | null {
  if (pick.gradedAt == null || pick.success == null || pick.homeScore == null || pick.awayScore == null) return null;
  if (pick.favored === "even") return null;
  const game = games.find((item) => item.id === pick.gameId);
  if (!game) return null;
  return rowFrom(game, teams, {
    favored: pick.favored,
    homeWinProb: pick.homeWinProb,
    success: pick.success,
    source: "live",
    recordedAt: pick.recordedAt,
    homeScore: pick.homeScore,
    awayScore: pick.awayScore,
  });
}

function rowFrom(
  game: StoredGame,
  teams: Map<string, StoredTeam>,
  extra: {
    favored: "home" | "away";
    homeWinProb: number;
    success: boolean;
    source: "backtest" | "live";
    recordedAt: string | null;
    homeScore: number;
    awayScore: number;
  },
): RecordRow | null {
  const home = teams.get(game.homeTeamId);
  const away = teams.get(game.awayTeamId);
  if (!home || !away) return null;
  return {
    id: game.id,
    league: game.league,
    startsAt: game.startsAt,
    awayAbbrev: away.abbrev,
    homeAbbrev: home.abbrev,
    awayName: away.name,
    homeName: home.name,
    awayScore: extra.awayScore,
    homeScore: extra.homeScore,
    favored: extra.favored,
    favoredAbbrev: extra.favored === "home" ? home.abbrev : away.abbrev,
    homeWinProb: extra.homeWinProb,
    success: extra.success,
    source: extra.source,
    recordedAt: extra.recordedAt,
  };
}

function backtestEven(
  games: StoredGame[],
  liveIds: Set<string>,
  teams: Map<string, StoredTeam>,
  analyses: ReturnType<typeof analyzeSchedule>,
): number {
  return games.filter((game) => {
    if (liveIds.has(game.id) || game.status !== "final" || game.homeScore == null || game.awayScore == null) {
      return false;
    }
    if (!teams.has(game.homeTeamId) || !teams.has(game.awayTeamId)) return false;
    const prob = analyses.get(game.id)?.model.homeWinProb;
    return prob != null && favoredSide(prob) == null;
  }).length;
}

function buckets(rows: RecordRow[]): { all: RecordCounts; nba: RecordCounts; nhl: RecordCounts } {
  return {
    all: counts(rows),
    nba: counts(rows.filter((row) => row.league === "nba")),
    nhl: counts(rows.filter((row) => row.league === "nhl")),
  };
}

function counts(rows: RecordRow[]): RecordCounts {
  const successful = rows.filter((row) => row.success).length;
  const total = rows.length;
  return {
    total,
    successful,
    unsuccessful: total - successful,
    rate: total === 0 ? null : successful / total,
  };
}

function monthsOf(rows: RecordRow[]): RecordMonth[] {
  const groups = new Map<string, RecordRow[]>();
  for (const row of rows) {
    const month = monthKey(row.startsAt);
    groups.set(month, [...(groups.get(month) ?? []), row]);
  }
  return [...groups.keys()].sort().map((month) => {
    const group = groups.get(month) ?? [];
    return {
      month,
      label: monthLabel(month),
      backtest: counts(group.filter((row) => row.source === "backtest")),
      live: counts(group.filter((row) => row.source === "live")),
    };
  });
}

function monthKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(iso));
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T12:00:00Z`));
}

function loadAnalyses(db: AppDatabase): {
  games: StoredGame[];
  teams: Map<string, StoredTeam>;
  analyses: ReturnType<typeof analyzeSchedule>;
} {
  const teams = new Map(listTeams(db).map((team) => [team.id, team]));
  const games = listGames(db);
  const injuryLeagues = new Set(
    listSources(db)
      .filter((source) => source.kind === "injuries" && source.mode !== "blocked")
      .map((source) => source.league)
      .filter((league): league is League => league === "nba" || league === "nhl"),
  );
  const analyses = analyzeSchedule(
    games.map((game) => ({
      id: game.id,
      league: game.league,
      startsAt: game.startsAt,
      status: game.status,
      neutral: game.neutral,
      endedIn: game.endedIn,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
    })),
    listInjuries(db).map((injury) => ({ teamId: injury.teamId, status: injury.status })),
    injuryLeagues,
  );
  return { games, teams, analyses };
}
