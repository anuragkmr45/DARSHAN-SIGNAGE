FROM node:20-bookworm AS build

WORKDIR /app

COPY darshan-cms/package*.json ./
RUN npm ci

COPY darshan-cms/ ./
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/production/docker/cms/nginx/default.conf.template /etc/nginx/templates/default.conf.template
