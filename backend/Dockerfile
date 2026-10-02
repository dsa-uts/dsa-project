# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.27.0-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -mod=readonly -trimpath -ldflags="-s -w" -o /out/ ./cmd/server ./cmd/judge

FROM docker:29.8.2-dind AS judge
COPY --from=build /out/judge /usr/local/bin/judge
COPY --chmod=755 judge-entrypoint.sh /usr/local/bin/judge-entrypoint.sh
ENV DOCKER_HOST=unix:///var/run/docker.sock
ENTRYPOINT ["docker-init", "--", "judge-entrypoint.sh"]

FROM scratch AS backend
COPY --from=build /out/server /server
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/server"]
