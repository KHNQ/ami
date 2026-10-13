import { config } from "../config.js";
import { createSqliteAdapter } from "./adapters/sqlite/index.js";

// Single point of engine selection. Everything else in the app imports
// `db` from here and never touches an adapter directly, which is what
// makes the storage engine swappable (idea.md: "have db layer that we can
// change easily the engine but the interface never changed").
function buildDb() {
  switch (config.dbEngine) {
    case "sqlite":
      return createSqliteAdapter();
    // case "mongo": return createMongoAdapter();
    // case "leveldb": return createLevelDbAdapter();
    default:
      throw new Error(`Unsupported DB_ENGINE: ${config.dbEngine}`);
  }
}

export const db = buildDb();
