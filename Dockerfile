# MiReCo HTTP version: static files served by nginx on port 80.
# For browsers without Local Network Access (iOS, Safari, Firefox); see README.
#
#   docker compose up -d --build          (uses compose.yaml, port 8080)
#   docker build -t mireco . && docker run -d -p 8080:80 --restart unless-stopped mireco

FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN node scripts/build.mjs --out /site

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=60s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
