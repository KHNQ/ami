import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runExtraMigrations } from "./migrations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runMigrations(rawDb) {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf8");
  rawDb.exec(sql);
  // Non-idempotent alterations (ADD COLUMN, CHECK constraint changes) that
  // schema.sql's CREATE-TABLE-IF-NOT-EXISTS approach can't express safely.
  runExtraMigrations(rawDb);
}
