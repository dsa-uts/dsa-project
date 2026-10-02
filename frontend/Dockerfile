# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM ghcr.io/static-web-server/static-web-server:2.43.0 AS frontend
COPY --from=build /src/dist /public
USER 65532:65532
EXPOSE 8080
CMD ["--root", "/public", "--port", "8080", "--page-fallback", "/public/index.html"]
