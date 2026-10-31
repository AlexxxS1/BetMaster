import type { ChartPoint, League, MatchChart } from "../shared/types";
import type { ChartSnapshot } from "./analyze";
import type { ModelResult } from "./model";
import { FORM_WEIGHT, H2H_WEIGHT, HOME_ELO } from "./model";

type FormSide = {
  opponentAbbrev: string;
  teamScore: number;
  opponentScore: number;
};

type H2HSide = {
  startsAt: string;
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
};

export function buildMatchCharts(input: {
  league: League;
  homeAbbrev: string;
  awayAbbrev: string;
  neutral: boolean;
  model: ModelResult;
  formHome: FormSide[];
  formAway: FormSide[];
  h2h: H2HSide[];
  chart?: ChartSnapshot;
}): MatchChart[] {
  const { home, elo, form, h2h, absence } = input.model.factors;
  const homeName = input.homeAbbrev;
  const awayName = input.awayAbbrev;
  return [
    factorChart(home.logit, elo.logit, form.logit, h2h.logit, absence.logit),
    eloChart(homeName, awayName, input.chart),
    formChart(homeName, awayName, input.formHome, input.formAway, form),
    h2hChart(homeName, input.h2h, h2h),
    venueChart(input.league, homeName, awayName, input.neutral, home.logit, input.chart),
    injuryChart(homeName, awayName, absence),
  ];
}

function factorChart(
  home: number,
  elo: number,
  form: number,
  h2h: number,
  absence: number,
): MatchChart {
  return {
    id: "factors",
    title: "Co posouvá odhad",
    measures: "Každý sloupec je příspěvek jednoho faktoru k logitu před zápasem.",
    effect: "Kladné číslo nahrává domácím. Součet jde do sigmoidy a z ní je pravděpodobnost. Analýza, ne sázkový tip.",
    summary: `Domácí ${signed(home)}, Elo ${signed(elo)}, forma ${signed(form)}, vzájemné ${signed(h2h)}, absence ${signed(absence)}.`,
    kind: "bar",
    color: "sign",
    series: [
      {
        name: "Faktory",
        tone: "neutral",
        points: [
          { label: "Domácí prostředí", value: home },
          { label: "Elo", value: elo },
          { label: "Forma", value: form },
          { label: "Vzájemné zápasy", value: h2h },
          { label: "Absence", value: absence },
        ],
      },
    ],
  };
}

function eloChart(homeName: string, awayName: string, chart: ChartSnapshot | undefined): MatchChart {
  const homePath = chart?.eloHome ?? [];
  const awayPath = chart?.eloAway ?? [];
  const homeNow = homePath.at(-1)?.value;
  const awayNow = awayPath.at(-1)?.value;
  return {
    id: "elo",
    title: "Elo za načtený rok",
    measures: "Síla týmu po každém odehraném zápase v okně. Čára začíná na 1500.",
    effect: "Do odhadu jde rozdíl před tímto zápasem: ln(10)/400 × (Elo domácí − Elo hosté). Výš postavená čára domácích zvedá jejich šanci.",
    summary:
      homeNow == null || awayNow == null
        ? "Elo před zápasem ještě není z čeho spočítat."
        : `${homeName} ${Math.round(homeNow)}, ${awayName} ${Math.round(awayNow)}, rozdíl ${signed(homeNow - awayNow)} bodů Elo.`,
    kind: "line",
    color: "tone",
    series: [
      { name: homeName, tone: "home", points: homePath },
      { name: awayName, tone: "away", points: awayPath },
    ],
  };
}

function formChart(
  homeName: string,
  awayName: string,
  formHome: FormSide[],
  formAway: FormSide[],
  form: ModelResult["factors"]["form"],
): MatchChart {
  return {
    id: "form",
    title: "Forma z posledních pěti",
    measures: "Rozdíl skóre v každém z nejvýše pěti předchozích zápasů. Kladné číslo znamená, že tým dal víc, než dostal.",
    effect: `Model ty rozdíly zprůměruje a vezme je váhou ${String(FORM_WEIGHT).replace(".", ",")}. Starší zápasy roku do formy nejdou, zůstávají v Elu a ve vzájemných zápasech.`,
    summary: form.used
      ? `${homeName} průměr ${margin(form.homeAvg)}, ${awayName} průměr ${margin(form.awayAvg)}, příspěvek ${signed(form.logit)}.`
      : "Ani jeden tým nemá předchozí výsledek, forma do odhadu nejde.",
    kind: "bar",
    color: "sign",
    series: [
      { name: homeName, tone: "home", points: margins(homeName, formHome) },
      { name: awayName, tone: "away", points: margins(awayName, formAway) },
    ],
  };
}

function h2hChart(
  homeAbbrev: string,
  rows: H2HSide[],
  h2h: ModelResult["factors"]["h2h"],
): MatchChart {
  const chronological = [...rows].reverse();
  return {
    id: "h2h",
    title: "Vzájemné zápasy za rok",
    measures: "Rozdíl skóre z pohledu dnešních domácích v každém společném zápase načteného okna.",
    effect: `Od dvou zápasů váha ${String(H2H_WEIGHT).replace(".", ",")} podle podílu výher. Jeden společný zápas model schválně vynechá.`,
    summary: h2h.used
      ? `${h2h.games} zápasů, dnešní domácí ${h2h.homeWins} výher, hosté ${h2h.awayWins}, příspěvek ${signed(h2h.logit)}.`
      : h2h.games === 0
        ? "V načteném roce se týmy ještě nepotkaly."
        : "Zatím jeden společný zápas, do odhadu se nepočítá.",
    kind: "bar",
    color: "sign",
    series: [
      {
        name: homeAbbrev,
        tone: "home",
        points: chronological.map((row) => ({
          label: row.startsAt.slice(0, 10),
          value: row.homeAbbrev === homeAbbrev ? row.homeScore - row.awayScore : row.awayScore - row.homeScore,
        })),
      },
    ],
  };
}

function venueChart(
  league: League,
  homeName: string,
  awayName: string,
  neutral: boolean,
  homeLogit: number,
  chart: ChartSnapshot | undefined,
): MatchChart {
  const homeSplit = chart?.homeSplit;
  const awaySplit = chart?.awaySplit;
  const advantage = HOME_ELO[league];
  return {
    id: "home-away",
    title: "Doma a venku za rok",
    measures: "Procento výher doma a venku ze zápasů před tímto utkáním.",
    effect: neutral
      ? "Hřiště je neutrální, pevná domácí výhoda je nula a do odhadu nejde. Bilance doma a venku je jen kontext."
      : `Do vzorce nejde tahle bilance, ale pevná domácí výhoda ${advantage} Elo (logit ${signed(homeLogit)}).`,
    summary: `${splitText(homeName, homeSplit)} ${splitText(awayName, awaySplit)}`.trim(),
    kind: "bar",
    color: "tone",
    series: [
      { name: homeName, tone: "home", points: splitPoints(homeName, homeSplit) },
      { name: awayName, tone: "away", points: splitPoints(awayName, awaySplit) },
    ],
  };
}

function injuryChart(
  homeName: string,
  awayName: string,
  absence: ModelResult["factors"]["absence"],
): MatchChart {
  return {
    id: "injuries",
    title: "Absence",
    measures: "Počet plných absencí (Out, injured reserve, stopka) a částečných (ze dne na den) v aktuálním seznamu.",
    effect: absence.used
      ? "Plná absence bere 0,06 logitu, částečná 0,02, dohromady nejvýš ±0,24. Víc absencí domácích snižuje jejich šanci."
      : "U odehraného zápasu se dnešní seznam nepočítá, protože neznáme sestavu před výkopem. U nadcházejícího zápasu bez seznamu je faktor vypnutý.",
    summary: `${homeName}: ${absence.homeOut} plných, ${absence.homePartial} částečných. ${awayName}: ${absence.awayOut} plných, ${absence.awayPartial} částečných. Příspěvek ${signed(absence.logit)}.`,
    kind: "bar",
    color: "tone",
    series: [
      {
        name: homeName,
        tone: "home",
        points: [
          { label: `${homeName} plné`, value: absence.homeOut },
          { label: `${homeName} částečné`, value: absence.homePartial },
        ],
      },
      {
        name: awayName,
        tone: "away",
        points: [
          { label: `${awayName} plné`, value: absence.awayOut },
          { label: `${awayName} částečné`, value: absence.awayPartial },
        ],
      },
    ],
  };
}

function margins(name: string, rows: FormSide[]): ChartPoint[] {
  return [...rows].reverse().map((row) => ({
    label: `${name} vs ${row.opponentAbbrev}`,
    value: row.teamScore - row.opponentScore,
  }));
}

function splitPoints(name: string, split: ChartSnapshot["homeSplit"] | undefined): ChartPoint[] {
  if (!split) return [];
  const points: ChartPoint[] = [];
  if (split.homeGames > 0) {
    points.push({ label: `${name} doma`, value: (100 * split.homeWins) / split.homeGames });
  }
  if (split.awayGames > 0) {
    points.push({ label: `${name} venku`, value: (100 * split.awayWins) / split.awayGames });
  }
  return points;
}

function splitText(name: string, split: ChartSnapshot["homeSplit"] | undefined): string {
  if (!split || (split.homeGames === 0 && split.awayGames === 0)) return `${name}: bez zápasů doma ani venku.`;
  const home = split.homeGames === 0 ? "doma —" : `doma ${split.homeWins}/${split.homeGames}`;
  const away = split.awayGames === 0 ? "venku —" : `venku ${split.awayWins}/${split.awayGames}`;
  return `${name} ${home}, ${away}.`;
}

function margin(value: number | null): string {
  if (value == null) return "bez zápasu";
  return signed(value);
}

function signed(value: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    signDisplay: "exceptZero",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}
