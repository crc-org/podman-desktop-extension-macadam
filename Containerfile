FROM node:20-slim AS installer
COPY package.json ./
RUN npm i -g ssh2@1.16.0

FROM scratch as builder
COPY dist/ /extension/dist
COPY package.json /extension/
COPY LICENSE /extension/
COPY icon.png /extension/
COPY README.md /extension/
COPY --from=installer /usr/local/lib/node_modules/ssh2/ /extension/node_modules/ssh2

FROM scratch

LABEL org.opencontainers.image.title="Macadam extension" \
      org.opencontainers.image.description="Example of Macadam extension" \
      org.opencontainers.image.vendor="podman-desktop" \
      io.podman-desktop.api.version=">= 1.10.0"

COPY --from=builder /extension /extension