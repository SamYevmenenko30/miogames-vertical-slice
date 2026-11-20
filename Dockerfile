# Two targets: `dev` runs from source with reload (what docker-compose uses);
# `runtime` is the compiled image a deploy would ship.
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
ENV NODE_ENV=development
CMD ["pnpm", "dev"]

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
# The API by default; the worker image is the same one with a different command.
CMD ["node", "dist/main.api.js"]
