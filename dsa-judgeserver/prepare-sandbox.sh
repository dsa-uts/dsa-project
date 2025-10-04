#!/bin/bash

set -e

SCRIPT_DIR=$(cd $(dirname $0); pwd)

# サンドボックスコンテナのCPUを隔離
# Linux以外にも対応するために、この処理は行わない
# この設定はサンドボックスのパフォーマンスを高くするために行うものであるため、特に必要不可欠でもない
# mkdir -p /sys/fs/cgroup/judge.slice/
# systemctl set-property judge.slice AllowedCPUs=0-1
# echo 'isolated' > /sys/fs/cgroup/judge.slice/cpuset.cpus.partition

# crunのインストール
if ! which crun > /dev/null 2>&1; then
    echo "crunがインストールされていません。インストールを開始します。"
    $SCRIPT_DIR/install-crun.sh
else
    echo "crunは既にインストールされています。"
fi

$SCRIPT_DIR/langs/build.sh
