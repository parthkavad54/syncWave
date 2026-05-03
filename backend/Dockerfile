# ─────────────────────────────────────────────────────────────
# Dockerfile for SyncWave backend (Fly.io deployment)
# ─────────────────────────────────────────────────────────────

# Use official Node.js LTS slim image
FROM node:20-slim

# Set working directory inside the container
WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package.json package-lock.json* ./

# Install all dependencies (including tsx for running TypeScript)
RUN npm ci

# Copy the rest of the backend source
COPY . .

# Create uploads directory (for audio file uploads)
RUN mkdir -p uploads

# Expose the port Fly.io will route traffic to
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start the server using tsx (runs TypeScript directly, no compile step needed)
CMD ["npx", "tsx", "server.ts"]
