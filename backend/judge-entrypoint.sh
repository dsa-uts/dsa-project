#!/bin/sh
set -eu

# launch dockerd in background.
dockerd-entrypoint.sh \
    dockerd \
    --host=unix:///var/run/docker.sock \
    --exec-opt=native.cgroupdriver=cgroupfs \
    &
# note dockerd's PID.
dockerd_pid=$!

# launch judge in background.
judge &
# note judge's PID.
judge_pid=$!

# When this script exits, kill both dockerd and judge.
trap 'kill "$judge_pid" "$dockerd_pid" 2>/dev/null || true; wait || true' EXIT
# When this script received SIGTERM, it'll exits with code 143 (128 + 15).
trap 'exit 143' TERM
# When this script received SIGINT, it'll exits with code 130 (128 + 2).
trap 'exit 130' INT

# Restart the container if either process exits, even with a successful status.
# ponytail: detect child exits within 1s; use bash wait -n if immediate detection matters.
while kill -0 "$dockerd_pid" 2>/dev/null && kill -0 "$judge_pid" 2>/dev/null; do
    sleep 1
done
exit 1
