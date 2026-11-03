import type {
  AngleDay,
  AngleLine,
  AngleMarketId,
  AnglesResponse,
  League,
  MarketBacktest,
  MatchAngles,
} from "../shared/types";
import {
  countBoxes,
  countGames,
  getMeta,
  listBoxes,
  listGames,
  listTeams,
  type AppDatabase,
} from "./db";

export const ANGLE_DISCLAIMER = "Tohle je analýza zápasu, ne tip k sázce.";
export const ANGLE_RESPONSIBLE = "18+. Tohle není výzva k sázce. Sázení může škodit.";
export const ANGLE_NOTE =
  "Věta stojí na průměrech z načteného roku. Ukážeme jen typ, který v přepočtu před každým zápasem vycházel výrazně častěji než v polovině. Není to jistota.";
export const ANGLE_PP_NOTE =
  "V NHL jsou ve veřejném zápise střely a góly v přesilovce. Počet přesilovek tam není, proto jde o góly v přesilovce.";

const MIN_LEAGUE = 30;
const MIN_TEAM = 8;
const MIN_RECENT = 3;
const MIN_VENUE = 4;
const MIN_H2H = 2;
const MIN_BACKTEST = 80;
const MIN_RATE = 0.55;
const QUANTILE_GATE = 0.55;
const QUANTILE_OFFSET = 0.15;
const SIMILAR_Q = 0.05;
const MIN_SIMILAR = 30;
const WILSON_Z = 1.64;
const MIN_THRESHOLD = 1;

type Stat = "score" | "shots" | "pp";
type Unit = "body" | "goly" | "strely";
type Flavor = "score" | "shots" | "pp";
type Scope = "match" | "team";

type MarketDef = {
  id: AngleMarketId;
  league: League;
  scope: Scope;
  stat: Stat;
  label: string;
  unit: Unit;
  flavor: Flavor;
};

const MARKETS: MarketDef[] = [
  { id: "nba-total-points", league: "nba", scope: "match", stat: "score", label: "Celkové body", unit: "body", flavor: "score" },
  { id: "nba-team-points", league: "nba", scope: "team", stat: "score", label: "Body týmu", unit: "body", flavor: "score" },
  { id: "nhl-total-goals", league: "nhl", scope: "match", stat: "score", label: "Celkové góly", unit: "goly", flavor: "score" },
  { id: "nhl-team-goals", league: "nhl", scope: "team", stat: "score", label: "Góly týmu", unit: "goly", flavor: "score" },
  { id: "nhl-match-shots", league: "nhl", scope: "match", stat: "shots", label: "Střely v zápase", unit: "strely", flavor: "shots" },
  { id: "nhl-pp-goals", league: "nhl", scope: "match", stat: "pp", label: "Góly v přesilovce", unit: "goly", flavor: "pp" },
];

export type AngleGame = {
  id: string;
  league: League;
  startsAt: string;
  status: "scheduled" | "live" | "final" | "postponed";
  neutral: boolean;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number | null;
  awayScore: number | null;
  homeShots: number | null;
  awayShots: number | null;
  homePpGoals: number | null;
  awayPpGoals: number | null;
};

export type GradedLine = {
  gameId: string;
  market: AngleMarketId;
  subject: string;
  q: number;
  threshold: number;
  hit: boolean;
};

type TeamAcc = {
  sum: number;
  n: number;
  homeSum: number;
  homeN: number;
  awaySum: number;
  awayN: number;
  recent: number[];
  vs: Map<string, { sum: number; n: number }>;
};

type TeamView = {
  season: number;
  recent: number | null;
  venueAvg: number | null;
  h2h: number | null;
};

type PendingLine = {
  game: AngleGame;
  market: MarketDef;
  subject: string;
  q: number;
  threshold: number;
  awayAvg: number;
  homeAvg: number;
  teamName: string | null;
  teamAvg: number | null;
  venue: "home" | "away" | null;
  venueAvg: number | null;
};

export type EvaluateResult = {
  graded: GradedLine[];
  lines: AngleLine[];
  markets: MarketBacktest[];
};

export function wilsonLower(hits: number, n: number, z = WILSON_Z): number {
  if (n <= 0) return 0;
  const p = hits / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return (center - margin) / denom;
}

export function marketShown(hits: number, n: number): boolean {
  if (n < MIN_BACKTEST) return false;
  const rate = hits / n;
  return rate >= MIN_RATE && wilsonLower(hits, n) > 0.5;
}

export function proposeThreshold(
  prior: number[],
  estimate: number,
  minThreshold = MIN_THRESHOLD,
): { q: number; threshold: number } | null {
  if (prior.length === 0 || !Number.isFinite(estimate)) return null;
  const sorted = [...prior].sort((a, b) => a - b);
  return proposeSorted(sorted, estimate, minThreshold);
}

export function amountPhrase(value: number, unit: Unit): string {
  const shown = shownNumber(value);
  return `${formatNumber(shown.value)} ${unitWord(shown.value, unit, shown.integer)}`;
}

export function renderMatchStatement(input: {
  awayName: string;
  homeName: string;
  awayAvg: number;
  homeAvg: number;
  threshold: number;
  unit: Unit;
  flavor: Flavor;
}): string {
  const lead =
    input.flavor === "pp"
      ? `${input.awayName} dává v přesilovce průměrně ${amountPhrase(input.awayAvg, input.unit)} na zápas, ${input.homeName} ${formatNumber(shownNumber(input.homeAvg).value)}.`
      : `${input.awayName} má průměr ${amountPhrase(input.awayAvg, input.unit)} na zápas, ${input.homeName} ${formatNumber(shownNumber(input.homeAvg).value)}.`;
  const tail =
    input.flavor === "pp"
      ? `V utkání by mělo padnout aspoň ${amountPhrase(input.threshold, input.unit)} v přesilovce.`
      : input.flavor === "shots"
        ? `V utkání by mělo padnout aspoň ${amountPhrase(input.threshold, input.unit)}.`
        : `Ve vzájemném zápase by mělo padnout aspoň ${amountPhrase(input.threshold, input.unit)}.`;
  return `${lead} ${tail}`;
}

export function renderTeamStatement(input: {
  teamName: string;
  average: number;
  venue: "home" | "away" | null;
  venueAvg: number | null;
  threshold: number;
  unit: Unit;
}): string {
  const venueBit =
    input.venue && input.venueAvg != null
      ? ` ${input.venue === "home" ? "Doma" : "Venku"} je to ${amountPhrase(input.venueAvg, input.unit)}.`
      : "";
  return `${input.teamName} dává průměrně ${amountPhrase(input.average, input.unit)} na zápas.${venueBit} V tomhle zápase by měli dát aspoň ${amountPhrase(input.threshold, input.unit)}.`;
}

export function renderDetail(input: {
  confidence: number;
  confidenceHits: number;
  confidenceN: number;
  fallback: boolean;
  backtestRate: number;
  backtestHits: number;
  backtestN: number;
}): string {
  const back = `Tenhle typ věty v přepočtu za načtený rok vyšel v ${formatPct(input.backtestRate)} případů (${input.backtestHits} z ${input.backtestN}).`;
  if (input.fallback) return `Není to jistota. ${back}`;
  return `Není to jistota. U podobných vět to vyšlo v ${formatPct(input.confidence)} (${input.confidenceHits} z ${input.confidenceN}). ${back}`;
}

export function evaluateAngles(games: AngleGame[], now = new Date()): EvaluateResult {
  const ordered = [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const today = pragueDay(now);
  const teams = new Map<string, TeamAcc>();
  const pools = new Map<string, number[]>();
  const pairs = new Map<string, { sum: number; n: number }>();
  const graded: GradedLine[] = [];
  const pending: PendingLine[] = [];

  for (const game of ordered) {
    const upcoming = game.status === "scheduled" && pragueDay(game.startsAt) >= today;
    if (game.status === "final" || upcoming) {
      consider(game, game.status === "final", upcoming, teams, pools, pairs, graded, pending);
    }
    if (game.status === "final") record(game, teams, pools, pairs);
  }

  const markets = MARKETS.map((market) => {
    const rows = graded.filter((row) => row.market === market.id);
    const hits = rows.reduce((sum, row) => sum + (row.hit ? 1 : 0), 0);
    return {
      market: market.id,
      league: market.league,
      label: market.label,
      hits,
      n: rows.length,
      rate: rows.length > 0 ? hits / rows.length : null,
      shown: marketShown(hits, rows.length),
    };
  });
  const shown = new Set(markets.filter((market) => market.shown).map((market) => market.market));
  const lines = pending.flatMap((line) => {
    if (!shown.has(line.market.id)) return [];
    const built = toLine(line, graded);
    return built ? [built] : [];
  });

  return { graded, lines, markets };
}

export function anglesResponse(db: AppDatabase, now = new Date()): AnglesResponse {
  const report = cachedReport(db, now);
  return {
    disclaimer: ANGLE_DISCLAIMER,
    responsible: ANGLE_RESPONSIBLE,
    note: ANGLE_NOTE,
    ppNote: ANGLE_PP_NOTE,
    coverageNote: report.coverageNote,
    days: report.days,
    markets: report.markets,
  };
}

export function matchAngles(
  db: AppDatabase,
  game: { id: string; status: AngleGame["status"]; startsAt: string; league: League },
  now = new Date(),
): MatchAngles {
  const report = cachedReport(db, now);
  const show = game.status === "scheduled" && pragueDay(game.startsAt) >= pragueDay(now);
  return {
    show,
    lines: show ? (report.byGame.get(game.id) ?? []) : [],
    disclaimer: ANGLE_DISCLAIMER,
    responsible: ANGLE_RESPONSIBLE,
    note: ANGLE_NOTE,
    ppNote: game.league === "nhl" ? ANGLE_PP_NOTE : "",
  };
}

type Cached = {
  key: string;
  days: AngleDay[];
  markets: MarketBacktest[];
  byGame: Map<string, AngleLine[]>;
  coverageNote: string | null;
};

let cache: Cached | null = null;

function cachedReport(db: AppDatabase, now: Date): Cached {
  const key = `${countGames(db)}:${countBoxes(db)}:${getMeta(db, "last_ingest_at") ?? ""}:${pragueDay(now)}`;
  if (cache?.key === key) return cache;
  const games = loadAngleGames(db);
  const evaluated = evaluateAngles(games, now);
  const byGame = new Map<string, AngleLine[]>();
  const days: AngleDay[] = [];
  for (const line of evaluated.lines) {
    const date = pragueDay(line.startsAt);
    const existing = days.find((day) => day.date === date);
    if (existing) existing.lines.push(line);
    else days.push({ date, label: dayTitle(date), lines: [line] });
    byGame.set(line.gameId, [...(byGame.get(line.gameId) ?? []), line]);
  }
  const nhlFinals = games.filter((game) => game.league === "nhl" && game.status === "final").length;
  const shotsKnown = games.filter(
    (game) => game.league === "nhl" && game.status === "final" && game.homeShots != null && game.awayShots != null,
  ).length;
  const coverageNote =
    nhlFinals > 0 && shotsKnown < nhlFinals * 0.9
      ? "Část zápisů NHL se ještě doplňuje. Střely a góly v přesilovce se ukážou, až budou čísla za načtený rok."
      : null;
  cache = { key, days, markets: evaluated.markets, byGame, coverageNote };
  return cache;
}

function loadAngleGames(db: AppDatabase): AngleGame[] {
  const teams = new Map(listTeams(db).map((team) => [team.id, team]));
  const boxes = new Map(listBoxes(db).map((box) => [box.gameId, box]));
  return listGames(db).map((game) => {
    const home = teams.get(game.homeTeamId);
    const away = teams.get(game.awayTeamId);
    const box = boxes.get(game.id);
    return {
      id: game.id,
      league: game.league,
      startsAt: game.startsAt,
      status: game.status,
      neutral: game.neutral,
      homeId: game.homeTeamId,
      awayId: game.awayTeamId,
      homeName: home?.name || home?.abbrev || "Domácí",
      awayName: away?.name || away?.abbrev || "Hosté",
      homeAbbrev: home?.abbrev || "",
      awayAbbrev: away?.abbrev || "",
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      homeShots: box?.homeShots ?? null,
      awayShots: box?.awayShots ?? null,
      homePpGoals: box?.homePpGoals ?? null,
      awayPpGoals: box?.awayPpGoals ?? null,
    };
  });
}

function consider(
  game: AngleGame,
  grade: boolean,
  upcoming: boolean,
  teams: Map<string, TeamAcc>,
  pools: Map<string, number[]>,
  pairs: Map<string, { sum: number; n: number }>,
  graded: GradedLine[],
  pending: PendingLine[],
): void {
  for (const market of MARKETS) {
    if (market.league !== game.league) continue;
    if (market.scope === "match") {
      const home = viewTeam(teams, game.homeId, market.stat, game.awayId, game.neutral ? null : "home");
      const away = viewTeam(teams, game.awayId, market.stat, game.homeId, game.neutral ? null : "away");
      if (!home || !away) continue;
      const pool = pools.get(poolKey(game.league, market.stat, "match")) ?? [];
      if (pool.length < MIN_LEAGUE) continue;
      const pair = pairs.get(pairKey(market.stat, game.homeId, game.awayId));
      const parts = [home.season + away.season];
      if (home.recent != null && away.recent != null) parts.push(home.recent + away.recent);
      if (home.venueAvg != null && away.venueAvg != null) parts.push(home.venueAvg + away.venueAvg);
      if (pair && pair.n >= MIN_H2H) parts.push(pair.sum / pair.n);
      const proposal = proposeSorted(pool, mean(parts), MIN_THRESHOLD);
      if (!proposal || proposal.threshold >= shownNumber(home.season).value + shownNumber(away.season).value) continue;
      const actual = matchValue(game, market.stat);
      if (grade) {
        if (actual == null) continue;
        graded.push({
          gameId: game.id,
          market: market.id,
          subject: "match",
          q: proposal.q,
          threshold: proposal.threshold,
          hit: actual >= proposal.threshold,
        });
      } else if (upcoming) {
        pending.push({
          game,
          market,
          subject: "match",
          q: proposal.q,
          threshold: proposal.threshold,
          awayAvg: away.season,
          homeAvg: home.season,
          teamName: null,
          teamAvg: null,
          venue: null,
          venueAvg: null,
        });
      }
      continue;
    }
    for (const side of ["away", "home"] as const) {
      const teamId = side === "home" ? game.homeId : game.awayId;
      const opponentId = side === "home" ? game.awayId : game.homeId;
      const venue = game.neutral ? null : side;
      const view = viewTeam(teams, teamId, market.stat, opponentId, venue);
      if (!view) continue;
      const pool = pools.get(poolKey(game.league, market.stat, "team")) ?? [];
      if (pool.length < MIN_LEAGUE) continue;
      const parts = [view.season];
      if (view.recent != null) parts.push(view.recent);
      if (view.venueAvg != null) parts.push(view.venueAvg);
      if (view.h2h != null) parts.push(view.h2h);
      const proposal = proposeSorted(pool, mean(parts), MIN_THRESHOLD);
      if (!proposal || proposal.threshold >= shownNumber(view.season).value) continue;
      const actual = sideValue(game, market.stat, side);
      if (grade) {
        if (actual == null) continue;
        graded.push({
          gameId: game.id,
          market: market.id,
          subject: teamId,
          q: proposal.q,
          threshold: proposal.threshold,
          hit: actual >= proposal.threshold,
        });
      } else if (upcoming) {
        pending.push({
          game,
          market,
          subject: teamId,
          q: proposal.q,
          threshold: proposal.threshold,
          awayAvg: 0,
          homeAvg: 0,
          teamName: side === "home" ? game.homeName : game.awayName,
          teamAvg: view.season,
          venue,
          venueAvg: view.venueAvg,
        });
      }
    }
  }
}

function record(
  game: AngleGame,
  teams: Map<string, TeamAcc>,
  pools: Map<string, number[]>,
  pairs: Map<string, { sum: number; n: number }>,
): void {
  for (const stat of ["score", "shots", "pp"] as const) {
    const home = sideValue(game, stat, "home");
    const away = sideValue(game, stat, "away");
    if (home == null || away == null) continue;
    addSorted(poolFor(pools, poolKey(game.league, stat, "match")), home + away);
    addSorted(poolFor(pools, poolKey(game.league, stat, "team")), home);
    addSorted(poolFor(pools, poolKey(game.league, stat, "team")), away);
    addTeam(teams, game.homeId, stat, game.awayId, home, game.neutral ? null : "home");
    addTeam(teams, game.awayId, stat, game.homeId, away, game.neutral ? null : "away");
    const key = pairKey(stat, game.homeId, game.awayId);
    const pair = pairs.get(key) ?? { sum: 0, n: 0 };
    pair.sum += home + away;
    pair.n += 1;
    pairs.set(key, pair);
  }
}

function viewTeam(
  teams: Map<string, TeamAcc>,
  teamId: string,
  stat: Stat,
  opponentId: string,
  venue: "home" | "away" | null,
): TeamView | null {
  const acc = teams.get(teamKey(teamId, stat));
  if (!acc || acc.n < MIN_TEAM) return null;
  const h2h = acc.vs.get(opponentId);
  return {
    season: acc.sum / acc.n,
    recent: acc.recent.length >= MIN_RECENT ? mean(acc.recent) : null,
    venueAvg:
      venue === "home" && acc.homeN >= MIN_VENUE
        ? acc.homeSum / acc.homeN
        : venue === "away" && acc.awayN >= MIN_VENUE
          ? acc.awaySum / acc.awayN
          : null,
    h2h: h2h && h2h.n >= MIN_H2H ? h2h.sum / h2h.n : null,
  };
}

function addTeam(
  teams: Map<string, TeamAcc>,
  teamId: string,
  stat: Stat,
  opponentId: string,
  value: number,
  venue: "home" | "away" | null,
): void {
  const key = teamKey(teamId, stat);
  const acc: TeamAcc = teams.get(key) ?? {
    sum: 0,
    n: 0,
    homeSum: 0,
    homeN: 0,
    awaySum: 0,
    awayN: 0,
    recent: [],
    vs: new Map(),
  };
  acc.sum += value;
  acc.n += 1;
  if (venue === "home") {
    acc.homeSum += value;
    acc.homeN += 1;
  } else if (venue === "away") {
    acc.awaySum += value;
    acc.awayN += 1;
  }
  acc.recent.push(value);
  if (acc.recent.length > 5) acc.recent.shift();
  const vs = acc.vs.get(opponentId) ?? { sum: 0, n: 0 };
  vs.sum += value;
  vs.n += 1;
  acc.vs.set(opponentId, vs);
  teams.set(key, acc);
}

function toLine(line: PendingLine, graded: GradedLine[]): AngleLine | null {
  const rows = graded.filter((row) => row.market === line.market.id);
  const hits = rows.reduce((sum, row) => sum + (row.hit ? 1 : 0), 0);
  const similar = rows.filter((row) => row.q >= line.q - SIMILAR_Q);
  const used = similar.length >= MIN_SIMILAR ? similar : rows;
  const confidenceHits = used.reduce((sum, row) => sum + (row.hit ? 1 : 0), 0);
  const confidence = used.length > 0 ? confidenceHits / used.length : 0;
  if (confidence < MIN_RATE) return null;
  if (used.length >= MIN_BACKTEST && wilsonLower(confidenceHits, used.length) <= 0.5) return null;
  const text =
    line.market.scope === "match"
      ? renderMatchStatement({
          awayName: line.game.awayName,
          homeName: line.game.homeName,
          awayAvg: line.awayAvg,
          homeAvg: line.homeAvg,
          threshold: line.threshold,
          unit: line.market.unit,
          flavor: line.market.flavor,
        })
      : renderTeamStatement({
          teamName: line.teamName ?? "",
          average: line.teamAvg ?? 0,
          venue: line.venue,
          venueAvg: line.venueAvg,
          threshold: line.threshold,
          unit: line.market.unit,
        });
  return {
    id: `${line.game.id}:${line.market.id}:${line.subject}`,
    gameId: line.game.id,
    league: line.game.league,
    market: line.market.id,
    marketLabel: line.market.label,
    startsAt: line.game.startsAt,
    awayAbbrev: line.game.awayAbbrev,
    homeAbbrev: line.game.homeAbbrev,
    awayName: line.game.awayName,
    homeName: line.game.homeName,
    text,
    detail: renderDetail({
      confidence,
      confidenceHits,
      confidenceN: used.length,
      fallback: similar.length < MIN_SIMILAR || used.length === rows.length,
      backtestRate: rows.length > 0 ? hits / rows.length : 0,
      backtestHits: hits,
      backtestN: rows.length,
    }),
  };
}

function proposeSorted(
  sorted: number[],
  estimate: number,
  minThreshold: number,
): { q: number; threshold: number } | null {
  if (sorted.length === 0 || !Number.isFinite(estimate)) return null;
  const below = lowerBound(sorted, estimate);
  const equal = upperBound(sorted, estimate) - below;
  const q = (below + equal * 0.5) / sorted.length;
  if (q < QUANTILE_GATE) return null;
  const index = Math.floor(Math.min(1, Math.max(0, q - QUANTILE_OFFSET)) * (sorted.length - 1));
  let threshold = Math.floor(sorted[index] ?? 0);
  if (threshold >= estimate) threshold = Math.floor(estimate) - 1;
  if (threshold < minThreshold) return null;
  return { q, threshold };
}

function sideValue(game: AngleGame, stat: Stat, side: "home" | "away"): number | null {
  if (stat === "score") return side === "home" ? game.homeScore : game.awayScore;
  if (stat === "shots") return side === "home" ? game.homeShots : game.awayShots;
  return side === "home" ? game.homePpGoals : game.awayPpGoals;
}

function matchValue(game: AngleGame, stat: Stat): number | null {
  const home = sideValue(game, stat, "home");
  const away = sideValue(game, stat, "away");
  if (home == null || away == null) return null;
  return home + away;
}

function poolKey(league: League, stat: Stat, scope: Scope): string {
  return `${league}|${stat}|${scope}`;
}

function teamKey(teamId: string, stat: Stat): string {
  return `${teamId}|${stat}`;
}

function pairKey(stat: Stat, homeId: string, awayId: string): string {
  return homeId < awayId ? `${stat}|${homeId}|${awayId}` : `${stat}|${awayId}|${homeId}`;
}

function poolFor(pools: Map<string, number[]>, key: string): number[] {
  const existing = pools.get(key);
  if (existing) return existing;
  const created: number[] = [];
  pools.set(key, created);
  return created;
}

function addSorted(target: number[], value: number): void {
  let lo = 0;
  let hi = target.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (target[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  target.splice(lo, 0, value);
}

function lowerBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function shownNumber(value: number): { value: number; integer: boolean } {
  const rounded = Math.round(value * 10) / 10;
  const integer = Math.abs(rounded - Math.round(rounded)) < 0.001;
  return { value: integer ? Math.round(rounded) : rounded, integer };
}

function formatNumber(value: number): string {
  const integer = Math.abs(value - Math.round(value)) < 0.001;
  return new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: integer ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPct(rate: number): string {
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(rate * 100)} %`;
}

function unitWord(value: number, unit: Unit, integer: boolean): string {
  if (!integer) {
    if (unit === "body") return "bodu";
    if (unit === "goly") return "gólu";
    return "střely";
  }
  const n = Math.abs(Math.round(value));
  const mod100 = n % 100;
  const mod10 = n % 10;
  const form: "one" | "few" | "many" =
    mod100 >= 11 && mod100 <= 14 ? "many" : mod10 === 1 ? "one" : mod10 >= 2 && mod10 <= 4 ? "few" : "many";
  const table = {
    body: { one: "bod", few: "body", many: "bodů" },
    goly: { one: "gól", few: "góly", many: "gólů" },
    strely: { one: "střela", few: "střely", many: "střel" },
  } as const;
  return table[unit][form];
}

export function pragueDay(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dayTitle(key: string): string {
  const label = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${key}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
