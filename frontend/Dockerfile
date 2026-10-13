# Trex frontend -- built SPA served by a small Bun server (server.js) that
# also server-renders `/` and `/products/:id` for SEO (see server.js /
# entry-server.jsx). Replaces the old nginx-only static setup. Build/run
# from frontend/:
#   docker build -t trex-frontend --build-arg VITE_API_BASE_URL=https://api.yourdomain.com .
#   docker run -p 8080:4173 -e VITE_API_BASE_URL=https://api.yourdomain.com trex-frontend
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN bun run build && bun run build:ssr

FROM oven/bun:1-slim AS runtime
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

COPY --from=build /app/dist ./dist
COPY server.js ./
COPY public ./public

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV PORT=4173
EXPOSE 4173
CMD ["bun", "server.js"]
