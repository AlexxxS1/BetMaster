export type League = "nba" | "nhl";
export type Origin = "live" | "sample";
export type GameStatus = "scheduled" | "live" | "final" | "postponed";
export type FormResult = "W" | "L" | "OTL";
export type Timing = "prematch" | "live" | "retro";
export type SourceMode = "live" | "sample" | "blocked";
export type DataMode = "live" | "sample" | "mixed" | "empty";

export type TeamBrief = {
  id: string;
  abbrev: string;
  name: string;
  logoUrl: string | null;
  teamUrl: string | null;
};

export type Snapshot = {
  teamId: string;
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
  origin: Origin;
};

export type InjuryNote = {
  playerName: string;
  status: string;
  detail: string | null;
  sourceName: string;
  sourceUrl: string;
  updatedAt: string | null;
  origin: Origin;
};

export type FormItem = {
  gameId: string;
  startsAt: string;
  opponentAbbrev: string;
  opponentName: string;
  teamScore: number;
  opponentScore: number;
  result: FormResult;
};

export type H2HItem = {
  gameId: string;
  startsAt: string;
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId: string | null;
};

export type FactorKey = "home" | "elo" | "form" | "h2h" | "absence";

export type Factor = {
  key: FactorKey;
  label: string;
  detail: string;
  logit: number;
  used: boolean;
};

export type Prediction = {
  homeWinProb: number;
  awayWinProb: number;
  scoreLeanHome: number;
  scoreLeanAway: number;
  scoreUnit: "góly" | "body";
  factors: Factor[];
  assumptions: string[];
  formula: string;
  eloHome: number;
  eloAway: number;
};

export type MatchSummary = {
  id: string;
  league: League;
  startsAt: string;
  status: GameStatus;
  venue: string | null;
  neutral: boolean;
  home: TeamBrief;
  away: TeamBrief;
  homeScore: number | null;
  awayScore: number | null;
  origin: Origin;
  sourceName: string;
  sourceUrl: string;
  modelHomeWinProb: number | null;
  timing: Timing;
};

export type ChartPoint = {
  label: string;
  value: number;
};

export type ChartSeries = {
  name: string;
  tone: "home" | "away" | "neutral";
  points: ChartPoint[];
};

export type MatchChart = {
  id: string;
  title: string;
  measures: string;
  effect: string;
  summary: string;
  kind: "line" | "bar";
  color: "tone" | "sign";
  series: ChartSeries[];
};

export type HistoryWindow = {
  from: string | null;
  to: string | null;
  finalGames: number;
  nbaFinals: number;
  nhlFinals: number;
  requestedDays: number;
  note: string;
};

export type MatchDetail = MatchSummary & {
  season: string;
  homeSnapshot: Snapshot | null;
  awaySnapshot: Snapshot | null;
  homeSplits: TeamSplits | null;
  awaySplits: TeamSplits | null;
  homeForm: FormItem[];
  awayForm: FormItem[];
  h2h: H2HItem[];
  homeInjuries: InjuryNote[];
  awayInjuries: InjuryNote[];
  prediction: Prediction;
  injuryNote: string;
  snapshotNote: string;
  charts: MatchChart[];
  history: HistoryWindow;
  angles: MatchAngles;
};

export type StatusResponse = {
  refreshing: boolean;
  gameCount: number;
  nbaGames: number;
  nhlGames: number;
  lastIngestAt: string | null;
  mode: DataMode;
  warnings: string[];
  history: HistoryWindow;
};

export type MatchesResponse = {
  matches: MatchSummary[];
};

export type SplitStat = {
  key: string;
  label: string;
  value: number;
  digits: number;
  better: "high" | "low";
};

export type TeamSplits = {
  teamId: string;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
  stats: SplitStat[];
};

export type SourceItem = {
  id: string;
  league: League | "all";
  kind: "results" | "standings" | "injuries" | "splits" | "boxscore";
  name: string;
  url: string;
  mode: SourceMode;
  detail: string;
  fetchedAt: string | null;
};

export type SourcesResponse = {
  sources: SourceItem[];
  status: StatusResponse;
};

export type RecordCounts = {
  total: number;
  successful: number;
  unsuccessful: number;
  rate: number | null;
};

export type RecordMonth = {
  month: string;
  label: string;
  backtest: RecordCounts;
  live: RecordCounts;
};

export type RecordRow = {
  id: string;
  league: League;
  startsAt: string;
  awayAbbrev: string;
  homeAbbrev: string;
  awayName: string;
  homeName: string;
  awayScore: number;
  homeScore: number;
  favored: "home" | "away";
  favoredAbbrev: string;
  homeWinProb: number;
  success: boolean;
  source: "backtest" | "live";
  recordedAt: string | null;
};

export type RecordResponse = {
  rule: string;
  backtest: { all: RecordCounts; nba: RecordCounts; nhl: RecordCounts; even: number };
  live: { all: RecordCounts; nba: RecordCounts; nhl: RecordCounts; pending: number; even: number };
  months: RecordMonth[];
  recent: RecordRow[];
};

export type AngleMarketId =
  | "nba-total-points"
  | "nba-team-points"
  | "nhl-total-goals"
  | "nhl-team-goals"
  | "nhl-match-shots"
  | "nhl-pp-goals";

export type AngleLine = {
  id: string;
  gameId: string;
  league: League;
  market: AngleMarketId;
  marketLabel: string;
  startsAt: string;
  awayAbbrev: string;
  homeAbbrev: string;
  awayName: string;
  homeName: string;
  text: string;
  detail: string;
};

export type MarketBacktest = {
  market: AngleMarketId;
  league: League;
  label: string;
  hits: number;
  n: number;
  rate: number | null;
  shown: boolean;
};

export type AngleDay = {
  date: string;
  label: string;
  lines: AngleLine[];
};

export type AnglesResponse = {
  disclaimer: string;
  responsible: string;
  note: string;
  ppNote: string;
  coverageNote: string | null;
  days: AngleDay[];
  markets: MarketBacktest[];
};

export type MatchAngles = {
  show: boolean;
  lines: AngleLine[];
  disclaimer: string;
  responsible: string;
  note: string;
  ppNote: string;
};
