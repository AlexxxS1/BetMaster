import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { BLOCKED_SOURCES } from "./limits";
import { openDatabase } from "./db";
import { startIngest } from "./ingest";
import { loadSampleIfEmpty } from "./sample";
import { matchResponse, matchesResponse, sourcesResponse, statusOf } from "./present";
import { recordResponse } from "./record";

const db = openDatabase();
const loadedSample = loadSampleIfEmpty(db);
if (loadedSample) console.log("[betmaster] načten kontrolní vzorek");
if (process.env.BETMASTER_SKIP_LIVE !== "1") {
  void startIngest(db).catch((error: unknown) => {
    console.error("[betmaster] obnova selhala", error);
  });
}

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/status", (c) => c.json(statusOf(db)));

app.get("/api/matches", (c) => {
  const league = c.req.query("league");
  const matches = matchesResponse(db).filter(
    (match) => !league || league === "all" || match.league === league,
  );
  return c.json({ matches });
});

app.get("/api/matches/:id", (c) => {
  const match = matchResponse(db, c.req.param("id"));
  if (!match) return c.json({ error: "Zápas nenalezen" }, 404);
  return c.json(match);
});

app.get("/api/record", (c) => c.json(recordResponse(db)));

app.get("/api/sources", (c) =>
  c.json({
    sources: [...sourcesResponse(db), ...BLOCKED_SOURCES],
    status: statusOf(db),
  }),
);

app.post("/api/ingest", async (c) => {
  await startIngest(db, true);
  return c.json(statusOf(db));
});

if (process.env.NODE_ENV === "production") {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  app.get("/favicon.svg", serveStatic({ path: "./dist/favicon.svg" }));
  app.notFound((c) => {
    if (c.req.path.startsWith("/api")) return c.json({ error: "Nenalezeno" }, 404);
    if (!existsSync("dist/index.html")) return c.text("Frontend není sestavený. Spusťte npm run build.", 503);
    return c.html(readFileSync("dist/index.html", "utf8"));
  });
}

const port = Number(process.env.BETMASTER_API_PORT ?? (process.env.NODE_ENV === "production" ? 5180 : 8787));
serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`[betmaster] API http://127.0.0.1:${info.port}`);
});
