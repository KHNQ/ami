# Trex backend (Bun + Hono). Build/run from the repo root:
#   docker build -t trex-backend .
#   docker run -p 3000:3000 --env-file .env -v trex-data:/app/data trex-backend
#
# SQLite is a single-writer, single-process store (see
# src/db/adapters/sqlite/connection.js) -- run exactly one container, and
# mount a persistent volume at SQLITE_FILE's directory so the database
# survives a redeploy. Point SQLITE_FILE at /app/data/trex.sqlite (matches
# the volume mounted above) via your .env / orchestrator config.
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

# Apply any pending schema/migration changes before serving traffic, rather
# than paying that cost on the first real request.
CMD ["sh", "-c", "bun run migrate && bun run start"]
