import type { League, SplitStat, TeamSplits } from "../shared/types";
import { fetchJson } from "./http";
import { teamId } from "./names";
import { asRec, num, sleep, str } from "./parse";

const NHL_NOTE =
  "Sezonní čísla z api-web.nhle.com: góly, střely, úspěšnost střelby, góly v přesilovce, góly v oslabení a brankáři. Procento přesilovek, oslabení a vhazování tenhle zdroj neposílá.";

const NBA_NOTE =
  "Sezonní čísla z veřejných statistik ESPN: body, trojky, střelba z pole, trestné hody, doskoky, asistence, ztráty, zisky a bloky.";

export type SplitFetch = {
  rows: TeamSplits[];
  failures: string[];
  note: string;
};

export function mapNhlSplits(club: unknown, standing: unknown): SplitStat[] | null {
  const record = asRec(club);
  if (!record) return null;
  const skaters = Array.isArray(record.skaters) ? record.skaters : [];
  const goalies = Array.isArray(record.goalies) ? record.goalies : [];
  if (skaters.length === 0 && goalies.length === 0) return null;

  const goals = sum(skaters, "goals") + sum(goalies, "goals");
  const shots = sum(skaters, "shots");
  const powerPlayGoals = sum(skaters, "powerPlayGoals");
  const shorthandedGoals = sum(skaters, "shorthandedGoals");
  const saves = sum(goalies, "saves");
  const shotsAgainst = sum(goalies, "shotsAgainst");
  const stand = asRec(standing);
  const games = num(stand?.gamesPlayed) ?? maxGames(skaters);
  const goalFor = num(stand?.goalFor) ?? goals;
  const goalAgainst = num(stand?.goalAgainst);
  const stats: SplitStat[] = [];

  if (games != null && games > 0) {
    stats.push(stat("goalsPerGame", "Góly na zápas", goalFor / games, 2, "high"));
    if (goalAgainst != null) {
      stats.push(stat("goalsAgainstPerGame", "Obdržené góly na zápas", goalAgainst / games, 2, "low"));
    }
    if (shots > 0) stats.push(stat("shotsPerGame", "Střely na zápas", shots / games, 1, "high"));
  }
  if (shots > 0) stats.push(stat("shootingPct", "Střelecká úspěšnost", (100 * goals) / shots, 1, "high"));
  stats.push(stat("powerPlayGoals", "Góly v přesilovce", powerPlayGoals, 0, "high"));
  stats.push(stat("shorthandedGoals", "Góly v oslabení", shorthandedGoals, 0, "high"));
  if (shotsAgainst > 0) {
    stats.push(stat("savePct", "Úspěšnost brankářů", (100 * saves) / shotsAgainst, 1, "high"));
  }
  return stats;
}

const NBA_FIELDS: Record<string, Omit<SplitStat, "value">> = {
  avgPoints: { key: "pointsPerGame", label: "Body na zápas", digits: 1, better: "high" },
  threePointFieldGoalPct: { key: "threePointPct", label: "Úspěšnost trojek", digits: 1, better: "high" },
  avgThreePointFieldGoalsMade: { key: "threesPerGame", label: "Trojky na zápas", digits: 1, better: "high" },
  fieldGoalPct: { key: "fieldGoalPct", label: "Úspěšnost střelby", digits: 1, better: "high" },
  freeThrowPct: { key: "freeThrowPct", label: "Trestné hody", digits: 1, better: "high" },
  avgRebounds: { key: "reboundsPerGame", label: "Doskoky na zápas", digits: 1, better: "high" },
  avgAssists: { key: "assistsPerGame", label: "Asistence na zápas", digits: 1, better: "high" },
  avgTurnovers: { key: "turnoversPerGame", label: "Ztráty na zápas", digits: 1, better: "low" },
  avgSteals: { key: "stealsPerGame", label: "Zisky na zápas", digits: 1, better: "high" },
  avgBlocks: { key: "blocksPerGame", label: "Bloky na zápas", digits: 1, better: "high" },
};

export function mapEspnSplits(payload: unknown): { abbrev: string; stats: SplitStat[] } | null {
  const record = asRec(payload);
  const abbrev = str(asRec(record?.team)?.abbreviation)?.toUpperCase();
  const categories = asRec(asRec(record?.results)?.stats)?.categories;
  if (!abbrev || !Array.isArray(categories)) return null;
  const found = new Map<string, number>();
  for (const category of categories) {
    const stats = asRec(category)?.stats;
    if (!Array.isArray(stats)) continue;
    for (const item of stats) {
      const row = asRec(item);
      const name = str(row?.name);
      const value = num(row?.value);
      if (!name || value == null || found.has(name) || !NBA_FIELDS[name]) continue;
      found.set(name, value);
    }
  }
  const stats = Object.entries(NBA_FIELDS).flatMap(([name, field]) => {
    const value = found.get(name);
    return value == null ? [] : [stat(field.key, field.label, value, field.digits, field.better)];
  });
  return stats.length > 0 ? { abbrev, stats } : null;
}

export async function fetchNhlSplits(): Promise<SplitFetch> {
  const standings = await fetchJson("https://api-web.nhle.com/v1/standings/now");
  const rows = asRec(standings)?.standings;
  const byAbbrev = new Map<string, unknown>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const abbrev = str(asRec(row)?.teamAbbrev)?.toUpperCase();
      if (abbrev) byAbbrev.set(abbrev, row);
    }
  }
  const fetchedAt = new Date().toISOString();
  const out: TeamSplits[] = [];
  const failures: string[] = [];
  await pool([...byAbbrev.keys()], 4, async (abbrev) => {
    try {
      const club = await fetchJson(`https://api-web.nhle.com/v1/club-stats/${abbrev}/now`);
      const stats = mapNhlSplits(club, byAbbrev.get(abbrev) ?? null);
      if (!stats) {
        failures.push(abbrev);
        return;
      }
      out.push(stored("nhl", abbrev, "NHL Web API", `https://api-web.nhle.com/v1/club-stats/${abbrev}/now`, fetchedAt, stats));
    } catch {
      failures.push(abbrev);
    }
    await sleep(40);
  });
  return { rows: out, failures, note: NHL_NOTE };
}

export async function fetchNbaSplits(): Promise<SplitFetch> {
  const payload = await fetchJson("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=40");
  const abbrevs = espnAbbrevs(payload);
  const fetchedAt = new Date().toISOString();
  const out: TeamSplits[] = [];
  const failures: string[] = [];
  await pool(abbrevs, 4, async (abbrev) => {
    try {
      const statsPayload = await fetchJson(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${abbrev.toLowerCase()}/statistics`,
      );
      const mapped = mapEspnSplits(statsPayload);
      if (!mapped) {
        failures.push(abbrev);
        return;
      }
      out.push(
        stored(
          "nba",
          mapped.abbrev,
          "ESPN statistiky",
          `https://www.espn.com/nba/team/stats/_/name/${mapped.abbrev.toLowerCase()}`,
          fetchedAt,
          mapped.stats,
        ),
      );
    } catch {
      failures.push(abbrev);
    }
    await sleep(40);
  });
  return { rows: out, failures, note: NBA_NOTE };
}

function espnAbbrevs(payload: unknown): string[] {
  const sports = asRec(payload)?.sports;
  const sport = Array.isArray(sports) ? asRec(sports[0]) : null;
  const leagues = sport?.leagues;
  const league = Array.isArray(leagues) ? asRec(leagues[0]) : null;
  const teams = league?.teams;
  if (!Array.isArray(teams)) return [];
  return teams.flatMap((item) => {
    const abbrev = str(asRec(asRec(item)?.team)?.abbreviation)?.toUpperCase();
    return abbrev ? [abbrev] : [];
  });
}

function stored(
  league: League,
  abbrev: string,
  sourceName: string,
  sourceUrl: string,
  fetchedAt: string,
  stats: SplitStat[],
): TeamSplits {
  return {
    teamId: teamId(league, abbrev),
    sourceName,
    sourceUrl,
    fetchedAt,
    stats,
  };
}

function stat(key: string, label: string, value: number, digits: number, better: SplitStat["better"]): SplitStat {
  const factor = 10 ** digits;
  return { key, label, value: Math.round(value * factor) / factor, digits, better };
}

function sum(rows: unknown[], key: string): number {
  return rows.reduce<number>((total, row) => total + (num(asRec(row)?.[key]) ?? 0), 0);
}

function maxGames(rows: unknown[]): number | null {
  const values = rows.flatMap((row) => {
    const games = num(asRec(row)?.gamesPlayed);
    return games == null ? [] : [games];
  });
  return values.length > 0 ? Math.max(...values) : null;
}

async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await task(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}
