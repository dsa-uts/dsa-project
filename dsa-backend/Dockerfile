FROM golang:1.25.1-bookworm

WORKDIR /app

ENV DOCKERIZE_VERSION v0.9.4

RUN apt-get update \
  && apt-get install -y wget \
  && wget -O - https://github.com/jwilder/dockerize/releases/download/$DOCKERIZE_VERSION/dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz | tar xzf - -C /usr/local/bin \
  && apt-get autoremove -yqq --purge wget && rm -rf /var/lib/apt/lists/*

# アプリケーションを起動
# CMD ["dockerize", "-wait", "tcp://db:5432", "-timeout", "30s", "air", "-c", ".air.toml"]
