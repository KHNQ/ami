import { Database } from "bun:sqlite";
import { config } from "../../../config.js";

let _dbHandle = null;

// bun:sqlite is a single-writer, single-process store -- there's no
// horizontal scaling of the API process itself without a further change
// (e.g. Litestream/LiteFS read replicas) later. For v1 the plan is to scale
// vertically (bigger single instance, one process) and tune these pragmas
// for that shape rather than migrate off SQLite.
function applyProductionPragmas(handle) {
  handle.exec("PRAGMA journal_mode = WAL;");
  handle.exec("PRAGMA foreign_keys = ON;");
  // NORMAL is safe (not just fast) under WAL: a crash can lose the last
  // few commits but never corrupts the database, and WAL's checkpoint
  // already fsyncs the main db file. FULL's extra fsync-per-commit isn't
  // needed here.
  handle.exec("PRAGMA synchronous = NORMAL;");
  // Under real concurrent load, a second writer hitting a locked db should
  // retry for a bit instead of failing the request immediately.
  handle.exec("PRAGMA busy_timeout = 5000;");
  // ~64MB page cache and mmap window -- cheap to raise on any real server,
  // keeps hot tables/indexes (nodes, transactions, commission_ledger_entries)
  // resident instead of round-tripping to disk on every query.
  handle.exec("PRAGMA cache_size = -64000;");
  handle.exec("PRAGMA mmap_size = 268435456;");
}

export function getRawConnection() {
  if (_dbHandle) return _dbHandle;
  _dbHandle = new Database(config.sqliteFile, { create: true });
  applyProductionPragmas(_dbHandle);
  return _dbHandle;
}

export function resetConnectionForTests(file) {
  if (_dbHandle) _dbHandle.close();
  _dbHandle = new Database(file || ":memory:", { create: true });
  _dbHandle.exec("PRAGMA foreign_keys = ON;");
  return _dbHandle;
}
