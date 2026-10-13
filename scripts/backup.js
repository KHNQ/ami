// Point-in-time SQLite backup via `VACUUM INTO`, safe to run against a live
// WAL-mode database (unlike a raw file copy, which can grab a torn snapshot
// mid-write). Intended to be run on a schedule (cron/systemd timer) in
// production, since there's otherwise no backup story for the single
// trex.sqlite file this app writes to.
//
// Usage: bun run scripts/backup.js [output-dir]
// (defaults to ./backups; ship that directory off-box -- e.g. sync it to
// object storage -- this script only produces the local snapshot file.)
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../src/config.js";

const outDir = process.argv[2] || "backups";
mkdirSync(outDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = join(outDir, `trex-${timestamp}.sqlite`);

const db = new Database(config.sqliteFile);
db.exec(`VACUUM INTO '${outFile.replace(/'/g, "''")}'`);
db.close();

console.log(`Backup written to ${outFile}`);
