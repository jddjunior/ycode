# BounceOS — production image (Railway / any container host)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:fast && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./
USER node
EXPOSE 8080
# SEED_DEMO=true loads idempotent demo data on boot (staging only).
CMD ["sh", "-c", "if [ \"$SEED_DEMO\" = true ]; then node ./dist/seed.mjs || echo seed-skipped; fi; exec node ./dist/server/entry.mjs"]
