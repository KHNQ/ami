# The admin control room, built and served separately from the storefront.
#
# Build context must be the REPO ROOT, not admin/ -- this app compiles shared
# source from ../frontend/src via the @shared alias, so both directories have
# to be present:
#
#   docker build -f admin/Dockerfile -t trex-admin .
#
# Deploy this behind whatever access control the storefront does not have:
# a VPN, an IP allowlist, or an auth proxy. Nothing here should be reachable
# from the public internet. The API enforces every permission regardless, but
# an internal money-handling console has no reason to be exposed at all.
FROM oven/bun:1 AS build
WORKDIR /app

# Shared source first -- it changes less often than the admin pages, so this
# layer stays cached across most rebuilds.
COPY frontend/package.json frontend/bun.lockb* ./frontend/
COPY admin/package.json admin/bun.lockb* ./admin/
RUN cd admin && bun install --frozen-lockfile

COPY frontend/src ./frontend/src
COPY admin ./admin

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV NODE_ENV=production
RUN cd admin && bun run build

FROM oven/bun:1-slim
WORKDIR /app
RUN bun add hono @hono/node-server 2>/dev/null || true
COPY --from=build /app/admin/dist ./dist
COPY admin/server.js ./server.js

EXPOSE 4174
CMD ["bun", "server.js"]
