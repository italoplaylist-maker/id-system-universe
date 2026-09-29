#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma

echo "[entrypoint] Starting server..."
exec node server.js
