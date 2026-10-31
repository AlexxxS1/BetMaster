# BetMaster

Analýza zápasů NBA a NHL. Aplikace stáhne veřejné výsledky a tabulky, uloží je lokálně a u zápasu ukáže formu, vzájemné zápasy, absence a průhledný odhad pravděpodobnosti. **Není to sázková kancelář, tipovací servis ani doporučení, kam dát peníze.**

Tohle je samostatný repozitář. PrivaTicker se ho netýká.

## Jak to spustit

Potřeba je Node.js 22+.

```bash
npm install
npm test
npm run dev
```

Otevři [http://localhost:5180](http://localhost:5180). API běží na portu 8787 a Vite ho proxuje pod `/api`.

- Seznam zápasů je na úvodní stránce. Přepínač NHL / NBA a Nadcházející / Odehrané.
- Kliknutí na zápas otevře analýzu: forma, vzájemné zápasy, absence, faktory modelu a odkud je tabulka.
- Stránka Zdroje říká, co je živé, co je vzorek a co nešlo použít.
- Tlačítko Obnovit data stáhne zdroje znovu.

Jen vzorek, bez sítě:

```bash
BETMASTER_SKIP_LIVE=1 npm run dev
```

Jednorázové stažení a přepsání kontrolního vzorku v gitu:

```bash
npm run ingest -- --write-sample
```

Produkční běh na jednom portu:

```bash
npm run build
npm start
```

`npm start` servíruje API i frontend na [http://localhost:5180](http://localhost:5180).

Kontroly: `npm test` a `npm run typecheck`.

## Co je živé a co je vzorek

| Data | Živý zdroj | Když živý zdroj selže |
| --- | --- | --- |
| NHL výsledky a rozpis | Veřejné JSON `api-web.nhle.com`, které používá nhl.com | Kontrolní snímek v `data/sample/snapshot.json` |
| NHL tabulka | Stejné API, odkaz na [nhl.com/standings](https://www.nhl.com/standings) | Stejný snímek |
| NBA výsledky a rozpis | Veřejné JSON ESPN scoreboard | Stejný snímek |
| NBA tabulka | [ESPN standings](https://www.espn.com/nba/standings) | Stejný snímek |
| Absence NBA i NHL | Veřejné seznamy ESPN | Stejný snímek, nebo faktor absencí zůstane vypnutý |

Při startu se prázdná databáze naplní vzorkem, aby šla aplikace otevřít hned. Pak se na pozadí zkusí živé zdroje. Když jsou data mladší než 6 hodin, znovu se nestahují. SQLite soubor `data/betmaster.sqlite` se do gitu necommituje.

U zápasu je badge „živě“ nebo „vzorek“. Na stránce Zdroje je totéž u každého feedu.

## Zdroje, které nejdou použít

- **nba.com.** `cdn.nba.com` vrací HTTP 403 Access Denied. `stats.nba.com` na obyčejný požadavek neodpověděl (timeout). Prohlížečové hlavičky, cookies ani jiné obcházení ochrany se nepoužívají. Místo toho je veřejný scoreboard ESPN a kontrolní vzorek.
- **Livesport.cz.** Nemá otevřené API. `robots.txt` zakazuje automatický přístup k výsledkovým a živým cestám (`/basketbal/`, `/hokej/` a další). Odtud se nic nestahuje.
- **Oficiální absence NHL.** `api-web.nhle.com/v1/injuries` vrací 404 a soupiska stav zranění neobsahuje. Seznam bere veřejná stránka ESPN.

Kurzy z NHL odpovědi se ignorují. Aplikace nemá účty, platby ani tikety.

## Model a jeho limity

Baseline, ne black box. U zápasu je vidět každý člen součtu.

```
logit = ln(10)/400 × domácí výhoda
      + ln(10)/400 × (Elo domácí − Elo hosté)
      + 0,35 × forma
      + 0,20 × vzájemné zápasy
      + absence
P(domácí) = 1 / (1 + e^(−logit))
```

Předpoklady, schválně ruční, ne natrénované na skrytých datech:

- Elo začíná na 1500. Po zápase se posune o K = 24. Minulá sezóna se nepřenáší, protože se stahuje jen probíhající sezóna a pár dní dopředu.
- Domácí výhoda je 40 Elo v NHL a 70 Elo v NBA (historicky zhruba 55–60 % výher domácích). Na neutrálním hřišti je 0.
- Forma je průměrný rozdíl skóre z nejvýše pěti předchozích zápasů.
- Vzájemné zápasy se započtou až od dvou společných utkání.
- Plná absence (Out, injured reserve, suspension) posune logit o 0,06, částečná (day-to-day) o 0,02, strop ±0,24. Důležitost hráče model nezná.
- Vítěz včetně prodloužení bere 1, poražený 0.
- U odehraného zápasu se dnešní absence do pravděpodobnosti nepočítají. Neznáme sestavu před výkopem. Seznam na stránce je dnešní snímek.
- Tabulka je taky dnešní snímek, ne archiv k času výkopu. Do pravděpodobnosti nevstupuje. Elo a forma berou jen výsledky před zápasem.
- Náznak skóre je jen přepočet pravděpodobnosti na běžný počet gólů nebo bodů. Není to kurz.

Brzy v sezóně je Elo hlučné, protože týmy mají málo zápasů. Model neříká, jak sázet.

## English

BetMaster is a local NBA/NHL match analysis app. It stores public results and standings, then shows form, head-to-head games, injury notes, and a transparent win probability. It is analysis, not betting advice. There are no accounts, payments, or bet slips.

Run `npm install` and `npm run dev` in this repository, then open http://localhost:5180. `BETMASTER_SKIP_LIVE=1` keeps the checked-in sample. Live NHL results come from the public `api-web.nhle.com` JSON used by nhl.com. nba.com blocks automated reads (CDN 403, stats timeout), and Livesport.cz has no open API and disallows result pages in robots.txt, so those are not scraped. NBA scores, standings, and both injury lists use ESPN's public JSON, with `data/sample/snapshot.json` as the offline fallback. The model is hand-weighted Elo plus recent margin, head-to-head, and a capped injury adjustment. Weights are constants, not a fitted black box. Early-season ratings are noisy, and today's injury list is not applied to already played games.
