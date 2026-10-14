# Multi-stage build: stage 1 compiles the client + server with node:20,
# stage 2 runs the bundled server. (Same pattern as the other museprojects
# apps; no VOLUME instructions — Railway rejects them.)
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# dist/ contains server.js and client/ (see scripts/build-server.mjs and
# client/build.mjs).
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
