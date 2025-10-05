FROM golang:1.25.1-bookworm AS builder

WORKDIR /workdir/app

COPY dsa-judgeserver/go.mod dsa-judgeserver/go.sum ./

COPY database /workdir/database

RUN go mod download

COPY dsa-judgeserver ./
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

FROM golang:1.25.1-bookworm AS runner

WORKDIR /app

ENV DOCKERIZE_VERSION v0.9.4

RUN apt-get update \
    && apt-get install -y wget \
    && wget -O - https://github.com/jwilder/dockerize/releases/download/$DOCKERIZE_VERSION/dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz | tar xzf - -C /usr/local/bin \
    && apt-get autoremove -yqq --purge wget && rm -rf /var/lib/apt/lists/*

COPY --from=builder /workdir/app/main .

EXPOSE 8000

CMD ["dockerize", "-wait", "tcp://db:5432", "-timeout", "30s", "./main"]
