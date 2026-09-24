# syntax=docker/dockerfile:1
# Moldmaker — static SPA served by nginx.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Serve at / (do not set GITHUB_PAGES — that prefix is only for GitHub Pages).
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
