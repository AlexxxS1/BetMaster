import type { League, SourceItem } from "../shared/types";
import {
  countGames,
  distinctOrigins,
  getMeta,
  listInjuries,
  listTeams,
  replaceInjuries,
  replaceLeague,
  setMeta,
  writeSources,
  type AppDatabase,
} from "./db";
import { setRefreshing } from "./ingest-state";
import { normName } from "./names";
import type { NormalizedInjury } from "./normalized";
import { fetchEspnGames, fetchEspnInjuries, fetchEspnStandings } from "./sources/espn";
import { fetchNhlBundle } from "./sources/nhl";

const STALE_MS = 6 * 60 * 60 * 1000;

let current: Promise<void> | null = null;

export function startIngest(db: AppDatabase, force = false): Promise<void> {
  if (!force && isFresh(db)) return Promise.resolve();
  if (current) return current;
  setRefreshing(true);
  current = ingestLive(db).finally(() => {
    setRefreshing(false);
    current = null;
  });
  return current;
}

async function ingestLive(db: AppDatabase): Promise<void> {
  const warnings: string[] = [];
  const sources: SourceItem[] = [];
  const fetchedAt = new Date().toISOString();
  let nbaEspnIds = new Map<string, string>();

  try {
    const nhl = await fetchNhlBundle();
    replaceLeague(db, "nhl", nhl.games, nhl.snapshots, "live");
    sources.push({
      id: "nhl-results",
      league: "nhl",
      kind: "results",
      name: "NHL Web API",
      url: "https://api-web.nhle.com/v1/schedule/now",
      mode: "live",
      fetchedAt,
      detail: `Rozpis a výsledky z api-web.nhle.com, které používá nhl.com. Načteno ${nhl.games.length} zápasů probíhající sezóny plus nejbližší program.`,
    });
    sources.push({
      id: "nhl-standings",
      league: "nhl",
      kind: "standings",
      name: "NHL tabulka",
      url: "https://www.nhl.com/standings",
      mode: "live",
      fetchedAt,
      detail: `Předzápasové hodnocení: body, bilance, rozdíl branek a pořadí. ${nhl.snapshots.length} týmů z endpointu standings/now. Odkaz vede na tabulku na nhl.com.`,
    });
    console.log(`[betmaster] NHL ${nhl.games.length} zápasů, ${nhl.snapshots.length} týmů v tabulce`);
  } catch (error) {
    const text = message(error);
    warnings.push(`NHL: ${text}`);
    sources.push(retained(db, "nhl", "results", "NHL Web API", "https://www.nhl.com/schedule", text, fetchedAt));
    sources.push(
      retained(db, "nhl", "standings", "NHL tabulka", "https://www.nhl.com/standings", text, fetchedAt, "nhl-standings"),
    );
    console.error(`[betmaster] NHL selhalo: ${text}`);
  }

  try {
    const games = await fetchEspnGames("nba");
    if (games.length === 0) throw new Error("ESPN nevrátilo žádné zápasy NBA");
    let snapshots = [] as Awaited<ReturnType<typeof fetchEspnStandings>>["snapshots"];
    try {
      const standings = await fetchEspnStandings("nba", fetchedAt);
      snapshots = standings.snapshots;
      nbaEspnIds = standings.espnIds;
      sources.push({
        id: "nba-standings",
        league: "nba",
        kind: "standings",
        name: "ESPN tabulka NBA",
        url: "https://www.espn.com/nba/standings",
        mode: "live",
        fetchedAt,
        detail: `Předzápasové hodnocení NBA (bilance, rozdíl bodů, pořadí v konferenci), protože nba.com automatický přístup blokuje. ${snapshots.length} týmů.`,
      });
    } catch (error) {
      const text = message(error);
      warnings.push(`NBA tabulka: ${text}`);
      sources.push(
        retained(
          db,
          "nba",
          "standings",
          "ESPN tabulka NBA",
          "https://www.espn.com/nba/standings",
          text,
          fetchedAt,
          "nba-standings",
        ),
      );
    }
    replaceLeague(db, "nba", games, snapshots, "live");
    sources.push({
      id: "nba-results",
      league: "nba",
      kind: "results",
      name: "ESPN public scoreboard",
      url: "https://www.espn.com/nba/scoreboard",
      mode: "live",
      fetchedAt,
      detail: `Výsledky a rozpis NBA z veřejného JSON na site.api.espn.com. Načteno ${games.length} zápasů. nba.com v tomhle prostředí nešlo použít.`,
    });
    console.log(`[betmaster] NBA ${games.length} zápasů, ${snapshots.length} týmů v tabulce`);
  } catch (error) {
    const text = message(error);
    warnings.push(`NBA: ${text}`);
    sources.push(
      retained(
        db,
        "nba",
        "results",
        "ESPN public scoreboard",
        "https://www.espn.com/nba/scoreboard",
        text,
        fetchedAt,
      ),
    );
    console.error(`[betmaster] NBA selhalo: ${text}`);
  }

  await ingestInjuries(db, "nhl", new Map(), sources, warnings, fetchedAt);
  await ingestInjuries(db, "nba", nbaEspnIds, sources, warnings, fetchedAt);

  writeSources(db, sources);
  setMeta(db, "warnings", JSON.stringify(warnings));
  setMeta(db, "last_ingest_at", fetchedAt);
}

async function ingestInjuries(
  db: AppDatabase,
  league: League,
  espnIds: Map<string, string>,
  sources: SourceItem[],
  warnings: string[],
  fetchedAt: string,
): Promise<void> {
  const page =
    league === "nba" ? "https://www.espn.com/nba/injuries" : "https://www.espn.com/nhl/injuries";
  const name = league === "nba" ? "ESPN absence NBA" : "ESPN absence NHL";
  try {
    const raw = await fetchEspnInjuries(league);
    const byName = new Map(listTeams(db, league).map((team) => [normName(team.name), team.id]));
    const unmatched = new Set<string>();
    const injuries: NormalizedInjury[] = [];
    for (const item of raw) {
      const team = espnIds.get(item.espnTeamId) ?? byName.get(normName(item.teamName));
      if (!team) {
        unmatched.add(item.teamName);
        continue;
      }
      injuries.push({
        id: `${team}-${item.playerKey}`,
        teamId: team,
        playerName: item.playerName,
        status: item.status,
        detail: item.detail,
        sourceName: name,
        sourceUrl: item.sourceUrl,
        updatedAt: item.updatedAt,
      });
    }
    replaceInjuries(db, league, injuries, "live");
    if (unmatched.size > 0) {
      warnings.push(
        `${league.toUpperCase()} absence bez známého týmu: ${[...unmatched].slice(0, 8).join(", ")}`,
      );
    }
    sources.push({
      id: `${league}-injuries`,
      league,
      kind: "injuries",
      name,
      url: page,
      mode: "live",
      fetchedAt,
      detail: `${injuries.length} absencí (Out, injured reserve, suspension, day-to-day) z veřejného seznamu ESPN.`,
    });
    console.log(`[betmaster] ${league.toUpperCase()} absence: ${injuries.length}`);
  } catch (error) {
    const text = message(error);
    warnings.push(`${league.toUpperCase()} absence: ${text}`);
    const existing = listInjuries(db).filter((injury) => injury.teamId.startsWith(`${league}-`));
    const kept = existing.some((injury) => injury.origin === "live")
      ? "live"
      : existing.length > 0
        ? "sample"
        : "blocked";
    sources.push({
      id: `${league}-injuries`,
      league,
      kind: "injuries",
      name,
      url: page,
      mode: kept,
      fetchedAt,
      detail:
        kept === "blocked"
          ? text
          : `Živý seznam selhal (${text}). ${kept === "sample" ? "Zůstává kontrolní vzorek." : "Zůstává poslední stažený seznam."}`,
    });
    console.error(`[betmaster] ${league.toUpperCase()} absence selhaly: ${text}`);
  }
}

function retained(
  db: AppDatabase,
  league: League,
  kind: SourceItem["kind"],
  name: string,
  url: string,
  error: string,
  fetchedAt: string,
  id = `${league}-${kind}`,
): SourceItem {
  const origins = distinctOrigins(db, league);
  if (origins.includes("live")) {
    return {
      id,
      league,
      kind,
      name,
      url,
      mode: "live",
      fetchedAt,
      detail: `Obnova selhala (${error}). V aplikaci zůstávají poslední stažená data.`,
    };
  }
  if (origins.includes("sample") || countGames(db, league) > 0) {
    return {
      id,
      league,
      kind,
      name,
      url,
      mode: "sample",
      fetchedAt,
      detail: `Živý zdroj selhal (${error}). Zůstává kontrolní vzorek.`,
    };
  }
  return {
    id,
    league,
    kind,
    name,
    url,
    mode: "blocked",
    fetchedAt,
    detail: error,
  };
}

function isFresh(db: AppDatabase): boolean {
  const last = getMeta(db, "last_ingest_at");
  if (!last || countGames(db) === 0) return false;
  return Date.now() - Date.parse(last) < STALE_MS;
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : "neznámá chyba";
  return text.length > 280 ? `${text.slice(0, 279)}…` : text;
}
