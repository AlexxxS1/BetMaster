import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { League, MatchSummary } from "../../shared/types";
import { getMatches } from "../api";
import { clock, dayKey, dayLabel, pct } from "../format";
import { Logo } from "../Logo";
import { useAppStatus } from "../status";

type View = "upcoming" | "recent";

export function Board() {
  const { generation } = useAppStatus();
  const [params, setParams] = useSearchParams();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("upcoming");
  const league = params.get("league") === "nba" || params.get("league") === "nhl" ? params.get("league") : "all";

  useEffect(() => {
    let cancel = false;
    setError(null);
    getMatches()
      .then((data) => {
        if (!cancel) setMatches(data.matches);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Zápasy se nepodařilo načíst");
      });
    return () => {
      cancel = true;
    };
  }, [generation]);

  function chooseLeague(next: "all" | League) {
    const query = new URLSearchParams(params);
    if (next === "all") query.delete("league");
    else query.set("league", next);
    setParams(query);
  }

  const now = Date.now();
  const visible = (matches ?? []).filter((match) => {
    if (league !== "all" && match.league !== league) return false;
    const time = new Date(match.startsAt).getTime();
    if (view === "upcoming") {
      return match.status !== "final" && match.status !== "postponed" && time >= now - 6 * 60 * 60 * 1000;
    }
    return match.status === "final" && time >= now - 21 * 24 * 60 * 60 * 1000;
  });
  visible.sort((a, b) =>
    view === "recent" ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt),
  );

  const groups = new Map<string, MatchSummary[]>();
  for (const match of visible) {
    const key = dayKey(match.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }

  return (
    <section>
      <div className="page-head">
        <h1>{view === "upcoming" ? "Nejbližší zápasy" : "Poslední výsledky"}</h1>
        <p>Otevři zápas a uvidíš formu, vzájemné zápasy, absence a z čeho se skládá pravděpodobnost.</p>
      </div>
      <div className="toolbar">
        <div className="segment" role="group" aria-label="Soutěž">
          {(
            [
              ["all", "Vše"],
              ["nhl", "NHL"],
              ["nba", "NBA"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={league === value}
              className={league === value ? "on" : ""}
              onClick={() => chooseLeague(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="segment" role="group" aria-label="Období">
          <button type="button" aria-pressed={view === "upcoming"} className={view === "upcoming" ? "on" : ""} onClick={() => setView("upcoming")}>
            Nadcházející
          </button>
          <button type="button" aria-pressed={view === "recent"} className={view === "recent" ? "on" : ""} onClick={() => setView("recent")}>
            Odehrané
          </button>
        </div>
      </div>
      {error ? <p className="empty">{error}</p> : null}
      {matches === null && !error ? <p className="empty">Načítám zápasy…</p> : null}
      {matches && visible.length === 0 ? (
        <p className="empty">
          V tomhle pohledu nic není.{" "}
          {view === "upcoming" ? (
            <button type="button" className="linkish" onClick={() => setView("recent")}>
              Ukázat odehrané
            </button>
          ) : (
            <button type="button" className="linkish" onClick={() => setView("upcoming")}>
              Ukázat nadcházející
            </button>
          )}
        </p>
      ) : null}
      <div data-testid="match-list">
        {[...groups.entries()].map(([day, rows]) => (
          <section key={day} className="day">
            <h2>{dayLabel(day)}</h2>
            {rows.map((match) => (
              <Link key={match.id} to={`/match/${match.id}`} className={`match league-${match.league}`} data-testid="match-row">
                <div className="when">
                  <span className={`chip chip-${match.league}`}>{match.league.toUpperCase()}</span>
                  <time dateTime={match.startsAt}>{clock(match.startsAt)}</time>
                  {match.status === "live" ? <span className="live">žije</span> : null}
                </div>
                <div className="sides">
                  <TeamLine team={match.away} score={match.awayScore} showScore={match.status === "final" || match.status === "live"} />
                  <TeamLine team={match.home} score={match.homeScore} showScore={match.status === "final" || match.status === "live"} home />
                </div>
                <div className="lean-col">
                  <strong>{pct(match.modelHomeWinProb)}</strong>
                  <small>{match.status === "final" ? "model před zápasem" : "domácí"}</small>
                </div>
              </Link>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}

function TeamLine({
  team,
  score,
  showScore,
  home = false,
}: {
  team: MatchSummary["home"];
  score: number | null;
  showScore: boolean;
  home?: boolean;
}) {
  return (
    <div className="side">
      <Logo team={team} />
      <div>
        <strong>{team.abbrev}</strong>
        <span>{team.name}</span>
      </div>
      {home ? <em>doma</em> : <em>venku</em>}
      {showScore ? <b className="pts">{score ?? "–"}</b> : null}
    </div>
  );
}
