import { useEffect, useState } from "react";
import type { AnglesResponse } from "../../shared/types";
import { getAngles } from "../api";
import { AngleFooter, AngleList } from "../Angles";
import { pct } from "../format";
import { useAppStatus } from "../status";

export function AnglesPage() {
  const { generation } = useAppStatus();
  const [data, setData] = useState<AnglesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setError(null);
    getAngles()
      .then((next) => {
        if (!cancel) setData(next);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Příležitosti se nepodařilo načíst");
      });
    return () => {
      cancel = true;
    };
  }, [generation]);

  if (error) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">Načítám příležitosti…</p>;

  const used = new Set(data.days.flatMap((day) => day.lines.map((line) => line.market)));
  const shown = data.markets.filter((market) => market.shown && used.has(market.market));
  const count = data.days.reduce((sum, day) => sum + day.lines.length, 0);

  return (
    <section>
      <div className="page-head">
        <h1>Příležitosti</h1>
        <p>Věty k nejbližším zápasům. Jen tam, kde čísla z načteného roku dávají smysl.</p>
      </div>
      <AngleFooter
        disclaimer={data.disclaimer}
        responsible={data.responsible}
        note={data.note}
        ppNote={data.ppNote}
      />
      {data.coverageNote ? <p className="muted">{data.coverageNote}</p> : null}
      {shown.length > 0 ? (
        <ul className="angle-rates" data-testid="angle-rates">
          {shown.map((market) => (
            <li key={market.market}>
              {market.label}: v přepočtu {pct(market.rate)} ({market.hits} z {market.n}).
            </li>
          ))}
        </ul>
      ) : null}
      {count === 0 ? (
        <p className="empty">Dnes ani v nejbližších dnech není věta, která by v přepočtu vycházela výrazně nad polovinu.</p>
      ) : (
        data.days.map((day) => (
          <section key={day.date} className="day">
            <h2>{day.label}</h2>
            <AngleList lines={day.lines} linked />
          </section>
        ))
      )}
    </section>
  );
}
