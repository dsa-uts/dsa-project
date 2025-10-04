#!/usr/bin/env bash

set -e

SCRIPT_DIR=$(cd $(dirname $0); pwd)

# watchdogのビルドステージをビルド
docker build -t watchdog-builder -f $SCRIPT_DIR/Dockerfile.builder $SCRIPT_DIR

# GCCを使えるsandboxイメージをビルド
docker build -t checker-lang-gcc -f $SCRIPT_DIR/Dockerfile.GCC $SCRIPT_DIR

# 実行用のsandboxイメージをビルド
docker build -t binary-runner -f $SCRIPT_DIR/Dockerfile.binary-runner $SCRIPT_DIR

# ビルドステージを削除
docker rmi watchdog-builder
