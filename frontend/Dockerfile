# Builds the React interface and serves it with nginx, which also forwards /api, /auth and /invite to the backend.
#   docker build -t hrhub-frontend frontend
#   docker run -p 8080:80 -e BACKEND_URL=http://<backend-host>:3000 hrhub-frontend
FROM node:22-alpine AS build
WORKDIR /ui
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# Where the backend is reachable from this container. The nginx image fills it into the config on start.
ENV BACKEND_URL=http://backend:3000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /ui/dist /usr/share/nginx/html/app
COPY public/ /usr/share/nginx/html/
COPY leave-rules.cjs /usr/share/nginx/html/leave-rules.js
EXPOSE 80
