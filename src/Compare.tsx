import type { Snapshot, SplitStat, TeamBrief, TeamSplits } from "../shared/types";
import { record } from "./format";
import { Logo } from "./Logo";

const LEAD: Record<string, string> = {
  goalsPerGame: "dává víc gólů na zápas",
  goalsAgainstPerGame: "dostává míň gólů na zápas",
  shotsPerGame: "střílí častěji",
  shootingPct: "střílí úspěšněji",
  powerPlayGoals: "dává víc gólů v přesilovce",
  shorthandedGoals: "dává víc gólů v oslabení",
  savePct: "má jistější brankáře",
  pointsPerGame: "dává víc bodů na zápas",
  threePointPct: "dává trojky úspěšněji",
  threesPerGame: "dává víc trojek na zápas",
  fieldGoalPct: "střílí z pole úspěšněji",
  freeThrowPct: "hází trestné úspěšněji",
  reboundsPerGame: "bere víc doskoků",
  assistsPerGame: "má víc asistencí",
  turnoversPerGame: "má míň ztrát",
  stealsPerGame: "má víc zisků",
  blocksPerGame: "blokuje častěji",
};

export function Compare({
  league,
  away,
  home,
  awaySnapshot,
  homeSnapshot,
  awaySplits,
  homeSplits,
}: {
  league: "nba" | "nhl";
  away: TeamBrief;
  home: TeamBrief;
  awaySnapshot: Snapshot | null;
  homeSnapshot: Snapshot | null;
  awaySplits: TeamSplits | null;
  homeSplits: TeamSplits | null;
}) {
  const rows = pair(awaySplits, homeSplits);
  const lines = standouts(away.abbrev, home.abbrev, rows);
  const played = playedLine(away, home, awaySnapshot, homeSnapshot);

  return (
    <section className="compare" data-testid="compare">
      <h2>Srovnání týmů</h2>
      <p className="muted">Jak si letos stojí proti sobě. Není to výpočet odhadu.</p>
      {played ? <p className="muted">{played}</p> : null}
      {awaySnapshot && homeSnapshot ? (
        <div className="pair-record">
          <p>
            <Logo team={away} size={28} />
            <span>{away.abbrev}</span>
            <strong>{record(awaySnapshot, league)}</strong>
          </p>
          <p>
            <Logo team={home} size={28} />
            <span>{home.abbrev}</span>
            <strong>{record(homeSnapshot, league)}</strong>
          </p>
        </div>
      ) : null}
      {lines.length > 0 ? (
        <ul className="standouts">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : rows.length > 0 ? (
        <p>V sezonních číslech se týmy moc neliší.</p>
      ) : (
        <p className="muted">Sezonní srovnání se ještě nenačetlo.</p>
      )}
      {rows.length > 0 ? (
        <div className="compare-table">
          <div className="compare-head">
            <span>{away.abbrev}</span>
            <span />
            <span>{home.abbrev}</span>
          </div>
          {rows.map((row) => (
            <CompareRow key={row.key} row={row} />
          ))}
        </div>
      ) : null}
      {league === "nhl" && rows.length > 0 ? (
        <p className="muted">Procento přesilovek, oslabení a vhazování zdroj neposílá.</p>
      ) : null}
      {rows.length > 0 ? (
        <p className="source-line">
          Zdroj:{" "}
          <a href={(homeSplits ?? awaySplits)?.sourceUrl} target="_blank" rel="noreferrer">
            {league === "nhl" ? "statistiky NHL" : "statistiky ESPN"}
          </a>
        </p>
      ) : null}
    </section>
  );
}

function CompareRow({ row }: { row: Paired }) {
  const max = Math.max(row.away, row.home, 0);
  const awayWidth = max === 0 ? 8 : Math.max(4, (row.away / max) * 100);
  const homeWidth = max === 0 ? 8 : Math.max(4, (row.home / max) * 100);
  const awayBetter = better(row, row.away, row.home);
  const homeBetter = better(row, row.home, row.away);
  return (
    <div className="compare-row">
      <span className="compare-label">{row.label}</span>
      <strong className={awayBetter ? "better" : ""}>{formatStat(row.away, row)}</strong>
      <div className="compare-track" aria-hidden="true">
        <span className="side away">
          <i style={{ width: `${awayWidth}%` }} />
        </span>
        <span className="side home">
          <i style={{ width: `${homeWidth}%` }} />
        </span>
      </div>
      <strong className={homeBetter ? "better" : ""}>{formatStat(row.home, row)}</strong>
    </div>
  );
}

type Paired = SplitStat & { away: number; home: number };

function pair(awaySplits: TeamSplits | null, homeSplits: TeamSplits | null): Paired[] {
  if (!awaySplits || !homeSplits) return [];
  const home = new Map(homeSplits.stats.map((item) => [item.key, item]));
  return awaySplits.stats.flatMap((item) => {
    const other = home.get(item.key);
    if (!other) return [];
    return [{ ...item, away: item.value, home: other.value }];
  });
}

function standouts(awayName: string, homeName: string, rows: Paired[]): string[] {
  return rows
    .filter(notable)
    .sort((a, b) => gap(b) - gap(a))
    .slice(0, 3)
    .map((row) => {
      const awayLeads = better(row, row.away, row.home);
      const leader = awayLeads ? awayName : homeName;
      const lead = awayLeads ? row.away : row.home;
      const other = awayLeads ? row.home : row.away;
      const phrase = LEAD[row.key] ?? `vede v položce ${row.label.toLowerCase()}`;
      return `${leader} ${phrase}: ${formatStat(lead, row)} proti ${formatStat(other, row)}.`;
    });
}

function notable(row: Paired): boolean {
  const difference = Math.abs(row.away - row.home);
  if (difference === 0) return false;
  if (row.digits === 0) return difference >= 2;
  if (row.key.endsWith("Pct")) return difference >= 2;
  const scale = Math.max(row.away, row.home, 0.01);
  return difference / scale >= 0.12 && difference >= 0.4;
}

function gap(row: Paired): number {
  const scale = Math.max(row.away, row.home, 0.01);
  return Math.abs(row.away - row.home) / scale;
}

function better(row: Paired, value: number, other: number): boolean {
  if (value === other) return false;
  return row.better === "low" ? value < other : value > other;
}

function formatStat(value: number, row: Pick<SplitStat, "digits" | "key">): string {
  const text = new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: row.digits,
    maximumFractionDigits: row.digits,
  }).format(value);
  return row.key.endsWith("Pct") ? `${text} %` : text;
}

function playedLine(
  away: TeamBrief,
  home: TeamBrief,
  awaySnapshot: Snapshot | null,
  homeSnapshot: Snapshot | null,
): string | null {
  const awayGames = awaySnapshot?.gamesPlayed;
  const homeGames = homeSnapshot?.gamesPlayed;
  if (awayGames == null || homeGames == null) return null;
  return `Tahle sezona: ${away.abbrev} ${awayGames} zápasů, ${home.abbrev} ${homeGames} zápasů.`;
}
