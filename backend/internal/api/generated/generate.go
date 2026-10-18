// Package generated contains the OpenAPI contract and server bindings.
//
// gen.go は api/openapi.yaml と参照先から生成されコミットされる。手で編集しないこと。
// spec を変更したら `task codegen:generate` で両側を再生成する。CI がドリフトを検出する。
package generated

//go:generate npm --prefix ../../../../frontend run bundle
//go:generate go tool oapi-codegen -config oapi-codegen.yaml ../../../../tmp/openapi.bundle.yaml
