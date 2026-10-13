// Running the app already migrates on boot (db/index.js -> adapter runs
// migrations eagerly), so this script just forces that to happen standalone
// -- useful for CI or a first-time setup step.
import { db } from "../src/db/index.js";

console.log("Migrations applied. Tables ready in", process.env.SQLITE_FILE || "trex.sqlite");
db.transaction(() => {}); // touch the connection so any lazy init runs
