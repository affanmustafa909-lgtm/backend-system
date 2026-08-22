# Use the monorepo Dockerfile at backend/Dockerfile (build from repository root):
#
#   docker build -f backend/Dockerfile -t platform-api .
#
# Railway: Root Directory = repo root, Dockerfile path = backend/Dockerfile
# See backend/RAILWAY.md

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY pnpm-lock.yaml* ./
COPY packages ./packages
COPY backend ./backend
RUN pnpm install --frozen-lockfile=false
RUN pnpm turbo run build --filter=@platform/api

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/backend/api ./backend/api
RUN find /app/node_modules/.bin -type f -o -type l | xargs chmod +x 2>/dev/null || true
RUN mkdir -p /app/backend/api/data/uploads
EXPOSE 3000
ENV HOST=0.0.0.0
CMD ["node", "/app/backend/api/scripts/start-railway.mjs"]
