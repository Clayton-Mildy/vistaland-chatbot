# Built from the repository root: docker build -f dashboard/Dockerfile .
FROM node:24-slim AS build
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json dashboard/.npmrc ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=40060 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 40060
CMD ["node", "server.js"]
