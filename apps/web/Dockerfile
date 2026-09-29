FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma/
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY next.config.js tsconfig.json ./
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
