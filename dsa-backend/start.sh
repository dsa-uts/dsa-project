#!/bin/sh

set -e

go install github.com/air-verse/air@v1.63.0

exec air -c .air.toml
