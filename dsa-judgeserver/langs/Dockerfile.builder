# ビルドステージ
FROM ubuntu:24.10

RUN apt update && apt install -y gcc g++ nlohmann-json3-dev

# watchdog.cppをコピー & コンパイル
COPY watchdog.cpp /home/guest/watchdog.cpp
RUN g++ -o /home/guest/watchdog /home/guest/watchdog.cpp
