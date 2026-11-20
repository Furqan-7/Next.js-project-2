# Build from the repository root: docker build -f backend/Dockerfile .
FROM node:22-slim
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/
COPY db/package.json db/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter backend...

COPY shared shared
COPY db db
COPY backend backend
RUN pnpm --filter backend build

ENV NODE_ENV=production PORT=3001 UPLOAD_DIR=/app/backend/uploads
EXPOSE 3001
# The API applies pending migrations on start. Run the worker as a second container with:
#   command: ["node", "backend/dist/worker.js"]
CMD ["node", "backend/dist/index.js"]
