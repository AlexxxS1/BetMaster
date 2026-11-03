import { useEffect, useState } from "react";
import type { SourceItem } from "../../shared/types";
import { getSources } from "../api";
import { when } from "../format";
import { useAppStatus } from "../status";

const KIND: Record<SourceItem["kind"], string> = {
  results: "Výsledky a rozpis",
  standings: "Předzápasové hodnocení",
  injuries: "Absence",
  splits: "Sezonní čísla",
  boxscore: "Zápis zápasu",
};

const MODE: Record<SourceItem["mode"], string> = {
  live: "Živě",
  sample: "Vzorek",
  blocked: "Nepoužito",
};

export function SourcesPage() {
  const { generation } = useAppStatus();
  const [sources, setSources] = useState<SourceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    getSources()
      .then((data) => {
        if (!cancel) setSources(data.sources);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Zdroje se nepodařilo načíst");
      });
    return () => {
      cancel = true;
    };
  }, [generation]);

  return (
    <section>
      <div className="page-head">
        <h1>Zdroje</h1>
        <p>
          Odkud se berou výsledky, tabulky a absence. Když zdroj nejde použít bez obcházení ochrany,
          zůstane tady napsané proč a aplikace jede ze vzorku nebo z povolené veřejné náhrady.
        </p>
      </div>
      {error ? <p className="empty">{error}</p> : null}
      {sources === null && !error ? <p className="empty">Načítám zdroje…</p> : null}
      <ul className="sources">
        {(sources ?? []).map((source) => (
          <li key={source.id} className={`mode-${source.mode}`}>
            <div className="source-top">
              <span className={`mode mode-${source.mode}`}>{MODE[source.mode]}</span>
              <span className="chip">{KIND[source.kind]}</span>
              <span className="chip">{source.league === "all" ? "NBA + NHL" : source.league.toUpperCase()}</span>
            </div>
            <h2>{source.name}</h2>
            <p>{source.detail}</p>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.url}
            </a>
            {source.fetchedAt ? <small>Záznam z {when(source.fetchedAt)}</small> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
