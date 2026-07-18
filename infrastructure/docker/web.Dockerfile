FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --filter @pulsegrid/web... --no-frozen-lockfile
RUN pnpm --filter @pulsegrid/web build

FROM node:22-alpine
RUN adduser -D -u 10001 pulsegrid
WORKDIR /repo
COPY --from=build /repo ./
USER pulsegrid
EXPOSE 3000
WORKDIR /repo/apps/web
CMD ["node", "node_modules/next/dist/bin/next", "start"]
