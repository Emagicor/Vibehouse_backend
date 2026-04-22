# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install native build tools for bcrypt and other native modules
RUN apk add --no-cache python3 make g++ openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Generate Prisma client (uses linux-musl binary — correct for Alpine)
RUN npx prisma generate

# Compile TypeScript → JavaScript.
# tsconfig.docker.json fixes two Alpine-specific issues vs the project's tsconfig.build.json:
#   1. module: CommonJS  (nodenext silently emits 0 files on first clean build in Alpine)
#   2. rootDir: ./src    (without this, tsc puts src/main.ts → dist/src/main.js, not dist/main.js)
#   3. include: src/**   (prevents scripts/ and prisma/ TS files pulling the rootDir up to /app)
RUN node_modules/.bin/tsc -p tsconfig.docker.json

# Fail loudly here if the entry point wasn't emitted (catches compile failures early)
RUN test -f dist/main.js || (echo "ERROR: dist/main.js not found after tsc" && exit 1)

# Compile production seed to plain JavaScript so the seed step can run with
# `node` alone — no ts-node, no tsconfig-paths, no module-resolution surprises.
RUN node_modules/.bin/tsc \
  --module CommonJS \
  --moduleResolution node \
  --target ES2019 \
  --esModuleInterop true \
  --allowSyntheticDefaultImports true \
  --skipLibCheck \
  --rootDir prisma \
  --outDir dist/seed \
  prisma/seed.prod.ts

# Fail loudly if seed.prod.js didn't land where deploy.yml expects
RUN ls -la dist/seed/ && \
    test -f dist/seed/seed.prod.js || \
    (echo "ERROR: dist/seed/seed.prod.js not found after tsc" && find dist -name "seed.prod.js" && exit 1)


# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install OpenSSL 3 — required by the Prisma query engine binary (linux-musl-openssl-3.0.x)
RUN apk add --no-cache openssl

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

# Copy compiled output and dependencies from builder
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json
# Prisma schema needed at runtime (for Prisma client introspection)
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma

USER nestjs

EXPOSE 8080

# Note: run `npx prisma migrate deploy` as a separate pre-deploy step, not here.
# Running it here would cause all tasks to attempt migrations simultaneously.
CMD ["node", "dist/main"]
