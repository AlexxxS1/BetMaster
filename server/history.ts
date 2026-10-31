import { addDays, isoDate } from "./parse";

export const HISTORY_DAYS = 365;
export const FUTURE_DAYS = 10;
export const HISTORY_WEEK_CAP = 80;

export function historyBounds(now = new Date()): { start: string; end: string } {
  const today = isoDate(now);
  return { start: addDays(today, -HISTORY_DAYS), end: addDays(today, FUTURE_DAYS) };
}

export function startsInWindow(startsAt: string, now = new Date()): boolean {
  const day = startsAt.slice(0, 10);
  const bounds = historyBounds(now);
  return day >= bounds.start && day <= bounds.end;
}

export function oldestFinal(games: { startsAt: string; status: string }[]): string | null {
  let oldest: string | null = null;
  for (const game of games) {
    if (game.status !== "final") continue;
    if (oldest == null || game.startsAt < oldest) oldest = game.startsAt;
  }
  return oldest;
}

export function newestFinal(games: { startsAt: string; status: string }[]): string | null {
  let newest: string | null = null;
  for (const game of games) {
    if (game.status !== "final") continue;
    if (newest == null || game.startsAt > newest) newest = game.startsAt;
  }
  return newest;
}

export function coversHistory(oldest: string | null, now = new Date()): boolean {
  if (!oldest) return false;
  return oldest.slice(0, 10) <= addDays(historyBounds(now).start, 21);
}

export function historyNote(nhlOldest: string | null, nbaOldest: string | null, now = new Date()): string {
  const bounds = historyBounds(now);
  const nhl = nhlOldest ? `, nejstarší výsledek ${nhlOldest.slice(0, 10)}` : "";
  const nba = nbaOldest ? `, nejstarší výsledek ${nbaOldest.slice(0, 10)}` : "";
  return (
    `Požadované okno je ${HISTORY_DAYS} dní zpět (${bounds.start}) a ${FUTURE_DAYS} dní dopředu (${bounds.end}). ` +
    `NHL bere týdenní rozpis api-web.nhle.com; v tomhle okně zdroj starší týdny vrací${nhl}. ` +
    `NBA bere veřejný rozpis týmů na site.api.espn.com (základní část a play-off). Denní scoreboard rozsah datumů vrací HTTP 400, proto se stáhne sezóna a ořízne na okno${nba}. ` +
    "nba.com ani Livesport.cz se nestahují."
  );
}
