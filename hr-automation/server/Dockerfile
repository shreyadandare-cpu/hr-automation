# Container image for the HR automation web service.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# Runs the database migration first, then starts the web service.
# DATABASE_URL and PORT come from the hosting provider. No secrets are written into the image.
USER node
EXPOSE 8787
CMD ["sh", "-c", "node src/migrate.js && node src/http.js"]
