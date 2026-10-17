FROM node:24-alpine AS base
RUN npm install -g pnpm@12.10.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

FROM build AS migrate
# Migrate, then create the dev account if SEED_DEV_ACCOUNT=true (see src/seed.ts).
CMD ["sh", "-c", "pnpm run auth:migrate:docker && node dist/seed.js"]

FROM base AS prod
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
# node directly, not `pnpm start`, so it receives SIGTERM and shuts down cleanly.
CMD ["node", "dist/server.js"]
