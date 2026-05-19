# ── Stage 1: Build React app ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend
RUN apk add --no-cache git python3 make g++
WORKDIR /app
COPY package.json yarn.lock ./
RUN printf '[url "https://github.com/"]\n\tinsteadOf = ssh://git@github.com/\n\tinsteadOf = git@github.com:\n' > /root/.gitconfig && \
    yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000
COPY . .
RUN yarn build

# ── Stage 2: Build Go server ───────────────────────────────────────────────────
FROM golang:alpine AS backend
WORKDIR /build
COPY httpserver/go.mod httpserver/go.sum ./
RUN go mod download
COPY httpserver/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o httpserver .

# ── Stage 3: Final image ───────────────────────────────────────────────────────
FROM caddy:latest

COPY --from=frontend /app/build/ /usr/share/caddy
COPY --from=backend /build/httpserver /app/httpserver
COPY Caddyfile /etc/caddy/Caddyfile

RUN mkdir -p /app/uploads && chmod 755 /app/uploads

EXPOSE 80 7200

RUN printf '#!/bin/sh\ncd /app\n/app/httpserver &\ncaddy run --config /etc/caddy/Caddyfile --adapter caddyfile\n' \
    > /start.sh && chmod +x /start.sh

ENV ENABLE_HTTP_SERVER=true
ENV ENABLE_OPDS=true
ENV ENABLE_KOREADER_SERVER=false
ENV KOREADER_PORT=7200
ENV KOREADER_ENABLE_REGISTRATION=true
ENV SERVER_USERNAME=admin
ENV SERVER_PASSWORD=securePass123

VOLUME ["/app/uploads"]
CMD ["/start.sh"]
