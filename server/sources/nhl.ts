import { fetchJson } from "../http";
import { teamId } from "../names";
import type { NormalizedGame, NormalizedSnapshot } from "../normalized";
import { HISTORY_WEEK_CAP, historyBounds } from "../history";
import { addDays, asRec, bool, num, sleep, str } from "../parse";
import type { GameStatus } from "../../shared/types";
import type { EndedIn } from "../normalized";

const SOURCE_NAME = "NHL Web API";
const STANDINGS_URL = "https://www.nhl.com/standings";

export function mapNhlGame(raw: unknown): NormalizedGame | null {
  const game = asRec(raw);
  if (!game) return null;
  const gameType = num(game.gameType);
  if (gameType !== 2 && gameType !== 3) return null;
  const away = asRec(game.awayTeam);
  const home = asRec(game.homeTeam);
  const awayAbbrev = str(away?.abbrev);
  const homeAbbrev = str(home?.abbrev);
  const startsAt = str(game.startTimeUTC);
  const id = num(game.id) ?? str(game.id);
  if (!away || !home || !awayAbbrev || !homeAbbrev || !startsAt || id == null) return null;

  const state = str(game.gameState) ?? "FUT";
  const status = nhlStatus(state);
  const endedIn = ended(game, status);
  const scores = status === "final" || status === "live";
  const venue = str(asRec(game.venue)?.default);
  const link = str(game.gameCenterLink);

  return {
    id: `nhl-${id}`,
    league: "nhl",
    startsAt,
    status,
    season: str(game.season) ?? "",
    venue,
    neutral: bool(game.neutralSite),
    endedIn,
    homeAbbrev: homeAbbrev.toUpperCase(),
    homeName: teamName(home, homeAbbrev),
    homeLogo: str(home.logo),
    awayAbbrev: awayAbbrev.toUpperCase(),
    awayName: teamName(away, awayAbbrev),
    awayLogo: str(away.logo),
    homeScore: scores ? num(home.score) : null,
    awayScore: scores ? num(away.score) : null,
    sourceName: SOURCE_NAME,
    sourceUrl: link ? `https://www.nhl.com${link}` : "https://www.nhl.com/schedule",
  };
}

export function mapNhlStanding(raw: unknown, fetchedAt: string): NormalizedSnapshot | null {
  const row = asRec(raw);
  if (!row) return null;
  const abbrev = str(row.teamAbbrev)?.toUpperCase();
  const name = str(row.teamName);
  if (!abbrev || !name) return null;
  const wins = num(row.wins);
  const losses = num(row.losses);
  if (wins == null || losses == null) return null;
  return {
    teamId: teamId("nhl", abbrev),
    league: "nhl",
    abbrev,
    name,
    logoUrl: str(row.teamLogo),
    teamUrl: null,
    wins,
    losses,
    otLosses: num(row.otLosses),
    tablePoints: num(row.points),
    winPct: num(row.winPctg),
    pointsPct: num(row.pointPctg),
    scoreFor: num(row.goalFor),
    scoreAgainst: num(row.goalAgainst),
    scoreDiff: num(row.goalDifferential),
    gamesPlayed: num(row.gamesPlayed),
    rank: num(row.leagueSequence),
    rankScope: "league",
    conference: str(row.conferenceName),
    division: str(row.divisionName),
    sourceName: "NHL Web API — tabulka",
    sourceUrl: STANDINGS_URL,
    fetchedAt,
  };
}

export async function fetchNhlBundle(now = new Date()): Promise<{
  games: NormalizedGame[];
  snapshots: NormalizedSnapshot[];
}> {
  const games = new Map<string, NormalizedGame>();
  const bounds = historyBounds(now);
  let cursor = bounds.start;
  const seen = new Set<string>();

  while (seen.size < HISTORY_WEEK_CAP && cursor <= bounds.end) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const payload = await fetchJson(`https://api-web.nhle.com/v1/schedule/${cursor}`);
    const record = asRec(payload);
    const weeks = Array.isArray(record?.gameWeek) ? record.gameWeek : [];
    for (const week of weeks) {
      const gamesRaw = asRec(week)?.games;
      if (!Array.isArray(gamesRaw)) continue;
      for (const item of gamesRaw) {
        const mapped = mapNhlGame(item);
        if (mapped) games.set(mapped.id, mapped);
      }
    }
    const next = str(record?.nextStartDate);
    cursor = next && next > cursor ? next : addDays(cursor, 7);
    await sleep(120);
  }

  const standings = await fetchJson("https://api-web.nhle.com/v1/standings/now");
  const fetchedAt = new Date().toISOString();
  const rows = asRec(standings)?.standings;
  const snapshots: NormalizedSnapshot[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const mapped = mapNhlStanding(row, fetchedAt);
      if (mapped) snapshots.push(mapped);
    }
  }
  if (games.size === 0) {
    throw new Error("NHL API nevrátilo žádné zápasy");
  }
  return { games: [...games.values()], snapshots };
}

function teamName(team: Record<string, unknown>, abbrev: string): string {
  const full = str(team.teamName) ?? str(team.commonName);
  const place = str(team.placeName);
  const common = str(team.commonName);
  if (place && common) return `${place} ${common}`;
  return full ?? abbrev;
}

function nhlStatus(state: string): GameStatus {
  if (state === "OFF" || state === "FINAL") return "final";
  if (state === "LIVE" || state === "CRIT") return "live";
  if (state === "POSTPONED" || state === "PPD" || state === "CNCL") return "postponed";
  return "scheduled";
}

function ended(game: Record<string, unknown>, status: GameStatus): EndedIn | null {
  const last = str(asRec(game.gameOutcome)?.lastPeriodType);
  if (last === "OT" || last === "SO" || last === "REG") return last;
  return status === "final" ? "REG" : null;
}
