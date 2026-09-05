package auth_test

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/dsa-uts/dsa-project/backend/internal/auth"
)

func TestPasswordHash(t *testing.T) {
	password := strings.Repeat("🔑", 256)
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=1$") {
		t.Fatalf("unexpected PHC parameters: %s", hash)
	}
	parts := strings.Split(hash, "$")
	salt, saltErr := base64.RawStdEncoding.DecodeString(parts[4])
	key, keyErr := base64.RawStdEncoding.DecodeString(parts[5])
	if saltErr != nil || keyErr != nil || len(salt) != 16 || len(key) != 32 {
		t.Fatal("unexpected salt or key size")
	}
	if !auth.VerifyPassword(hash, password) {
		t.Fatal("Unicode password did not verify")
	}
	if auth.VerifyPassword(hash, password+" ") {
		t.Fatal("password was normalized or truncated")
	}
	second, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if hash == second {
		t.Fatal("salt was reused")
	}
}

func TestPasswordRejectsMalformedPHC(t *testing.T) {
	for _, hash := range []string{
		"", "$2a$12$obsolete", "$argon2i$v=19$m=65536,t=3,p=1$c2FsdHNhbHQ$a2V5a2V5a2V5a2V5a2V5aw",
		"$argon2id$v=19$m=4294967295,t=3,p=1$c2FsdHNhbHQ$a2V5a2V5a2V5a2V5a2V5aw",
		"$argon2id$v=19$m=65536,t=0,p=1$c2FsdHNhbHQ$a2V5a2V5a2V5a2V5a2V5aw",
		"$argon2id$v=19$m=65536,t=3,p=256$c2FsdHNhbHQ$a2V5a2V5a2V5a2V5a2V5aw",
		"$argon2id$v=19$m=65536,t=3,p=1$!$!",
	} {
		if auth.VerifyPassword(hash, "password") {
			t.Errorf("accepted malformed PHC: %q", hash)
		}
	}
}

func TestPasswordVerifiesStoredParameters(t *testing.T) {
	// Published x/crypto/argon2 test vector (password="password", salt="somesalt").
	// Parameters deliberately differ from the defaults used for new hashes.
	const hash = "$argon2id$v=19$m=64,t=1,p=1$c29tZXNhbHQ$ZVrRXqxlLcWfcXCnMyv0m4Rpvh/bnCi7"
	if !auth.VerifyPassword(hash, "password") {
		t.Fatal("stored parameters did not verify")
	}
	if auth.VerifyPassword(hash, "wrong") {
		t.Fatal("wrong password verified")
	}
}
