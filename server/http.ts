const USER_AGENT = "BetMaster/0.1 (local match analysis; public JSON only)";

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pro ${url}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Odpověď z ${url} není JSON`);
  }
}
