import type { League } from "../../shared/types";
import { fetchJson } from "../http";
import { slug, teamId } from "../names";
import type { NormalizedGame, NormalizedSnapshot, RawInjury } from "../normalized";
import type { EndedIn } from "../normalized";
import {
  addDays,
  asRec,
  bool,
  clip,
  compactDate,
  isoDate,
  num,
  seasonAnchor,
  sleep,
  str,
} from "../parse";
import { classifyAbsence } from "../model";
import type { GameStatus } from "../../shared/types";

const LEAGUE_PATH: Record<League, string> = {
  nba: "basketball/nba",
  nhl: "hockey/nhl",
};

export function mapEspnEvent(raw: unknown, league: League): NormalizedGame | null {
  const event = asRec(raw);
  if (!event) return null;
  const season = asRec(event.season);
  if (num(season?.type) === 1) return null;
  const competition = asRec(Array.isArray(event.competitions) ? event.competitions[0] : null);
  if (!competition) return null;
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = competitors.map(asRec).find((item) => item?.homeAway === "home");
  const away = competitors.map(asRec).find((item) => item?.homeAway === "away");
  const homeTeam = asRec(home?.team);
  const awayTeam = asRec(away?.team);
  const homeAbbrev = str(homeTeam?.abbreviation)?.toUpperCase();
  const awayAbbrev = str(awayTeam?.abbreviation)?.toUpperCase();
  const startsAt = str(event.date);
  const id = str(event.id);
  if (!home || !away || !homeTeam || !awayTeam || !homeAbbrev || !awayAbbrev || !startsAt || !id) {
    return null;
  }

  const type = asRec(asRec(event.status)?.type);
  const detail = `${str(type?.detail) ?? ""} ${str(type?.name) ?? ""}`;
  const status = espnStatus(type, detail);
  const showScore = status === "final" || status === "live";

  return {
    id: `${league}-${id}`,
    league,
    startsAt,
    status,
    season: str(season?.year) ?? "",
    venue: str(asRec(competition.venue)?.fullName),
    neutral: bool(competition.neutralSite),
    endedIn: endedIn(detail, status),
    homeAbbrev,
    homeName: str(homeTeam.displayName) ?? homeAbbrev,
    homeLogo: logoOf(homeTeam),
    awayAbbrev,
    awayName: str(awayTeam.displayName) ?? awayAbbrev,
    awayLogo: logoOf(awayTeam),
    homeScore: showScore ? num(home.score) : null,
    awayScore: showScore ? num(away.score) : null,
    sourceName: "ESPN public scoreboard",
    sourceUrl: eventUrl(event, league),
  };
}

export function mapEspnStandings(
  raw: unknown,
  league: League,
  fetchedAt: string,
): { snapshots: NormalizedSnapshot[]; espnIds: Map<string, string> } {
  const snapshots: NormalizedSnapshot[] = [];
  const espnIds = new Map<string, string>();
  const sourceUrl =
    league === "nba" ? "https://www.espn.com/nba/standings" : "https://www.espn.com/nhl/standings";

  const visit = (node: unknown, conference: string | null) => {
    const record = asRec(node);
    if (!record) return;
    const nextConference = str(record.name) ?? conference;
    const entries = asRec(record.standings)?.entries;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const mapped = mapStandingEntry(entry, league, nextConference, sourceUrl, fetchedAt);
        if (!mapped) continue;
        snapshots.push(mapped.snapshot);
        if (mapped.espnId) espnIds.set(mapped.espnId, mapped.snapshot.teamId);
      }
    }
    if (Array.isArray(record.children)) {
      for (const child of record.children) visit(child, nextConference);
    }
  };

  visit(raw, null);
  return { snapshots, espnIds };
}

export function mapEspnInjuries(raw: unknown, league: League): RawInjury[] {
  const groups = asRec(raw)?.injuries;
  if (!Array.isArray(groups)) return [];
  const fallback =
    league === "nba" ? "https://www.espn.com/nba/injuries" : "https://www.espn.com/nhl/injuries";
  const injuries: RawInjury[] = [];
  for (const group of groups) {
    const team = asRec(group);
    const teamName = str(team?.displayName);
    const espnTeamId = str(team?.id);
    if (!team || !teamName || !espnTeamId || !Array.isArray(team.injuries)) continue;
    for (const item of team.injuries) {
      const row = asRec(item);
      const athlete = asRec(row?.athlete);
      const playerName = str(athlete?.displayName);
      const status = str(row?.status);
      if (!row || !playerName || !status || classifyAbsence(status) === "none") continue;
      injuries.push({
        espnTeamId,
        teamName,
        playerName,
        playerKey: str(athlete?.id) ?? slug(playerName),
        status,
        detail: str(row.shortComment) ? clip(str(row.shortComment) as string) : null,
        sourceUrl: playerUrl(athlete) ?? fallback,
        updatedAt: str(row.date),
      });
    }
  }
  return injuries;
}

export async function fetchEspnGames(league: League, now = new Date()): Promise<NormalizedGame[]> {
  const start = seasonAnchor(now, league === "nba" ? "10-15" : "09-15");
  const end = addDays(isoDate(now), 8);
  const games = new Map<string, NormalizedGame>();
  let cursor = start;
  while (cursor <= end) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${LEAGUE_PATH[league]}/scoreboard?dates=${compactDate(cursor)}`;
    const payload = await fetchJson(url);
    const events = asRec(payload)?.events;
    if (Array.isArray(events)) {
      for (const event of events) {
        const mapped = mapEspnEvent(event, league);
        if (mapped) games.set(mapped.id, mapped);
      }
    }
    cursor = addDays(cursor, 1);
    await sleep(80);
  }
  return [...games.values()];
}

export async function fetchEspnStandings(league: League, fetchedAt: string) {
  const payload = await fetchJson(
    `https://site.api.espn.com/apis/v2/sports/${LEAGUE_PATH[league]}/standings`,
  );
  return mapEspnStandings(payload, league, fetchedAt);
}

export async function fetchEspnInjuries(league: League): Promise<RawInjury[]> {
  const payload = await fetchJson(
    `https://site.api.espn.com/apis/site/v2/sports/${LEAGUE_PATH[league]}/injuries`,
  );
  return mapEspnInjuries(payload, league);
}

function mapStandingEntry(
  raw: unknown,
  league: League,
  conference: string | null,
  sourceUrl: string,
  fetchedAt: string,
): { snapshot: NormalizedSnapshot; espnId: string | null } | null {
  const entry = asRec(raw);
  const team = asRec(entry?.team);
  const abbrev = str(team?.abbreviation)?.toUpperCase();
  const name = str(team?.displayName);
  if (!entry || !team || !abbrev || !name) return null;
  const stats = statMap(entry.stats);
  const wins = stats.get("wins");
  const losses = stats.get("losses");
  if (wins == null || losses == null) return null;
  const ot = stats.get("otLosses") ?? stats.get("overtimeLosses");
  return {
    espnId: str(team.id),
    snapshot: {
      teamId: teamId(league, abbrev),
      league,
      abbrev,
      name,
      logoUrl: logoOf(team),
      teamUrl: teamPage(team),
      wins,
      losses,
      otLosses: ot ?? null,
      tablePoints: league === "nhl" ? (stats.get("points") ?? null) : null,
      winPct: stats.get("winPercent") ?? null,
      pointsPct: stats.get("pointPct") ?? stats.get("pointsPct") ?? null,
      scoreFor: stats.get("pointsFor") ?? null,
      scoreAgainst: stats.get("pointsAgainst") ?? null,
      scoreDiff: stats.get("pointDifferential") ?? stats.get("differential") ?? null,
      gamesPlayed: stats.get("gamesPlayed") ?? wins + losses + (ot ?? 0),
      rank: stats.get("playoffSeed") ?? null,
      rankScope: "conference",
      conference,
      division: null,
      sourceName: "ESPN standings",
      sourceUrl,
      fetchedAt,
    },
  };
}

function statMap(value: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(value)) return map;
  for (const item of value) {
    const record = asRec(item);
    const name = str(record?.name);
    const amount = num(record?.value);
    if (name && amount != null) map.set(name, amount);
  }
  return map;
}

function logoOf(team: Record<string, unknown>): string | null {
  const direct = str(team.logo);
  if (direct) return direct;
  const logos = team.logos;
  if (!Array.isArray(logos)) return null;
  for (const logo of logos) {
    const href = str(asRec(logo)?.href);
    if (href) return href;
  }
  return null;
}

function teamPage(team: Record<string, unknown>): string | null {
  if (!Array.isArray(team.links)) return null;
  for (const link of team.links) {
    const record = asRec(link);
    const href = str(record?.href);
    const rel = record?.rel;
    if (href && Array.isArray(rel) && rel.includes("clubhouse")) return href;
  }
  return null;
}

function eventUrl(event: Record<string, unknown>, league: League): string {
  if (Array.isArray(event.links)) {
    for (const link of event.links) {
      const record = asRec(link);
      const href = str(record?.href);
      const rel = record?.rel;
      if (href && Array.isArray(rel) && rel.includes("summary")) return href;
    }
  }
  return league === "nba"
    ? "https://www.espn.com/nba/scoreboard"
    : "https://www.espn.com/nhl/scoreboard";
}

function playerUrl(athlete: Record<string, unknown> | null): string | null {
  if (!athlete || !Array.isArray(athlete.links)) return null;
  for (const link of athlete.links) {
    const record = asRec(link);
    const href = str(record?.href);
    const rel = record?.rel;
    if (href && Array.isArray(rel) && rel.includes("playercard")) return href;
  }
  return null;
}

function espnStatus(type: Record<string, unknown> | null, detail: string): GameStatus {
  if (/postpon|cancel/i.test(detail)) return "postponed";
  const state = str(type?.state);
  if (state === "in") return "live";
  if (state === "post" || type?.completed === true) return "final";
  return "scheduled";
}

function endedIn(detail: string, status: GameStatus): EndedIn | null {
  if (/shootout|\bSO\b/i.test(detail)) return "SO";
  if (/overtime|\bOT\b/i.test(detail)) return "OT";
  return status === "final" ? "REG" : null;
}
