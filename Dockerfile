# Build stage: needs devDependencies (prisma CLI, typescript). Also used to run migrations:
#   docker build --target build -t focentra-migrate . && docker run --env-file .env focentra-migrate npx prisma migrate deploy
FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# prisma.config.ts requires DATABASE_URL even though generate never connects.
RUN DATABASE_URL=mysql://build:build@localhost:3306/build npx prisma generate \
 && npm run build

# Pruned in its own stage so the build stage keeps the prisma CLI for migrations.
FROM build AS prod-deps
RUN npm prune --omit=dev

# Runtime stage: compiled code + production deps only.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
