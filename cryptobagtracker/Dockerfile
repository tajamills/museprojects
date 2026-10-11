# CryptoBagTracker — multi-stage Railway/Docker build.
#
# Stage 1 (build): install all deps, compile the Express server with tsc and
# bundle the React client with esbuild + the Tailwind CLI.
# Stage 2 (runtime): install production deps only, copy the compiled server,
# the static client bundle and the SQL migrations, then run node.
#
# Postgres migrations run automatically on boot (see server/src/migrate.ts).

FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
COPY drizzle ./drizzle

# Railway injects PORT; the server defaults to 3000 when it is absent.
EXPOSE 3000
CMD ["node", "dist/server.js"]
