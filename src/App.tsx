import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAppStatus } from "./status";
import { when } from "./format";

const ANALYSIS_KEY = "betmaster-analysis";

export function Shell() {
  const { status, error, refresh } = useAppStatus();
  const refreshing = status?.refreshing ?? false;
  const { pathname } = useLocation();
  const openMatch = pathname.startsWith("/match/")
    ? decodeURIComponent(pathname.slice("/match/".length).split("/")[0] ?? "")
    : "";
  const [remembered, setRemembered] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (openMatch) {
        sessionStorage.setItem(ANALYSIS_KEY, openMatch);
        setRemembered(openMatch);
      } else {
        setRemembered(sessionStorage.getItem(ANALYSIS_KEY));
      }
    } catch {
      setRemembered(openMatch || null);
    }
  }, [openMatch]);

  const analysisTo = openMatch ? `/match/${openMatch}` : remembered ? `/match/${remembered}` : null;

  return (
    <div className="shell">
      <header className="nav">
        <NavLink to="/" className={() => "brand"} end>
          <span className="brand-lockup">
            <span className="brand-mark">Bet</span>
            <span className="brand-mark accent">Master</span>
          </span>
          <span className="league-marks">
            <LeagueMark src="https://assets.nhle.com/logos/nhl/svg/NHL_light.svg" label="NHL" />
            <LeagueMark src="https://a.espncdn.com/i/teamlogos/leagues/500/nba.png" label="NBA" />
          </span>
          <small>Analýza zápasů NBA a NHL</small>
        </NavLink>
        <nav className="nav-links" aria-label="Hlavní menu">
          <NavLink to="/" end data-testid="nav-zapasy">
            <span className="nav-label">Zápasy</span>
            <small className="nav-hint">Seznam utkání</small>
          </NavLink>
          {analysisTo ? (
            <NavLink to={analysisTo} data-testid="nav-analyza">
              <span className="nav-label">Analýza</span>
              <small className="nav-hint">Jak zápas vypadá</small>
            </NavLink>
          ) : (
            <span className="nav-disabled" data-testid="nav-analyza" title="Nejdřív otevři zápas">
              <span className="nav-label">Analýza</span>
              <small className="nav-hint">Nejdřív otevři zápas</small>
            </span>
          )}
          <NavLink to="/prilezitosti" data-testid="nav-prilezitosti">
            <span className="nav-label">Příležitosti</span>
            <small className="nav-hint">Věty z čísel</small>
          </NavLink>
          <NavLink to="/uspesnost" data-testid="nav-uspesnost">
            <span className="nav-label">Úspěšnost</span>
            <small className="nav-hint">Jak odhady vyšly</small>
          </NavLink>
          <NavLink to="/sources" data-testid="nav-zdroje">
            <span className="nav-label">Zdroje</span>
            <small className="nav-hint">Odkud jsou data</small>
          </NavLink>
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
          Tohle je analýza zápasu, ne tip k sázce.
          {status?.lastIngestAt ? ` Data naposledy ${when(status.lastIngestAt)}.` : ""}
        </footer>
      </div>
    </div>
  );
}

function LeagueMark({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="league-fallback">{label}</span>;
  return (
    <img
      className="league-logo"
      src={src}
      alt=""
      width={28}
      height={28}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
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
