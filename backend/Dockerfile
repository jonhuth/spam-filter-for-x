# Pin the bun already running in x-account-backend. :1 would float past it.
FROM oven/bun:1.4.3-alpine AS base
WORKDIR /app

# Alpine 3.24 ca-certificates 20261020-r0 drops emSign ECC Root CA - G3.
# Bun 1.4.3 still trusts its bundled copy, and --use-system-ca only adds the
# OS store beside that copy. system-ca.js fails the build if the OS store is
# still unsafe, then the process preload pins fetch and node:https to it.
RUN apk add --no-cache ca-certificates
COPY system-ca.js ./
RUN bun run system-ca.js

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy application code
COPY tsconfig.json ./
COPY src ./src

EXPOSE 3000

# Commit this image was built from; /api/health reports it (scripts/deploy-backend.sh sets it).
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

ENV PORT=3000
ENV NODE_USE_SYSTEM_CA=1
CMD ["bun", "--use-system-ca", "run", "--preload", "./system-ca.js", "src/index.ts"]
