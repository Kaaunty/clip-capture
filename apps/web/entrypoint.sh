#!/bin/sh
set -e

echo "Starting Clip Capture Web..."

# Create database directories if needed
mkdir -p /app/prisma/data
mkdir -p /app/storage

# Apply Prisma schema
echo "Applying database schema..."
npx prisma db push --accept-data-loss

echo "Starting Next.js server on port 3000..."
exec npx next start -H 0.0.0.0 -p 3000
