# Built from the repository root: docker build -f api/Dockerfile .
FROM node:24-slim AS build
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ ./
RUN npm run build && npm run build:scripts && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-scripts ./dist-scripts
COPY --from=build /app/src/db/migrations ./migrations
USER node
EXPOSE 50060
# A failed migration stops the container instead of serving a half-migrated database.
CMD ["sh", "-c", "node dist-scripts/migrate.js && node dist/index.js"]
