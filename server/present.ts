import type {
  DataMode,
  Factor,
  HistoryWindow,
  InjuryNote,
  MatchDetail,
  MatchSummary,
  Snapshot,
  StatusResponse,
  TeamBrief,
} from "../shared/types";
import type { GameAnalysis } from "./analyze";
import { analyzeSchedule } from "./analyze";
import { buildMatchCharts } from "./charts";
import { HISTORY_DAYS } from "./history";
import {
  countGames,
  distinctOrigins,
  getMeta,
  listGames,
  listInjuries,
  listSnapshots,
  listSources,
  listTeams,
  type AppDatabase,
} from "./db";
import { isRefreshing } from "./ingest-state";
import {
  assumptionLines,
  FORMULA,
  INITIAL_ELO,
  type ModelResult,
} from "./model";
import type { StoredGame, StoredInjury, StoredSnapshot, StoredTeam } from "./normalized";

const SNAPSHOT_NOTE =
  "Tabulka je poslední stažené veřejné hodnocení, ne archiv k času výkopu. Pravděpodobnost se z ní nepočítá. Elo a forma berou jen výsledky před zápasem.";

const INJURY_NOTE =
  "Seznam absencí je aktuální veřejný snímek. U odehraného zápasu do pravděpodobnosti nevstupuje, protože neznáme sestavu před výkopem.";

export function statusOf(db: AppDatabase): StatusResponse {
  const origins = distinctOrigins(db);
  const mode: DataMode =
    origins.length === 0
      ? "empty"
      : origins.every((origin) => origin === "live")
        ? "live"
        : origins.every((origin) => origin === "sample")
          ? "sample"
          : "mixed";
  return {
    refreshing: isRefreshing(),
    gameCount: countGames(db),
    nbaGames: countGames(db, "nba"),
    nhlGames: countGames(db, "nhl"),
    lastIngestAt: getMeta(db, "last_ingest_at"),
    mode,
    warnings: readWarnings(db),
    history: historyWindow(db),
  };
}

export function matchesResponse(db: AppDatabase): MatchSummary[] {
  const bundle = loadBundle(db);
  return bundle.games.map((game) => summarize(game, bundle));
}

export function matchResponse(db: AppDatabase, id: string): MatchDetail | null {
  const bundle = loadBundle(db, id);
  const game = bundle.games.find((item) => item.id === id);
  if (!game) return null;
  const summary = summarize(game, bundle);
  const analysis = bundle.analyses.get(game.id);
  const homeSnap = bundle.snapshots.get(game.homeTeamId) ?? null;
  const awaySnap = bundle.snapshots.get(game.awayTeamId) ?? null;
  return {
    ...summary,
    season: game.season,
    homeSnapshot: homeSnap ? toSnapshot(homeSnap) : null,
    awaySnapshot: awaySnap ? toSnapshot(awaySnap) : null,
    homeForm: (analysis?.formHome ?? []).map((item) => ({
      gameId: item.gameId,
      startsAt: item.startsAt,
      opponentAbbrev: abbrev(bundle.teams, item.opponentId),
      opponentName: nameOf(bundle.teams, item.opponentId),
      teamScore: item.teamScore,
      opponentScore: item.opponentScore,
      result: item.result,
    })),
    awayForm: (analysis?.formAway ?? []).map((item) => ({
      gameId: item.gameId,
      startsAt: item.startsAt,
      opponentAbbrev: abbrev(bundle.teams, item.opponentId),
      opponentName: nameOf(bundle.teams, item.opponentId),
      teamScore: item.teamScore,
      opponentScore: item.opponentScore,
      result: item.result,
    })),
    h2h: (analysis?.h2h ?? []).map((item) => ({
      gameId: item.gameId,
      startsAt: item.startsAt,
      homeAbbrev: abbrev(bundle.teams, item.homeTeamId),
      awayAbbrev: abbrev(bundle.teams, item.awayTeamId),
      homeScore: item.homeScore,
      awayScore: item.awayScore,
      winnerTeamId: item.winnerTeamId,
    })),
    homeInjuries: injuriesFor(bundle.injuries, game.homeTeamId),
    awayInjuries: injuriesFor(bundle.injuries, game.awayTeamId),
    prediction: predictionOf(game.league, game.status, analysis),
    injuryNote: INJURY_NOTE,
    snapshotNote: SNAPSHOT_NOTE,
    charts: analysis
      ? buildMatchCharts({
          league: game.league,
          homeAbbrev: summary.home.abbrev,
          awayAbbrev: summary.away.abbrev,
          neutral: game.neutral,
          model: analysis.model,
          formHome: (analysis.formHome ?? []).map((item) => ({
            opponentAbbrev: abbrev(bundle.teams, item.opponentId),
            teamScore: item.teamScore,
            opponentScore: item.opponentScore,
          })),
          formAway: (analysis.formAway ?? []).map((item) => ({
            opponentAbbrev: abbrev(bundle.teams, item.opponentId),
            teamScore: item.teamScore,
            opponentScore: item.opponentScore,
          })),
          h2h: (analysis.h2h ?? []).map((item) => ({
            startsAt: item.startsAt,
            homeAbbrev: abbrev(bundle.teams, item.homeTeamId),
            awayAbbrev: abbrev(bundle.teams, item.awayTeamId),
            homeScore: item.homeScore,
            awayScore: item.awayScore,
          })),
          chart: analysis.chart,
        })
      : [],
    history: historyWindow(db),
  };
}

export function sourcesResponse(db: AppDatabase) {
  return listSources(db);
}

function loadBundle(db: AppDatabase, focusId?: string) {
  const teams = new Map(listTeams(db).map((team) => [team.id, team]));
  const games = listGames(db);
  const snapshots = new Map(listSnapshots(db).map((snap) => [snap.teamId, snap]));
  const injuries = listInjuries(db);
  const injuryLeagues = new Set(
    listSources(db)
      .filter((source) => source.kind === "injuries" && source.mode !== "blocked")
      .map((source) => source.league)
      .filter((league): league is "nba" | "nhl" => league === "nba" || league === "nhl"),
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
    injuries.map((injury) => ({ teamId: injury.teamId, status: injury.status })),
    injuryLeagues,
    focusId,
  );
  return { teams, games, snapshots, injuries, analyses };
}

function summarize(game: StoredGame, bundle: ReturnType<typeof loadBundle>): MatchSummary {
  const analysis = bundle.analyses.get(game.id);
  return {
    id: game.id,
    league: game.league,
    startsAt: game.startsAt,
    status: game.status,
    venue: game.venue,
    neutral: game.neutral,
    home: brief(bundle.teams, game.homeTeamId),
    away: brief(bundle.teams, game.awayTeamId),
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    origin: game.origin,
    sourceName: game.sourceName,
    sourceUrl: game.sourceUrl,
    modelHomeWinProb: analysis?.model.homeWinProb ?? null,
    timing: game.status === "final" ? "retro" : game.status === "live" ? "live" : "prematch",
  };
}

function predictionOf(
  league: MatchSummary["league"],
  status: MatchSummary["status"],
  analysis: GameAnalysis | undefined,
) {
  const model = analysis?.model;
  return {
    homeWinProb: model?.homeWinProb ?? 0.5,
    awayWinProb: model ? 1 - model.homeWinProb : 0.5,
    scoreLeanHome: model?.scoreLeanHome ?? 0,
    scoreLeanAway: model?.scoreLeanAway ?? 0,
    scoreUnit: league === "nba" ? ("body" as const) : ("góly" as const),
    factors: model ? factorsOf(league, status, model) : [],
    assumptions: assumptionLines(),
    formula: FORMULA,
    eloHome: analysis?.eloHome ?? 1500,
    eloAway: analysis?.eloAway ?? 1500,
  };
}

function factorsOf(league: "nba" | "nhl", status: MatchSummary["status"], model: ModelResult): Factor[] {
  const { home, elo, form, h2h, absence } = model.factors;
  return [
    {
      key: "home",
      label: "Domácí prostředí",
      logit: home.logit,
      used: home.used,
      detail: home.used
        ? `Domácí ${league === "nhl" ? "led" : "palubovka"} přidává ${home.homeEloAdv} Elo. Konstanta je zvolená ručně, není to kurz.`
        : "Neutrální hřiště. Domácí výhoda se nepočítá.",
    },
    {
      key: "elo",
      label: "Síla podle Elo",
      logit: elo.logit,
      used: true,
      detail: `Elo před zápasem, bez domácí výhody: domácí ${Math.round(elo.eloHome)}, hosté ${Math.round(elo.eloAway)}. Načtené okno začíná na ${INITIAL_ELO} a mezi sezónami se uvnitř okna neresetuje.`,
    },
    {
      key: "form",
      label: "Forma",
      logit: form.logit,
      used: form.used,
      detail: form.used
        ? `Průměrný rozdíl skóre z nejvýše pěti předchozích zápasů. Domácí ${marginText(form.homeAvg)}, hosté ${marginText(form.awayAvg)}.`
        : "Ani jeden tým nemá v načtených datech předchozí výsledek, forma se nepočítá.",
    },
    {
      key: "h2h",
      label: "Vzájemné zápasy",
      logit: h2h.logit,
      used: h2h.used,
      detail: h2h.used
        ? `${meetingLabel(h2h.games)}: aktuální domácí ${h2h.homeWins} výher, hosté ${h2h.awayWins}. Vzorek je malý, váha je proto nízká.`
        : h2h.games === 0
          ? "V načteném roce se týmy ještě nepotkaly."
          : "Zatím jen jeden společný zápas. Faktor se započte až od dvou, aby jeden výsledek nepřevážil.",
    },
    {
      key: "absence",
      label: "Absence",
      logit: absence.logit,
      used: absence.used,
      detail: absenceDetail(status, absence),
    },
  ];
}

function absenceDetail(
  status: MatchSummary["status"],
  absence: ModelResult["factors"]["absence"],
): string {
  if (!absence.used) {
    return status === "final"
      ? "Do zpětné analýzy se absence nezapočítávají. Máme jen dnešní seznam, ne stav před tímto zápasem."
      : "Seznam absencí se nepodařilo načíst, faktor je vypnutý.";
  }
  const total = absence.homeOut + absence.homePartial + absence.awayOut + absence.awayPartial;
  if (total === 0) return "Ve zdroji nejsou plné ani částečné absence.";
  return `Domácí: ${absence.homeOut} plných a ${absence.homePartial} částečných. Hosté: ${absence.awayOut} plných a ${absence.awayPartial} částečných. Plná absence posune logit o 0,06, částečná o 0,02. Důležitost hráče model nezná.`;
}

function marginText(value: number | null): string {
  if (value == null) return "bez zápasu (počítáno jako 0)";
  return `${new Intl.NumberFormat("cs-CZ", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value)} na zápas`;
}

function meetingLabel(count: number): string {
  if (count === 1) return "1 společný zápas";
  if (count < 5) return `${count} společné zápasy`;
  return `${count} společných zápasů`;
}

function brief(teams: Map<string, StoredTeam>, id: string): TeamBrief {
  const team = teams.get(id);
  return {
    id,
    abbrev: team?.abbrev ?? id,
    name: team?.name ?? id,
    logoUrl: team?.logoUrl ?? null,
    teamUrl: team?.teamUrl ?? null,
  };
}

function abbrev(teams: Map<string, StoredTeam>, id: string): string {
  return teams.get(id)?.abbrev ?? id;
}

function nameOf(teams: Map<string, StoredTeam>, id: string): string {
  return teams.get(id)?.name ?? id;
}

function toSnapshot(snap: StoredSnapshot): Snapshot {
  return {
    teamId: snap.teamId,
    wins: snap.wins,
    losses: snap.losses,
    otLosses: snap.otLosses,
    tablePoints: snap.tablePoints,
    winPct: snap.winPct,
    pointsPct: snap.pointsPct,
    scoreFor: snap.scoreFor,
    scoreAgainst: snap.scoreAgainst,
    scoreDiff: snap.scoreDiff,
    gamesPlayed: snap.gamesPlayed,
    rank: snap.rank,
    rankScope: snap.rankScope,
    conference: snap.conference,
    division: snap.division,
    sourceName: snap.sourceName,
    sourceUrl: snap.sourceUrl,
    fetchedAt: snap.fetchedAt,
    origin: snap.origin,
  };
}

function injuriesFor(injuries: StoredInjury[], teamId: string): InjuryNote[] {
  return injuries
    .filter((injury) => injury.teamId === teamId)
    .map((injury) => ({
      playerName: injury.playerName,
      status: injury.status,
      detail: injury.detail,
      sourceName: injury.sourceName,
      sourceUrl: injury.sourceUrl,
      updatedAt: injury.updatedAt,
      origin: injury.origin,
    }));
}

function historyWindow(db: AppDatabase): HistoryWindow {
  const finals = listGames(db).filter((game) => game.status === "final");
  const dates = finals.map((game) => game.startsAt).sort();
  const requested = Number(getMeta(db, "history_days"));
  return {
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    finalGames: finals.length,
    nbaFinals: finals.filter((game) => game.league === "nba").length,
    nhlFinals: finals.filter((game) => game.league === "nhl").length,
    requestedDays: Number.isFinite(requested) && requested > 0 ? requested : HISTORY_DAYS,
    note:
      getMeta(db, "history_note") ??
      "Historie se teprve stahuje, nebo jsou v databázi jen krátká vzorová data.",
  };
}

function readWarnings(db: AppDatabase): string[] {
  const raw = getMeta(db, "warnings");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
