# API server only; the interface runs in the frontend image.
# Build from the repo root, because the server also needs frontend/leave-rules.cjs:
#   docker build -f backend/Dockerfile -t hrhub-backend .
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/srv/uploads

WORKDIR /srv/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/src ./src
COPY backend/seed ./seed
# Imported as ../../frontend/leave-rules.cjs from src/.
COPY frontend/leave-rules.cjs /srv/frontend/leave-rules.cjs

# Uploaded documents and receipts; mount a volume here so they survive restarts.
RUN mkdir -p /srv/uploads && chown node:node /srv/uploads
USER node

EXPOSE 3000
CMD ["node", "src/index.js"]
