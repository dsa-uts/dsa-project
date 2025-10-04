#!/bin/sh

go install github.com/air-verse/air@latest

air -c .air.toml
