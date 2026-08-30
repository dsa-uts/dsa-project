// Package api implements the generated strict-server interface (ADR 0010).
//
// gen.go は api/openapi.yaml から生成されコミットされる。手で編集しないこと。
// spec を変更したら `go generate ./...` で再生成する。CI がドリフトを検出する。
package api

//go:generate go tool oapi-codegen -config oapi-codegen.yaml ../../../api/openapi.yaml
