const ALIASES: Record<string, string> = {
  "la clippers": "los angeles clippers",
  "ny islanders": "new york islanders",
  "ny rangers": "new york rangers",
};

export function normName(value: string): string {
  const plain = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ALIASES[plain] ?? plain;
}

export function slug(value: string): string {
  const plain = normName(value).replace(/ /g, "-");
  return plain || "hrac";
}

export function teamId(league: "nba" | "nhl", abbrev: string): string {
  return `${league}-${abbrev.trim().toUpperCase()}`;
}
