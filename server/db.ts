import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { League, Origin, SourceItem, SplitStat, TeamSplits } from "../shared/types";
import { teamId } from "./names";
import type {
  NormalizedGame,
  NormalizedInjury,
  NormalizedSnapshot,
  StoredGame,
  StoredInjury,
  StoredSnapshot,
  StoredTeam,
} from "./normalized";

export type AppDatabase = DatabaseSync;

const defaultFile = fileURLToPath(new URL("../data/betmaster.sqlite", import.meta.url));

export function openDatabase(file = defaultFile): AppDatabase {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 3000");
  migrate(db);
  return db;
}

export function migrate(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      league TEXT NOT NULL,
      abbrev TEXT NOT NULL,
      name TEXT NOT NULL,
      logo_url TEXT,
      team_url TEXT
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      league TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      status TEXT NOT NULL,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      venue TEXT,
      season TEXT,
      neutral INTEGER NOT NULL DEFAULT 0,
      ended_in TEXT,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      origin TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS games_league_starts ON games (league, starts_at);
    CREATE TABLE IF NOT EXISTS snapshots (
      team_id TEXT PRIMARY KEY,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      ot_losses INTEGER,
      table_points INTEGER,
      win_pct REAL,
      points_pct REAL,
      score_for INTEGER,
      score_against INTEGER,
      score_diff INTEGER,
      games_played INTEGER,
      rank INTEGER,
      rank_scope TEXT,
      conference TEXT,
      division TEXT,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      origin TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS injuries (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      updated_at TEXT,
      origin TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_log (
      id TEXT PRIMARY KEY,
      league TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      mode TEXT NOT NULL,
      detail TEXT NOT NULL,
      fetched_at TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_splits (
      team_id TEXT PRIMARY KEY,
      league TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      stats_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recorded_picks (
      game_id TEXT PRIMARY KEY,
      league TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      home_win_prob REAL NOT NULL,
      favored TEXT NOT NULL,
      graded_at TEXT,
      success INTEGER,
      home_score INTEGER,
      away_score INTEGER
    );
  `);
}

export function countGames(db: AppDatabase, league?: League): number {
  const row = league
    ? db.prepare("SELECT COUNT(*) AS n FROM games WHERE league = ?").get(league)
    : db.prepare("SELECT COUNT(*) AS n FROM games").get();
  return numberField(row, "n");
}

export function replaceLeague(
  db: AppDatabase,
  league: League,
  games: NormalizedGame[],
  snapshots: NormalizedSnapshot[],
  origin: Origin,
): void {
  const insertSnapshotTeam = db.prepare(`
    INSERT INTO teams (id, league, abbrev, name, logo_url, team_url)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      logo_url = COALESCE(excluded.logo_url, teams.logo_url),
      team_url = COALESCE(excluded.team_url, teams.team_url)
  `);
  const insertGameTeam = db.prepare(`
    INSERT INTO teams (id, league, abbrev, name, logo_url, team_url)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      logo_url = COALESCE(teams.logo_url, excluded.logo_url)
  `);
  const insertGame = db.prepare(`
    INSERT INTO games (
      id, league, starts_at, status, home_team_id, away_team_id, home_score, away_score,
      venue, season, neutral, ended_in, source_name, source_url, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSnap = db.prepare(`
    INSERT INTO snapshots (
      team_id, wins, losses, ot_losses, table_points, win_pct, points_pct, score_for,
      score_against, score_diff, games_played, rank, rank_scope, conference, division,
      source_name, source_url, fetched_at, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  transaction(db, () => {
    for (const game of games) {
      const homeId = teamId(league, game.homeAbbrev);
      const awayId = teamId(league, game.awayAbbrev);
      insertGameTeam.run(homeId, league, game.homeAbbrev, game.homeName, game.homeLogo, null);
      insertGameTeam.run(awayId, league, game.awayAbbrev, game.awayName, game.awayLogo, null);
    }
    for (const snap of snapshots) {
      insertSnapshotTeam.run(snap.teamId, league, snap.abbrev, snap.name, snap.logoUrl, snap.teamUrl);
    }
    db.prepare("DELETE FROM games WHERE league = ?").run(league);
    if (snapshots.length > 0) {
      db.prepare(
        "DELETE FROM snapshots WHERE team_id IN (SELECT id FROM teams WHERE league = ?)",
      ).run(league);
    }
    for (const game of games) {
      insertGame.run(
        game.id,
        league,
        game.startsAt,
        game.status,
        teamId(league, game.homeAbbrev),
        teamId(league, game.awayAbbrev),
        game.homeScore,
        game.awayScore,
        game.venue,
        game.season,
        game.neutral ? 1 : 0,
        game.endedIn,
        game.sourceName,
        game.sourceUrl,
        origin,
      );
    }
    for (const snap of snapshots) {
      insertSnap.run(
        snap.teamId,
        snap.wins,
        snap.losses,
        snap.otLosses,
        snap.tablePoints,
        snap.winPct,
        snap.pointsPct,
        snap.scoreFor,
        snap.scoreAgainst,
        snap.scoreDiff,
        snap.gamesPlayed,
        snap.rank,
        snap.rankScope,
        snap.conference,
        snap.division,
        snap.sourceName,
        snap.sourceUrl,
        snap.fetchedAt,
        origin,
      );
    }
  });
}

export function replaceInjuries(
  db: AppDatabase,
  league: League,
  injuries: NormalizedInjury[],
  origin: Origin,
): void {
  const insert = db.prepare(`
    INSERT INTO injuries (
      id, team_id, player_name, status, detail, source_name, source_url, updated_at, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  transaction(db, () => {
    db.prepare(
      "DELETE FROM injuries WHERE team_id IN (SELECT id FROM teams WHERE league = ?)",
    ).run(league);
    for (const injury of injuries) {
      insert.run(
        injury.id,
        injury.teamId,
        injury.playerName,
        injury.status,
        injury.detail,
        injury.sourceName,
        injury.sourceUrl,
        injury.updatedAt,
        origin,
      );
    }
  });
}

export function replaceSplits(db: AppDatabase, league: League, rows: TeamSplits[]): void {
  const insert = db.prepare(`
    INSERT INTO team_splits (team_id, league, source_name, source_url, fetched_at, stats_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  transaction(db, () => {
    db.prepare("DELETE FROM team_splits WHERE league = ?").run(league);
    for (const row of rows) {
      insert.run(row.teamId, league, row.sourceName, row.sourceUrl, row.fetchedAt, JSON.stringify(row.stats));
    }
  });
}

export function listSplits(db: AppDatabase): TeamSplits[] {
  return db
    .prepare("SELECT * FROM team_splits")
    .all()
    .map((row) => {
      const record = asRow(row);
      return {
        teamId: text(record, "team_id"),
        sourceName: text(record, "source_name"),
        sourceUrl: text(record, "source_url"),
        fetchedAt: text(record, "fetched_at"),
        stats: parseStats(record.stats_json),
      };
    })
    .filter((row) => row.stats.length > 0);
}

export function countSplits(db: AppDatabase, league: League): number {
  return numberField(db.prepare("SELECT COUNT(*) AS n FROM team_splits WHERE league = ?").get(league), "n");
}

export type RecordedPick = {
  gameId: string;
  league: League;
  recordedAt: string;
  startsAt: string;
  homeWinProb: number;
  favored: "home" | "away" | "even";
  gradedAt: string | null;
  success: boolean | null;
  homeScore: number | null;
  awayScore: number | null;
};

export function listRecordedPicks(db: AppDatabase): RecordedPick[] {
  return db
    .prepare("SELECT * FROM recorded_picks")
    .all()
    .map((row) => {
      const record = asRow(row);
      const favored = text(record, "favored");
      return {
        gameId: text(record, "game_id"),
        league: text(record, "league") as League,
        recordedAt: text(record, "recorded_at"),
        startsAt: text(record, "starts_at"),
        homeWinProb: numberField(record, "home_win_prob"),
        favored: favored === "away" || favored === "even" ? favored : "home",
        gradedAt: textOrNull(record, "graded_at"),
        success: record.success == null ? null : numberField(record, "success") === 1,
        homeScore: numberOrNull(record, "home_score"),
        awayScore: numberOrNull(record, "away_score"),
      };
    });
}

export function savePrematchPick(
  db: AppDatabase,
  pick: {
    gameId: string;
    league: League;
    recordedAt: string;
    startsAt: string;
    homeWinProb: number;
    favored: RecordedPick["favored"];
  },
): void {
  if (pick.recordedAt >= pick.startsAt) return;
  db.prepare(`
    INSERT INTO recorded_picks (
      game_id, league, recorded_at, starts_at, home_win_prob, favored, graded_at, success, home_score, away_score
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
    ON CONFLICT(game_id) DO UPDATE SET
      league = excluded.league,
      recorded_at = excluded.recorded_at,
      starts_at = excluded.starts_at,
      home_win_prob = excluded.home_win_prob,
      favored = excluded.favored
    WHERE recorded_picks.graded_at IS NULL
      AND excluded.recorded_at < excluded.starts_at
  `).run(pick.gameId, pick.league, pick.recordedAt, pick.startsAt, pick.homeWinProb, pick.favored);
}

export function gradeRecordedOnce(
  db: AppDatabase,
  gameId: string,
  gradedAt: string,
  success: boolean | null,
  homeScore: number,
  awayScore: number,
): void {
  db.prepare(`
    UPDATE recorded_picks
    SET graded_at = ?, success = ?, home_score = ?, away_score = ?
    WHERE game_id = ? AND graded_at IS NULL
  `).run(gradedAt, success == null ? null : success ? 1 : 0, homeScore, awayScore, gameId);
}

export function upsertSources(db: AppDatabase, sources: SourceItem[]): void {
  const insert = db.prepare(`
    INSERT INTO source_log (id, league, kind, name, url, mode, detail, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      league = excluded.league,
      kind = excluded.kind,
      name = excluded.name,
      url = excluded.url,
      mode = excluded.mode,
      detail = excluded.detail,
      fetched_at = excluded.fetched_at
  `);
  transaction(db, () => {
    for (const source of sources) {
      insert.run(
        source.id,
        source.league,
        source.kind,
        source.name,
        source.url,
        source.mode,
        source.detail,
        source.fetchedAt,
      );
    }
  });
}

export function listTeams(db: AppDatabase, league?: League): StoredTeam[] {
  const rows = league
    ? db.prepare("SELECT * FROM teams WHERE league = ? ORDER BY name").all(league)
    : db.prepare("SELECT * FROM teams ORDER BY name").all();
  return rows.map((row) => {
    const record = asRow(row);
    return {
      id: text(record, "id"),
      league: text(record, "league") as League,
      abbrev: text(record, "abbrev"),
      name: text(record, "name"),
      logoUrl: textOrNull(record, "logo_url"),
      teamUrl: textOrNull(record, "team_url"),
    };
  });
}

export function listGames(db: AppDatabase): StoredGame[] {
  return db
    .prepare("SELECT * FROM games ORDER BY starts_at, id")
    .all()
    .map(mapGame);
}

export function getGame(db: AppDatabase, id: string): StoredGame | null {
  const row = db.prepare("SELECT * FROM games WHERE id = ?").get(id);
  return row ? mapGame(row) : null;
}

export function listSnapshots(db: AppDatabase): StoredSnapshot[] {
  return db
    .prepare("SELECT * FROM snapshots")
    .all()
    .map((row) => {
      const record = asRow(row);
      const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(text(record, "team_id"));
      const teamRow = team ? asRow(team) : null;
      return {
        teamId: text(record, "team_id"),
        league: (teamRow ? text(teamRow, "league") : "nba") as League,
        abbrev: teamRow ? text(teamRow, "abbrev") : "",
        name: teamRow ? text(teamRow, "name") : "",
        logoUrl: teamRow ? textOrNull(teamRow, "logo_url") : null,
        teamUrl: teamRow ? textOrNull(teamRow, "team_url") : null,
        wins: numberField(record, "wins"),
        losses: numberField(record, "losses"),
        otLosses: numberOrNull(record, "ot_losses"),
        tablePoints: numberOrNull(record, "table_points"),
        winPct: numberOrNull(record, "win_pct"),
        pointsPct: numberOrNull(record, "points_pct"),
        scoreFor: numberOrNull(record, "score_for"),
        scoreAgainst: numberOrNull(record, "score_against"),
        scoreDiff: numberOrNull(record, "score_diff"),
        gamesPlayed: numberOrNull(record, "games_played"),
        rank: numberOrNull(record, "rank"),
        rankScope: rankScope(record.rank_scope),
        conference: textOrNull(record, "conference"),
        division: textOrNull(record, "division"),
        sourceName: text(record, "source_name"),
        sourceUrl: text(record, "source_url"),
        fetchedAt: text(record, "fetched_at"),
        origin: text(record, "origin") as Origin,
      };
    });
}

export function listInjuries(db: AppDatabase): StoredInjury[] {
  return db
    .prepare("SELECT * FROM injuries ORDER BY team_id, player_name")
    .all()
    .map((row) => {
      const record = asRow(row);
      return {
        id: text(record, "id"),
        teamId: text(record, "team_id"),
        playerName: text(record, "player_name"),
        status: text(record, "status"),
        detail: textOrNull(record, "detail"),
        sourceName: text(record, "source_name"),
        sourceUrl: text(record, "source_url"),
        updatedAt: textOrNull(record, "updated_at"),
        origin: text(record, "origin") as Origin,
      };
    });
}

export function distinctOrigins(db: AppDatabase, league?: League): Origin[] {
  const rows = league
    ? db.prepare("SELECT DISTINCT origin FROM games WHERE league = ?").all(league)
    : db.prepare("SELECT DISTINCT origin FROM games").all();
  return rows.map((row) => text(asRow(row), "origin") as Origin);
}

export function writeSources(db: AppDatabase, sources: SourceItem[]): void {
  const insert = db.prepare(`
    INSERT INTO source_log (id, league, kind, name, url, mode, detail, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  transaction(db, () => {
    db.exec("DELETE FROM source_log");
    for (const source of sources) {
      insert.run(
        source.id,
        source.league,
        source.kind,
        source.name,
        source.url,
        source.mode,
        source.detail,
        source.fetchedAt,
      );
    }
  });
}

export function listSources(db: AppDatabase): SourceItem[] {
  return db
    .prepare("SELECT * FROM source_log ORDER BY league, kind, name")
    .all()
    .map((row) => {
      const record = asRow(row);
      return {
        id: text(record, "id"),
        league: text(record, "league") as SourceItem["league"],
        kind: text(record, "kind") as SourceItem["kind"],
        name: text(record, "name"),
        url: text(record, "url"),
        mode: text(record, "mode") as SourceItem["mode"],
        detail: text(record, "detail"),
        fetchedAt: textOrNull(record, "fetched_at"),
      };
    });
}

export function getMeta(db: AppDatabase, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  if (!row) return null;
  return text(asRow(row), "value");
}

export function setMeta(db: AppDatabase, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function transaction<T>(db: AppDatabase, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function mapGame(row: unknown): StoredGame {
  const record = asRow(row);
  return {
    id: text(record, "id"),
    league: text(record, "league") as League,
    startsAt: text(record, "starts_at"),
    status: text(record, "status") as StoredGame["status"],
    season: text(record, "season"),
    venue: textOrNull(record, "venue"),
    neutral: numberField(record, "neutral") === 1,
    endedIn: endedIn(record.ended_in),
    homeAbbrev: "",
    homeName: "",
    homeLogo: null,
    awayAbbrev: "",
    awayName: "",
    awayLogo: null,
    homeTeamId: text(record, "home_team_id"),
    awayTeamId: text(record, "away_team_id"),
    homeScore: numberOrNull(record, "home_score"),
    awayScore: numberOrNull(record, "away_score"),
    sourceName: text(record, "source_name"),
    sourceUrl: text(record, "source_url"),
    origin: text(record, "origin") as Origin,
  };
}

function endedIn(value: unknown): StoredGame["endedIn"] {
  return value === "REG" || value === "OT" || value === "SO" ? value : null;
}

function rankScope(value: unknown): StoredSnapshot["rankScope"] {
  return value === "league" || value === "conference" ? value : null;
}

function asRow(row: unknown): Record<string, unknown> {
  return row as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value == null ? "" : String(value);
}

function textOrNull(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return value == null || value === "" ? null : String(value);
}

function numberField(row: unknown, key: string): number {
  const value = asRow(row)[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function numberOrNull(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return value == null ? null : Number(value);
}

function parseStats(value: unknown): SplitStat[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const record = item as Record<string, unknown>;
      const key = typeof record.key === "string" ? record.key : "";
      const label = typeof record.label === "string" ? record.label : "";
      const amount = typeof record.value === "number" ? record.value : Number(record.value);
      const digits = typeof record.digits === "number" ? record.digits : 1;
      const better = record.better === "low" ? "low" : "high";
      if (!key || !label || !Number.isFinite(amount)) return [];
      return [{ key, label, value: amount, digits, better }];
    });
  } catch {
    return [];
  }
}
