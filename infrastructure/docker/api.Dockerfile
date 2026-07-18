FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --filter @pulsegrid/api... --no-frozen-lockfile
RUN pnpm --filter @pulsegrid/api build

FROM node:22-alpine
RUN adduser -D -u 10001 pulsegrid
WORKDIR /repo
COPY --from=build /repo ./
USER pulsegrid
EXPOSE 4000
WORKDIR /repo/apps/api
CMD ["node", "--import", "tsx", "dist/main.js"]
