import type { SourceItem } from "../shared/types";
import {
  countBoxes,
  insertBoxes,
  listMissingNhlBoxIds,
  upsertSources,
  type AppDatabase,
  type StoredBox,
} from "./db";
import { fetchJson } from "./http";
import { asRec, num, sleep } from "./parse";

const WORKERS = 4;
const GAP_MS = 80;

let queue: Promise<void> = Promise.resolve();

export function startBoxscores(db: AppDatabase): void {
  queue = queue
    .then(() => ingestBoxes(db))
    .catch((error: unknown) => {
      console.error("[betmaster] zápisy NHL selhaly", error);
    });
}

export function nhlNumericId(gameId: string): string | null {
  const match = /^nhl-(\d{6,})$/.exec(gameId);
  return match?.[1] ?? null;
}

export function mapNhlBox(gameId: string, payload: unknown): StoredBox | null {
  const root = asRec(payload);
  const home = asRec(root?.homeTeam);
  const away = asRec(root?.awayTeam);
  const homeShots = num(home?.sog);
  const awayShots = num(away?.sog);
  if (homeShots == null || awayShots == null) return null;
  const players = asRec(root?.playerByGameStats);
  return {
    gameId,
    homeShots,
    awayShots,
    homePpGoals: sumPowerPlayGoals(players?.homeTeam),
    awayPpGoals: sumPowerPlayGoals(players?.awayTeam),
  };
}

export function sumPowerPlayGoals(side: unknown): number | null {
  const record = asRec(side);
  if (!record) return null;
  let total = 0;
  let saw = false;
  for (const key of ["forwards", "defense", "goalies"]) {
    const group = record[key];
    if (!Array.isArray(group)) continue;
    saw = true;
    for (const player of group) {
      const goals = num(asRec(player)?.powerPlayGoals);
      if (goals != null) total += goals;
    }
  }
  return saw ? total : null;
}

async function ingestBoxes(db: AppDatabase): Promise<void> {
  const missing = listMissingNhlBoxIds(db).flatMap((id) => {
    const numeric = nhlNumericId(id);
    return numeric ? [{ id, numeric }] : [];
  });
  if (missing.length === 0) {
    noteSource(db, countBoxes(db), 0);
    return;
  }
  console.log(`[betmaster] doplňuji zápisy NHL: ${missing.length}`);
  const found: StoredBox[] = [];
  let failed = 0;
  let cursor = 0;
  let saved = 0;
  let finished = 0;

  async function worker(): Promise<void> {
    while (cursor < missing.length) {
      const index = cursor;
      cursor += 1;
      const item = missing[index];
      if (!item) return;
      try {
        const payload = await fetchJson(`https://api-web.nhle.com/v1/gamecenter/${item.numeric}/boxscore`);
        const mapped = mapNhlBox(item.id, payload);
        if (!mapped) failed += 1;
        else found.push(mapped);
      } catch {
        failed += 1;
      }
      finished += 1;
      if (found.length >= 40) {
        const chunk = found.splice(0, found.length);
        insertBoxes(db, chunk);
        saved += chunk.length;
      }
      if (finished % 200 === 0) {
        console.log(`[betmaster] zápisy NHL ${finished}/${missing.length}`);
      }
      await sleep(GAP_MS);
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, () => worker()));
  if (found.length > 0) {
    insertBoxes(db, found);
    saved += found.length;
  }
  console.log(`[betmaster] zápisy NHL uloženo ${saved}, bez čísel ${failed}, celkem ${countBoxes(db)}`);
  noteSource(db, countBoxes(db), failed);
}

function noteSource(db: AppDatabase, stored: number, failed: number): void {
  const source: SourceItem = {
    id: "nhl-boxscore",
    league: "nhl",
    kind: "boxscore",
    name: "NHL zápis zápasu",
    url: "https://api-web.nhle.com/v1/gamecenter/",
    mode: stored > 0 ? "live" : "blocked",
    fetchedAt: new Date().toISOString(),
    detail:
      stored > 0
        ? `Střely (sog) a góly v přesilovce ze zápisu zápasu na api-web.nhle.com. Počet přesilovek v tom zdroji není, sčítají se góly hráčů v přesilovce. Uloženo ${stored} zápasů${failed > 0 ? `, bez čísel ${failed}` : ""}.`
        : "Zápis zápasu se zatím nepodařilo uložit. Střely a góly v přesilovce proto chybí.",
  };
  upsertSources(db, [source]);
}
