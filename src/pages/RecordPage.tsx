import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { RecordCounts, RecordMonth, RecordResponse, RecordRow } from "../../shared/types";
import { getRecord } from "../api";
import { pct, when } from "../format";
import { useAppStatus } from "../status";

export function RecordPage() {
  const { generation } = useAppStatus();
  const [record, setRecord] = useState<RecordResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setError(null);
    getRecord()
      .then((data) => {
        if (!cancel) setRecord(data);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Úspěšnost se nepodařilo načíst");
      });
    return () => {
      cancel = true;
    };
  }, [generation]);

  if (error) return <p className="empty">{error}</p>;
  if (!record) return <p className="empty">Načítám úspěšnost…</p>;

  const liveWaiting = record.live.all.total === 0;

  return (
    <section>
      <div className="page-head">
        <h1>Jak odhady vyšly</h1>
        <p>Odhad vyšel, když vyhrál tým s vyšší šancí.</p>
        <p className="customer-note">Tohle je analýza zápasu, ne tip k sázce.</p>
      </div>
      <p className="rule-line">{record.rule}</p>

      <h2>Zpětný přepočet</h2>
      <p className="muted">
        Bere jen výsledky, které už byly známé před výkopem. Není to číslo uložené před zápasem.
      </p>
      <CountGrid counts={record.backtest} testId="record-backtest" />
      {record.backtest.even > 0 ? <p className="muted">{evenLine(record.backtest.even)}</p> : null}

      <h2>Uloženo před zápasem</h2>
      <p className="muted">Číslo je z posledního uložení před výkopem a po skončení se už nemění.</p>
      {liveWaiting ? (
        <p className="empty">
          Zatím žádný takto uložený odhad neskončil.
          {record.live.pending > 0 ? ` Čeká jich ${record.live.pending}.` : ""}
        </p>
      ) : (
        <CountGrid counts={record.live} testId="record-live" />
      )}

      <h2>Po měsících</h2>
      <MonthChart months={record.months} />

      <h2>Poslední zápasy</h2>
      {record.recent.length === 0 ? (
        <p className="empty">Zatím tu není žádný uzavřený zápas.</p>
      ) : (
        <ul className="grade-list" data-testid="record-recent">
          {record.recent.map((row) => (
            <GradeRow key={`${row.source}-${row.id}`} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CountGrid({
  counts,
  testId,
}: {
  counts: { all: RecordCounts; nba: RecordCounts; nhl: RecordCounts };
  testId: string;
}) {
  return (
    <div className="record-grid" data-testid={testId}>
      <CountCard title="Celkem" counts={counts.all} />
      <CountCard title="NBA" counts={counts.nba} />
      <CountCard title="NHL" counts={counts.nhl} />
    </div>
  );
}

function CountCard({ title, counts }: { title: string; counts: RecordCounts }) {
  return (
    <article className="record-card">
      <h3>{title}</h3>
      <strong>{pct(counts.rate)}</strong>
      <p>
        {counts.successful} vyšlo · {counts.unsuccessful} nevyšlo
      </p>
      <p className="muted">{counts.total} zápasů</p>
    </article>
  );
}

function MonthChart({ months }: { months: RecordMonth[] }) {
  const rows = months.filter((month) => month.backtest.total + month.live.total > 0);
  const live = rows.some((month) => month.live.total > 0);
  if (rows.length === 0) return <p className="empty">Na graf ještě není dost zápasů.</p>;
  return (
    <figure className="month-chart" data-testid="record-chart">
      <div className="month-legend">
        <span><i className="backtest" /> zpětný přepočet</span>
        {live ? <span><i className="live" /> před zápasem</span> : null}
      </div>
      <div className="month-cols">
        {rows.map((month) => (
          <div key={month.month} className="month-col">
            <span className="month-rate">{pct(month.backtest.total > 0 ? month.backtest.rate : month.live.rate)}</span>
            <div className="month-bars" title={`${month.label}: ${month.backtest.total} zápasů zpětně`}>
              {month.backtest.total > 0 ? (
                <i className="backtest" style={{ height: `${Math.max((month.backtest.rate ?? 0) * 100, 2)}%` }} />
              ) : null}
              {month.live.total > 0 ? (
                <i className="live" style={{ height: `${Math.max((month.live.rate ?? 0) * 100, 2)}%` }} />
              ) : null}
            </div>
            <span className="month-name">{shortMonth(month.label)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function GradeRow({ row }: { row: RecordRow }) {
  const chance = row.favored === "home" ? row.homeWinProb : 1 - row.homeWinProb;
  return (
    <li>
      <span className={row.success ? "grade-ok" : "grade-bad"}>{row.success ? "vyšlo" : "nevyšlo"}</span>
      <Link to={`/match/${row.id}`}>
        <span className={`chip chip-${row.league}`}>{row.league.toUpperCase()}</span> {row.awayAbbrev} {row.awayScore} :{" "}
        {row.homeScore} {row.homeAbbrev}
      </Link>
      <span>
        favorit {row.favoredAbbrev} · {pct(chance)}
      </span>
      <span className="muted">{row.source === "backtest" ? "zpětný přepočet" : "před zápasem"}</span>
      <time dateTime={row.startsAt}>{when(row.startsAt)}</time>
    </li>
  );
}

function evenLine(count: number): string {
  if (count === 1) return "Jeden zápas neměl favorita a do úspěšnosti nepatří.";
  if (count < 5) return `${count} zápasy neměly favorita a do úspěšnosti nepatří.`;
  return `${count} zápasů nemělo favorita a do úspěšnosti nepatří.`;
}

function shortMonth(label: string): string {
  const [month = label, year = ""] = label.split(" ");
  return `${month.slice(0, 3)} ${year.slice(2)}`;
}
