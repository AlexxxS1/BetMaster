import { NavLink, Outlet } from "react-router-dom";
import { useAppStatus } from "./status";
import { when } from "./format";

export function Shell() {
  const { status, error, refresh } = useAppStatus();
  const refreshing = status?.refreshing ?? false;

  return (
    <div className="shell">
      <header className="nav">
        <NavLink to="/" className="brand" end>
          <span className="brand-mark">Bet</span>
          <span className="brand-mark accent">Master</span>
          <small>Analýza zápasů NBA a NHL</small>
        </NavLink>
        <nav className="nav-links">
          <NavLink to="/" end>
            Zápasy
          </NavLink>
          <NavLink to="/sources">Zdroje</NavLink>
        </nav>
        <button className="refresh" type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "Obnovuji…" : "Obnovit data"}
        </button>
      </header>
      <div className="main">
        <StatusBanner />
        {error ? <p className="banner banner-bad">API neodpovídá: {error}</p> : null}
        <Outlet />
        <footer className="footnote">
          Čísla jsou analýza veřejných výsledků, ne doporučení k sázce. Model je jednoduchý baseline s
          zveřejněnými konstantami.
          {status?.lastIngestAt ? ` Poslední pokus o stažení: ${when(status.lastIngestAt)}.` : ""}
        </footer>
      </div>
    </div>
  );
}

function StatusBanner() {
  const { status } = useAppStatus();
  if (!status) return <p className="banner">Načítám stav dat…</p>;
  if (status.refreshing) {
    return <p className="banner">Obnovuji veřejné zdroje. Seznam se doplní, jakmile doběhnou.</p>;
  }
  const tone =
    status.mode === "live" ? "banner-live" : status.mode === "empty" ? "banner-bad" : "banner-sample";
  const text =
    status.mode === "live"
      ? `Živá data. NBA ${status.nbaGames} zápasů, NHL ${status.nhlGames} zápasů.`
      : status.mode === "sample"
        ? "Kontrolní vzorek z repozitáře. Živý zdroj teď není v datech."
        : status.mode === "mixed"
          ? "Část zápasů je živá, část je kontrolní vzorek. Rozdíl je u každého zápasu."
          : "Zatím tu nejsou žádné zápasy.";
  return (
    <p className={`banner ${tone}`}>
      {text}{" "}
      {status.warnings.length > 0 ? <span className="warn">{status.warnings[0]}</span> : null}
    </p>
  );
}
