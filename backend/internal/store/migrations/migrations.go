// Package migrations embeds the SQL migration files. DB スキーマの source of
// truth はここに置く SQL ファイル (db-schema.md は廃止済み)。
//
// ファイル名は bun/migrate の規約 `<version>_<label>.up.sql` / `.down.sql` に従う。
package migrations

import (
	"embed"

	"github.com/uptrace/bun/migrate"
)

// Migrations is consumed by store.Migrate.
var Migrations = migrate.NewMigrations()

//go:embed *.sql
var sqlFiles embed.FS

func init() {
	if err := Migrations.Discover(sqlFiles); err != nil {
		panic(err)
	}
}
