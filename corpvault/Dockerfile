# ---- Stage 1: build client + server ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: run ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Uploaded documents land in DATA_DIR (default /app/data); mount a Railway
# volume there for persistence.
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
