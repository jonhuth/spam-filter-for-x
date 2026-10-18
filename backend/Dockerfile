FROM oven/bun:1-alpine AS base
WORKDIR /app

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
CMD ["bun", "run", "src/index.ts"]
