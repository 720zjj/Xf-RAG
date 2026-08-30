FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts ./scripts

# Docker initializes new named volumes from this directory, retaining the node
# ownership so uploads and local model caches stay writable without root.
RUN mkdir -p /data/uploads /data/models \
  && chown -R node:node /app /data

USER node
EXPOSE 3000

CMD ["node", "--max-old-space-size=8192", "server/index.js"]
