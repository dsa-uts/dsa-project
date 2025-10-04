# ベースイメージとしてPython 3.12を使用
FROM python:3.12.9-slim-bookworm

# uvのインストール
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# 作業ディレクトリを設定
WORKDIR /app

# dockerizeのバージョンを環境変数として設定
ENV DOCKERIZE_VERSION v0.9.2

# dockerizeをダウンロードしてインストール
RUN apt-get update \
    && apt-get install -y wget \
    && wget -O - https://github.com/jwilder/dockerize/releases/download/$DOCKERIZE_VERSION/dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz | tar xzf - -C /usr/local/bin \
    && apt-get autoremove -yqq --purge wget && rm -rf /var/lib/apt/lists/*

# 参考: https://github.com/astral-sh/uv-docker-example/blob/main/Dockerfile
#      https://docs.astral.sh/uv/guides/integration/docker
# Enable bytecode compilation
ENV UV_COMPILE_BYTECODE=1

# Copy from the cache instead of linking since it's a mounted volume
ENV UV_LINK_MODE=copy

# Install the project's dependencies using the logfile and settings
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev

# Then, add the rest of the project source code and install it
# (Installing seperately from its dependencies allows optimal layer caching)
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Place executables in the environment at the front of the path
ENV PATH="/app/.venv/bin:$PATH"

# アプリケーションを起動
CMD ["dockerize", "-wait", "tcp://db:3306", "-timeout", "30s", "uvicorn", "app:app", "--host", "0.0.0.0", "--reload"]
