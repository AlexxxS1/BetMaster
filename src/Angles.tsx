import { Link } from "react-router-dom";
import type { AngleLine } from "../shared/types";
import { clock } from "./format";

export function AngleList({ lines, linked }: { lines: AngleLine[]; linked: boolean }) {
  return (
    <div className="angle-list" data-testid="angle-list">
      {lines.map((line) => (
        <article key={line.id} className={`angle-card league-${line.league}`} data-testid="angle-line">
          <p className="kicker">
            <span className={`chip chip-${line.league}`}>{line.league.toUpperCase()}</span>
            {linked ? (
              <Link to={`/match/${encodeURIComponent(line.gameId)}`}>
                {line.awayAbbrev} – {line.homeAbbrev}
              </Link>
            ) : (
              <span>
                {line.awayName} – {line.homeName}
              </span>
            )}
            <time dateTime={line.startsAt}>{clock(line.startsAt)}</time>
            <span>{line.marketLabel}</span>
          </p>
          <p className="angle-text">{line.text}</p>
          <p className="angle-meta">{line.detail}</p>
        </article>
      ))}
    </div>
  );
}

export function AngleFooter({
  disclaimer,
  responsible,
  note,
  ppNote,
}: {
  disclaimer: string;
  responsible: string;
  note: string;
  ppNote: string;
}) {
  return (
    <div className="angle-foot">
      <p className="customer-note" data-testid="angles-disclaimer">
        {disclaimer}
      </p>
      <p className="responsible" data-testid="angles-responsible">
        {responsible}
      </p>
      <p className="muted">{note}</p>
      {ppNote ? <p className="muted">{ppNote}</p> : null}
    </div>
  );
}
