#!/bin/sh
set -e

echo "[entrypoint] Applying database schema (db push, no --accept-data-loss — fails closed on destructive changes)..."
node /opt/prisma-cli/node_modules/prisma/build/index.js db push --skip-generate --schema /app/prisma/schema.prisma

echo "[entrypoint] Starting server..."
exec node server.js
