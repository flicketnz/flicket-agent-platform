ARG NODE_VERSION="24"
ARG ALPINE_VERSION="3.21"


# Multi-stage build for efficient container size
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS builder

# CONFIGURE npm to use cache first
RUN npm config set cache /npm-cache && \
    npm config set prefer-offline true

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S flicketai -u 1001

# run as user
USER flicketai    

WORKDIR /app

# Copy package files
# COPY package*.json ./

# Install dependencies - using docker cache
RUN \
    --mount=type=cache,target=/npm-cache \
    --mount=type=bind,source=package.json,target=/app/package.json \
    --mount=type=bind,source=package-lock.json,target=/app/package-lock.json \
    npm ci

# Copy source code
COPY --chown=flicketai:nodejs src/ ./src/
COPY --chown=flicketai:nodejs .slack/ .slack/

# Build the application
RUN \
    --mount=type=bind,source=package.json,target=/app/package.json \
    --mount=type=bind,source=tsconfig.json,target=/app/tsconfig.json \
    --mount=type=bind,source=tsconfig.build.json,target=/app/tsconfig.build.json \
    --mount=type=bind,source=nest-cli.json,target=/app/nest-cli.json \
    NODE_OPTIONS="--max-old-space-size=4096" npm run build

RUN --mount=type=bind,source=package.json,target=/app/package.json \
    npm prune --omit=dev

# Production stage
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS production

# Install dumb-init for pid 1 management
RUN apk add dumb-init

ENV PORT=3000

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S flicketai -u 1001

USER flicketai

WORKDIR /app

# Copy files
COPY --from=builder \
    --chown=flicketai:nodejs \
    /app/node_modules/ ./node_modules/

# Copy built application from builder stage
COPY --from=builder \
    --chown=flicketai:nodejs \
    /app/dist/ ./dist/

# Healthcheck to the internal endpoint
HEALTHCHECK --interval=5m --timeout=3s \
  CMD wget localhost:${PORT}/health -q -O - > /dev/null 2>&1

# Expose port 
EXPOSE ${PORT}

# Start the application
CMD ["dumb-init", "node", "dist/bootstrap/main.js"]