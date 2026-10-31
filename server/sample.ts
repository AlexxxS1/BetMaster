import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SourceItem } from "../shared/types";
import {
  countGames,
  listGames,
  listInjuries,
  listSnapshots,
  listSources,
  listTeams,
  replaceInjuries,
  replaceLeague,
  setMeta,
  writeSources,
  type AppDatabase,
} from "./db";
import type { NormalizedGame, NormalizedInjury, NormalizedSnapshot } from "./normalized";

export const samplePath = fileURLToPath(new URL("../data/sample/snapshot.json", import.meta.url));

type SampleFile = {
  capturedAt: string;
  note: string;
  games: NormalizedGame[];
  snapshots: NormalizedSnapshot[];
  injuries: NormalizedInjury[];
  sources: SourceItem[];
};

export function loadSampleIfEmpty(db: AppDatabase): boolean {
  if (countGames(db) > 0 || !existsSync(samplePath)) return false;
  const sample = JSON.parse(readFileSync(samplePath, "utf8")) as SampleFile;
  for (const league of ["nhl", "nba"] as const) {
    replaceLeague(
      db,
      league,
      sample.games.filter((game) => game.league === league),
      sample.snapshots.filter((snap) => snap.league === league),
      "sample",
    );
    replaceInjuries(
      db,
      league,
      sample.injuries.filter((injury) => injury.teamId.startsWith(`${league}-`)),
      "sample",
    );
  }
  writeSources(
    db,
    sample.sources.map((source) => ({
      ...source,
      mode: "sample" as const,
      detail: `${sample.note} ${source.detail}`.trim(),
    })),
  );
  setMeta(
    db,
    "warnings",
    JSON.stringify([
      "Zobrazen je kontrolní vzorek z repozitáře. Živý zdroj se načte, jakmile bude dostupný.",
    ]),
  );
  return true;
}

export function writeSample(db: AppDatabase): void {
  const teams = new Map(listTeams(db).map((team) => [team.id, team]));
  const capturedAt = new Date().toISOString();
  const note =
    "Kontrolní vzorek pro běh bez sítě. Není to živé připojení. Pochází z veřejných zdrojů v čase uložení.";
  const file: SampleFile = {
    capturedAt,
    note,
    games: listGames(db).map((game) => {
      const home = teams.get(game.homeTeamId);
      const away = teams.get(game.awayTeamId);
      return {
        id: game.id,
        league: game.league,
        startsAt: game.startsAt,
        status: game.status,
        season: game.season,
        venue: game.venue,
        neutral: game.neutral,
        endedIn: game.endedIn,
        homeAbbrev: home?.abbrev ?? "",
        homeName: home?.name ?? game.homeTeamId,
        homeLogo: home?.logoUrl ?? null,
        awayAbbrev: away?.abbrev ?? "",
        awayName: away?.name ?? game.awayTeamId,
        awayLogo: away?.logoUrl ?? null,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        sourceName: game.sourceName,
        sourceUrl: game.sourceUrl,
      };
    }),
    snapshots: listSnapshots(db).map((snap) => ({
      teamId: snap.teamId,
      league: snap.league,
      abbrev: snap.abbrev,
      name: snap.name,
      logoUrl: snap.logoUrl,
      teamUrl: snap.teamUrl,
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
    })),
    injuries: listInjuries(db).map((injury) => ({
      id: injury.id,
      teamId: injury.teamId,
      playerName: injury.playerName,
      status: injury.status,
      detail: injury.detail,
      sourceName: injury.sourceName,
      sourceUrl: injury.sourceUrl,
      updatedAt: injury.updatedAt,
    })),
    sources: listSources(db).map((source) => ({
      ...source,
      mode: "sample" as const,
      fetchedAt: capturedAt,
      detail: `Snímek uložený ${capturedAt}. ${source.detail}`,
    })),
  };
  writeFileSync(samplePath, JSON.stringify(file));
}
