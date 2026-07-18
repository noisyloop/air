# air web — static build served by nginx
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @air/web --include-workspace-root
COPY apps/web apps/web
# API URL is baked at build time; override with --build-arg for other environments.
ARG VITE_API_URL=http://localhost:4000
ARG VITE_WS_URL=ws://localhost:4000/ws
ENV VITE_API_URL=$VITE_API_URL VITE_WS_URL=$VITE_WS_URL
RUN cd apps/web && npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
