import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = buildApp();

console.log(`Trex backend listening on :${config.port} (db engine: ${config.dbEngine})`);

export default {
  port: config.port,
  fetch: app.fetch,
};
