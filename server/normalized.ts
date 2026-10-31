import type { GameStatus, League, Origin } from "../shared/types";

export type EndedIn = "REG" | "OT" | "SO";

export type NormalizedGame = {
  id: string;
  league: League;
  startsAt: string;
  status: GameStatus;
  season: string;
  venue: string | null;
  neutral: boolean;
  endedIn: EndedIn | null;
  homeAbbrev: string;
  homeName: string;
  homeLogo: string | null;
  awayAbbrev: string;
  awayName: string;
  awayLogo: string | null;
  homeScore: number | null;
  awayScore: number | null;
  sourceName: string;
  sourceUrl: string;
};

export type NormalizedSnapshot = {
  teamId: string;
  league: League;
  abbrev: string;
  name: string;
  logoUrl: string | null;
  teamUrl: string | null;
  wins: number;
  losses: number;
  otLosses: number | null;
  tablePoints: number | null;
  winPct: number | null;
  pointsPct: number | null;
  scoreFor: number | null;
  scoreAgainst: number | null;
  scoreDiff: number | null;
  gamesPlayed: number | null;
  rank: number | null;
  rankScope: "league" | "conference" | null;
  conference: string | null;
  division: string | null;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
};

export type RawInjury = {
  espnTeamId: string;
  teamName: string;
  playerName: string;
  playerKey: string;
  status: string;
  detail: string | null;
  sourceUrl: string;
  updatedAt: string | null;
};

export type NormalizedInjury = {
  id: string;
  teamId: string;
  playerName: string;
  status: string;
  detail: string | null;
  sourceName: string;
  sourceUrl: string;
  updatedAt: string | null;
};

export type StoredTeam = {
  id: string;
  league: League;
  abbrev: string;
  name: string;
  logoUrl: string | null;
  teamUrl: string | null;
};

export type StoredGame = NormalizedGame & {
  homeTeamId: string;
  awayTeamId: string;
  origin: Origin;
};

export type StoredSnapshot = NormalizedSnapshot & { origin: Origin };
export type StoredInjury = NormalizedInjury & { origin: Origin };
