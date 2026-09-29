# syntax=docker/dockerfile:1
#
# Debian slim (not Alpine) throughout: Prisma picks its query engine binary
# by OpenSSL version, and musl (Alpine) is a recurring source of "engine not
# found" that only ever shows up in production. See the project's Second
# Brain: "Empacotar Next.js standalone com Prisma em contêiner".

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Facade values only — next build never connects to a real database, and
# runtime env is validated for real by src/lib/env.ts on first request.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-time-placeholder-secret-not-used-in-prod-00000000" \
    CREDENTIAL_ENCRYPTION_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
    NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build

# The Next.js standalone bundle includes the Prisma *query* engine but not
# the CLI (schema engine + migration tooling) needed to apply the schema on
# boot. Installing it from the build stage's node_modules doesn't work — its
# own dependency tree isn't part of the standalone trace — so it gets its own
# isolated install here, kept out of /app/node_modules entirely.
FROM node:22-slim AS prisma-cli
WORKDIR /opt/prisma-cli
RUN npm init -y >/dev/null \
    && npm install --no-audit --no-fund --omit=dev prisma@6.19.3

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=prisma-cli --chown=nextjs:nodejs /opt/prisma-cli /opt/prisma-cli
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
