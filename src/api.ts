import type {
  AnglesResponse,
  MatchDetail,
  MatchesResponse,
  RecordResponse,
  SourcesResponse,
  StatusResponse,
} from "../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Požadavek selhal (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function getStatus(): Promise<StatusResponse> {
  return request("/api/status");
}

export function getMatches(): Promise<MatchesResponse> {
  return request("/api/matches");
}

export function getMatch(id: string): Promise<MatchDetail> {
  return request(`/api/matches/${encodeURIComponent(id)}`);
}

export function getSources(): Promise<SourcesResponse> {
  return request("/api/sources");
}

export function getRecord(): Promise<RecordResponse> {
  return request("/api/record");
}

export function getAngles(): Promise<AnglesResponse> {
  return request("/api/angles");
}

export function postIngest(): Promise<StatusResponse> {
  return request("/api/ingest", { method: "POST" });
}
