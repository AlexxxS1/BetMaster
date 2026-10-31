import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { FormItem, InjuryNote, MatchChart, MatchDetail, Snapshot } from "../../shared/types";
import { getMatch } from "../api";
import {
  formLetter,
  formTitle,
  injuryStatus,
  lean,
  originLabel,
  pct,
  record,
  when,
} from "../format";
import { ChartCard } from "../Charts";
import { Compare } from "../Compare";
import { Logo } from "../Logo";
import { useAppStatus } from "../status";

export function MatchPage() {
  const { id = "" } = useParams();
  const { generation } = useAppStatus();
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setMatch(null);
    setError(null);
    getMatch(id)
      .then((data) => {
        if (!cancel) setMatch(data);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Zápas se nepodařilo načíst");
      });
    return () => {
      cancel = true;
    };
  }, [id, generation]);

  if (error) {
    return (
      <p className="empty">
        {error}. <Link to="/">Zpět na seznam</Link>
      </p>
    );
  }
  if (!match) return <p className="empty">Načítám analýzu…</p>;

  const home = match.prediction.homeWinProb;
  const timing =
    match.timing === "retro"
      ? "Zápas už se hrál. Odhad je z toho, co bylo známo před výkopem."
      : match.timing === "live"
        ? "Zápas právě běží. Odhad je z dat před výkopem."
        : "Odhad před zápasem.";
  const charts = customerCharts(match);

  return (
    <article className={`detail league-${match.league}`}>
      <Link className="back" to="/">
        ← Zápasy
      </Link>
      <p className="kicker">
        <span className={`chip chip-${match.league}`}>{match.league.toUpperCase()}</span>
        <time dateTime={match.startsAt}>{when(match.startsAt)} Praha</time>
        {match.venue ? <span>{match.venue}</span> : null}
        <span>
          zdroj zápasu: {originLabel(match.origin)} · {match.sourceName}
        </span>
      </p>
      <header className="matchup">
        <TeamHead team={match.away} role="Hosté" />
        <div className="prob-block" data-testid="prediction">
          <div className="prob-nums">
            <span>{pct(1 - home)}</span>
            <span>{pct(home)}</span>
          </div>
          <div className="prob-bar" aria-hidden="true">
            <i className="away" style={{ width: `${(1 - home) * 100}%` }} />
            <i className="home" style={{ width: `${home * 100}%` }} />
          </div>
          <p className="timing">{timing}</p>
        </div>
        <TeamHead team={match.home} role="Domácí" />
      </header>

      {match.status === "final" || match.status === "live" ? (
        <p className="actual">
          Skutečný stav: {match.away.abbrev} {match.awayScore ?? "–"} : {match.homeScore ?? "–"}{" "}
          {match.home.abbrev}
        </p>
      ) : null}

      <section className="predict-card">
        <p className="stamp">Analýza · ne sázka</p>
        <h1>Jak by zápas mohl dopadnout</h1>
        <p className="scoreline" data-testid="score-lean">
          {lean(match.prediction.scoreLeanAway, match.league)}
          <span> : </span>
          {lean(match.prediction.scoreLeanHome, match.league)}
          <small> {match.prediction.scoreUnit}</small>
        </p>
        <p className="customer-note">
          Tohle je analýza zápasu, ne tip k sázce. Čísla říkají, jak utkání může vypadat.
        </p>
      </section>

      <Compare
        league={match.league}
        away={match.away}
        home={match.home}
        awaySnapshot={match.awaySnapshot}
        homeSnapshot={match.homeSnapshot}
        awaySplits={match.awaySplits}
        homeSplits={match.homeSplits}
      />

      <section className="charts" data-testid="charts">
        <h2>Jak týmy vypadají</h2>
        {charts.map((chart) => (
          <ChartCard key={chart.id} chart={chart} />
        ))}
      </section>

      <section className="split">
        <FormColumn title={`Forma ${match.away.abbrev}`} rows={match.awayForm} />
        <FormColumn title={`Forma ${match.home.abbrev}`} rows={match.homeForm} />
      </section>

      <section>
        <h2>Vzájemné zápasy</h2>
        <p className="muted">
          {match.h2h.length === 0
            ? "Za poslední rok se tyhle týmy nepotkaly."
            : `Za poslední rok spolu hrály ${match.h2h.length}×.`}
        </p>
        {match.h2h.length === 0 ? null : (
          <ul className="h2h">
            {match.h2h.map((row) => (
              <li key={row.gameId}>
                <time dateTime={row.startsAt}>{when(row.startsAt)}</time>
                <span>
                  {row.awayAbbrev} {row.awayScore} : {row.homeScore} {row.homeAbbrev}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="split">
        <InjuryColumn title={`Absence ${match.away.abbrev}`} rows={match.awayInjuries} />
        <InjuryColumn title={`Absence ${match.home.abbrev}`} rows={match.homeInjuries} />
      </section>
      <p className="muted">Jde o aktuální seznam absencí.</p>

      <section data-testid="sources-panel">
        <h2>Jak stojí v tabulce</h2>
        <p className="muted">Aktuální bilance obou týmů.</p>
        <div className="split">
          <Rating team={match.away} league={match.league} snapshot={match.awaySnapshot} />
          <Rating team={match.home} league={match.league} snapshot={match.homeSnapshot} />
        </div>
      </section>

      <p className="source-line">
        Zápas:{" "}
        <a href={match.sourceUrl} target="_blank" rel="noreferrer">
          {match.sourceName}
        </a>
      </p>
    </article>
  );
}

function TeamHead({ team, role }: { team: MatchDetail["home"]; role: string }) {
  return (
    <div className="team-head">
      <Logo team={team} size={72} />
      <div>
        <small>{role}</small>
        <strong>{team.name}</strong>
        <span>{team.abbrev}</span>
      </div>
    </div>
  );
}

function customerCharts(match: MatchDetail): MatchChart[] {
  return match.charts.flatMap((chart) => {
    if (chart.id === "form") {
      return [
        {
          ...chart,
          title: "Forma",
          measures: `${formGlance(match.away.abbrev, match.awayForm)} ${formGlance(match.home.abbrev, match.homeForm)}`,
          effect: "",
          summary: "",
        },
      ];
    }
    if (chart.id === "h2h") {
      return [
        {
          ...chart,
          title: "Vzájemné zápasy",
          measures:
            match.h2h.length === 0
              ? "Za poslední rok se tyhle týmy nepotkaly."
              : "Rozdíl skóre z pohledu domácích v každém společném zápase.",
          effect: "",
          summary: "",
        },
      ];
    }
    if (chart.id === "home-away") {
      return [
        {
          ...chart,
          title: "Doma a venku",
          measures: "Jak se jim daří na vlastním hřišti a venku.",
          effect: "",
          summary: plainRecord(chart.summary),
        },
      ];
    }
    if (chart.id === "injuries") {
      return [
        {
          ...chart,
          title: "Absence",
          measures: `${absenceGlance(match.away.abbrev, match.awayInjuries.length)} ${absenceGlance(match.home.abbrev, match.homeInjuries.length)}`,
          effect: "",
          summary: "",
          series: chart.series.map((series) => ({
            ...series,
            points: series.points.map((point) => ({
              ...point,
              label: point.label.replace(/ plné$/, " mimo hru").replace(/ částečné$/, " den na den"),
            })),
          })),
        },
      ];
    }
    return [];
  });
}

function formGlance(name: string, rows: FormItem[]): string {
  if (rows.length === 0) return `${name} zatím nemá předchozí zápas.`;
  const wins = rows.filter((row) => row.result === "W").length;
  const word = wins === 1 ? "výhru" : wins > 1 && wins < 5 ? "výhry" : "výher";
  return `${name} má z posledních ${rows.length} zápasů ${wins} ${word}.`;
}

function absenceGlance(name: string, count: number): string {
  if (count === 0) return `${name}: nikdo nechybí.`;
  if (count === 1) return `${name}: chybí 1 hráč.`;
  if (count < 5) return `${name}: chybí ${count} hráči.`;
  return `${name}: chybí ${count} hráčů.`;
}

function plainRecord(summary: string): string {
  if (/elo|logit|příspěvek|váha|vzorec/i.test(summary)) return "";
  return summary;
}

function FormColumn({ title, rows }: { title: string; rows: FormItem[] }) {
  return (
    <div>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">Žádný předchozí zápas v datech.</p>
      ) : (
        <ul className="form-list">
          {rows.map((row) => (
            <li key={row.gameId}>
              <span className={`pill pill-${row.result}`} title={formTitle(row.result)}>
                {formLetter(row.result)}
              </span>
              <span>
                {row.teamScore}:{row.opponentScore} vs {row.opponentAbbrev}
              </span>
              <time dateTime={row.startsAt}>{when(row.startsAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InjuryColumn({ title, rows }: { title: string; rows: InjuryNote[] }) {
  return (
    <div>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">Žádná evidovaná absence ve zdroji.</p>
      ) : (
        <ul className="injuries">
          {rows.map((row) => (
            <li key={row.playerName}>
              <strong>{row.playerName}</strong>
              <span>{injuryStatus(row.status)}</span>
              {row.detail ? <p>{row.detail}</p> : null}
              <a href={row.sourceUrl} target="_blank" rel="noreferrer">
                {row.sourceName}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Rating({
  team,
  league,
  snapshot,
}: {
  team: MatchDetail["home"];
  league: MatchDetail["league"];
  snapshot: Snapshot | null;
}) {
  if (!snapshot) {
    return (
      <div className="rating">
        <h3>
          <Logo team={team} size={32} />
          {team.name}
        </h3>
        <p className="muted">
          Tabulka pro tenhle tým chybí.{" "}
          <Link to="/sources">Podívat se na zdroje</Link>
        </p>
      </div>
    );
  }
  const rank =
    snapshot.rank == null
      ? null
      : snapshot.rankScope === "conference"
        ? `pořadí v konferenci ${snapshot.rank}`
        : `pořadí v lize ${snapshot.rank}`;
  return (
    <div className="rating">
      <h3>
        <Logo team={team} size={32} />
        {team.name}
      </h3>
      <p className="record">
        {record(snapshot, league)}
        {snapshot.tablePoints != null ? ` · ${snapshot.tablePoints} bodů` : ""}
        {snapshot.scoreDiff != null ? ` · rozdíl ${snapshot.scoreDiff > 0 ? "+" : ""}${snapshot.scoreDiff}` : ""}
      </p>
      <p className="muted">
        {[rank, snapshot.conference, snapshot.division].filter(Boolean).join(" · ")}
      </p>
      <p>
        Zdroj: {snapshot.sourceName} · {originLabel(snapshot.origin)} · staženo {when(snapshot.fetchedAt)}
      </p>
      <a href={snapshot.sourceUrl} target="_blank" rel="noreferrer">
        {snapshot.sourceUrl.replace(/^https?:\/\//, "")}
      </a>
    </div>
  );
}
