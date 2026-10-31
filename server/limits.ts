import type { SourceItem } from "../shared/types";

export const BLOCKED_SOURCES: SourceItem[] = [
  {
    id: "nba-com",
    league: "nba",
    kind: "results",
    name: "nba.com",
    url: "https://www.nba.com/",
    mode: "blocked",
    fetchedAt: null,
    detail:
      "Veřejné JSON na cdn.nba.com (rozpis, scoreboard, tabulka) vrací HTTP 403 Access Denied. stats.nba.com na obyčejný požadavek neodpověděl (timeout). Prohlížečové hlavičky, cookies ani jiné obcházení ochrany jsme nepoužili. Výsledky NBA bereme z veřejného skóre ESPN, a když ani to není dostupné, z kontrolního vzorku v repozitáři.",
  },
  {
    id: "livesport",
    league: "all",
    kind: "results",
    name: "Livesport.cz",
    url: "https://www.livesport.cz/robots.txt",
    mode: "blocked",
    fetchedAt: null,
    detail:
      "Livesport.cz nenabízí otevřené API. robots.txt zakazuje automatický přístup k výsledkovým a živým cestám (/basketbal/, /hokej/ a další). Data odtud nestahujeme.",
  },
  {
    id: "nhl-injuries-api",
    league: "nhl",
    kind: "injuries",
    name: "NHL API absencí",
    url: "https://api-web.nhle.com/v1/injuries",
    mode: "blocked",
    fetchedAt: null,
    detail:
      "Veřejné webové API, které používá nhl.com, nemá endpoint absencí (GET /v1/injuries vrací 404) a soupiska týmu stav zranění neobsahuje. Seznam absencí NHL bereme z veřejné stránky ESPN, se stejnou výhradou jako u NBA.",
  },
];
