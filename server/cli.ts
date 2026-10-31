import { openDatabase } from "./db";
import { startIngest } from "./ingest";
import { loadSampleIfEmpty, writeSample } from "./sample";

const db = openDatabase();
loadSampleIfEmpty(db);
await startIngest(db, true);
if (process.argv.includes("--write-sample")) {
  writeSample(db);
  console.log("[betmaster] kontrolní vzorek uložen");
}
