package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Parameters for new hashes. Verification uses the parameters stored in the PHC string.
const (
	passwordMemory      = 64 * 1024
	passwordIterations  = 3
	passwordParallelism = 1
	passwordSaltLength  = 16
	passwordKeyLength   = 32
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, passwordSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, passwordIterations, passwordMemory, passwordParallelism, passwordKeyLength)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, passwordMemory, passwordIterations, passwordParallelism, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword fails closed for malformed or unsupported PHC strings. Resource
// bounds prevent corrupt stored parameters from allocating unbounded memory.
func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	params := strings.Split(parts[3], ",")
	if len(params) != 3 {
		return false
	}
	values := make([]uint32, 3)
	for i, prefix := range []string{"m=", "t=", "p="} {
		value, ok := strings.CutPrefix(params[i], prefix)
		if !ok {
			return false
		}
		n, err := strconv.ParseUint(value, 10, 32)
		if err != nil || n == 0 {
			return false
		}
		values[i] = uint32(n)
	}
	memory, iterations, parallelism := values[0], values[1], values[2]
	if parallelism > 16 || memory < 8*parallelism || memory > 256*1024 || iterations > 10 {
		return false
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) < 8 || len(salt) > 64 {
		return false
	}
	key, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil || len(key) < 16 || len(key) > 64 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, iterations, memory, uint8(parallelism), uint32(len(key)))
	return subtle.ConstantTimeCompare(actual, key) == 1
}
