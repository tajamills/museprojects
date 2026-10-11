# Multi-stage build: stage 1 compiles the client + server with node:20,
# stage 2 runs the bundled server.
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
# dist/ contains server.js, client/, and migrations/ (see scripts/build-server.mjs)
COPY --from=build /app/dist ./dist
# Uploaded media lives here (local disk). Add a Railway volume at /app/media
# in the service settings if uploads must survive redeploys.
EXPOSE 3000
CMD ["node", "dist/server.js"]
