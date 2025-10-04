FROM ubuntu:24.10

# install curl
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update && apt-get install -y --no-install-recommends \
  curl \
  ca-certificates \
  build-essential

# install cargo
RUN curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup default stable

# Copy cargo.toml and cargo.lock first to cache dependencies
WORKDIR /home/guest/watchdog
RUN mkdir src && echo "fn main() {}" > src/main.rs
COPY ./watchdog/Cargo.toml ./watchdog/Cargo.lock* ./

# Cache dependencies
RUN --mount=type=cache,target=/home/guest/.cargo,sharing=locked \
  --mount=type=cache,target=/home/guest/watchdog/target,sharing=locked \
  cargo build --release

# Copy source code (except target dir)
COPY ./watchdog /home/guest/watchdog

# Final build (force rebuild by updating time stamp)
RUN --mount=type=cache,target=/home/guest/.cargo,sharing=locked \
  --mount=type=cache,target=/home/guest/watchdog/target,sharing=locked \
  touch src/main.rs && \
  cargo build --release && \
  cp target/release/watchdog /tmp/watchdog
