import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Factor, FormItem, InjuryNote, MatchDetail, Snapshot } from "../../shared/types";
import { getMatch } from "../api";
import {
  formLetter,
  formTitle,
  injuryStatus,
  lean,
  logit,
  originLabel,
  pct,
  record,
  when,
} from "../format";
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
      ? "Zpětná analýza. Počítáno jen z výsledků před tímto zápasem."
      : match.timing === "live"
        ? "Zápas právě probíhá. Čísla jsou z dat před výkopem."
        : "Předzápasová analýza.";

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
        <h1>Náznak skóre</h1>
        <p className="scoreline" data-testid="score-lean">
          {lean(match.prediction.scoreLeanAway, match.league)}
          <span> : </span>
          {lean(match.prediction.scoreLeanHome, match.league)}
          <small> {match.prediction.scoreUnit}</small>
        </p>
        <p className="muted">
          Není to kurz. Je to jen přepočet stejné pravděpodobnosti na běžný počet{" "}
          {match.prediction.scoreUnit}. Domácí jsou vpravo.
        </p>
      </section>

      <section>
        <h2>Faktory modelu</h2>
        <ol className="factors" data-testid="factors">
          {match.prediction.factors.map((factor) => (
            <FactorRow key={factor.key} factor={factor} />
          ))}
        </ol>
        <details>
          <summary>Jak se číslo počítá</summary>
          <p>{match.prediction.formula}</p>
          <ul>
            {match.prediction.assumptions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </section>

      <section className="split">
        <FormColumn title={`Forma ${match.away.abbrev}`} rows={match.awayForm} />
        <FormColumn title={`Forma ${match.home.abbrev}`} rows={match.homeForm} />
      </section>

      <section>
        <h2>Vzájemné zápasy</h2>
        {match.h2h.length === 0 ? (
          <p className="muted">V načtené sezóně se tyhle týmy ještě nepotkaly.</p>
        ) : (
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
      <p className="muted">{match.injuryNote}</p>

      <section data-testid="sources-panel">
        <h2>Odkud je předzápasové hodnocení</h2>
        <p className="muted">{match.snapshotNote}</p>
        <div className="split">
          <Rating team={match.away.name} league={match.league} snapshot={match.awaySnapshot} />
          <Rating team={match.home.name} league={match.league} snapshot={match.homeSnapshot} />
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
      <Logo team={team} />
      <div>
        <small>{role}</small>
        <strong>{team.name}</strong>
        <span>{team.abbrev}</span>
      </div>
    </div>
  );
}

function FactorRow({ factor }: { factor: Factor }) {
  return (
    <li className={factor.used ? "" : "unused"}>
      <div>
        <strong>{factor.label}</strong>
        <span>{factor.used ? logit(factor.logit) : "mimo výpočet"}</span>
      </div>
      <p>{factor.detail}</p>
    </li>
  );
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
  team: string;
  league: MatchDetail["league"];
  snapshot: Snapshot | null;
}) {
  if (!snapshot) {
    return (
      <div className="rating">
        <h3>{team}</h3>
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
      <h3>{team}</h3>
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
