import type { FormResult, League, Snapshot } from "../shared/types";

export function pct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "–";
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(value * 100)} %`;
}

export function logit(value: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    signDisplay: "exceptZero",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function clock(iso: string): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function dayLabel(key: string): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${key}T12:00:00Z`));
}

export function when(iso: string): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function lean(value: number, league: League): string {
  return new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: league === "nba" ? 0 : 1,
    maximumFractionDigits: league === "nba" ? 0 : 1,
  }).format(value);
}

export function record(snapshot: Snapshot, league: League): string {
  if (league === "nhl") return `${snapshot.wins}–${snapshot.losses}–${snapshot.otLosses ?? 0}`;
  return `${snapshot.wins}–${snapshot.losses}`;
}

export function formLetter(result: FormResult): string {
  if (result === "W") return "V";
  if (result === "OTL") return "PP";
  return "P";
}

export function formTitle(result: FormResult): string {
  if (result === "W") return "Výhra";
  if (result === "OTL") return "Prohra v prodloužení nebo na nájezdy";
  return "Prohra";
}

export function injuryStatus(status: string): string {
  const labels: Record<string, string> = {
    Out: "mimo hru",
    "Day-To-Day": "ze dne na den",
    "Injured Reserve": "injured reserve",
    Suspension: "suspenze",
  };
  return labels[status] ?? status;
}

export function originLabel(origin: "live" | "sample"): string {
  return origin === "live" ? "živě" : "vzorek";
}
