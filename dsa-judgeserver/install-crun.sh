#!/bin/bash

set -e

SCRIPT_DIR=$(cd $(dirname $0); pwd)

# crunのインストール
wget https://github.com/containers/crun/releases/download/1.20/crun-1.20-linux-amd64 -O /usr/local/bin/crun
chmod +x /usr/local/bin/crun

# dockerの設定(デフォルトランタイムをcrunにする)
mkdir -p /etc/docker
cp $SCRIPT_DIR/docker-daemon.json /etc/docker/daemon.json

# dockerの再起動
systemctl restart docker

# crunのバージョンを確認
crun --version
