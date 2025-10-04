package match

import "strings"

// Compares two strings with whitespace normalization.
// Returns true if they match, false otherwise.
//
// The comparison ignores leading and trailing whitespace on each line,
// collapses multiple whitespace characters between tokens into a single space,
// and ignores empty lines.
// It performs a line-by-line and token-by-token comparison after normalization.
func Match(ls, rs string) bool {
	// split by newlines
	lsLines := strings.Split(ls, "\n")
	rsLines := strings.Split(rs, "\n")

	// trim whitespace in the beginning and the end of each line
	// note that "whitespace" is all whitespace characters in Unicode
	lsLines = trimLines(lsLines)
	rsLines = trimLines(rsLines)

	// Remove empty lines
	lsLines = removeEmptyLines(lsLines)
	rsLines = removeEmptyLines(rsLines)

	// compare line by line
	if len(lsLines) != len(rsLines) {
		return false
	}

	for i := range lsLines {
		// split by whitespace
		lsTokens := strings.Fields(lsLines[i])
		rsTokens := strings.Fields(rsLines[i])

		if len(lsTokens) != len(rsTokens) {
			return false
		}

		// Compare token by token
		for j := range lsTokens {
			if lsTokens[j] != rsTokens[j] {
				return false
			}
		}
	}

	return true
}

func trimLines(lines []string) []string {
	result := make([]string, len(lines))
	for i, line := range lines {
		result[i] = strings.TrimSpace(line)
	}
	return result
}

func removeEmptyLines(lines []string) []string {
	result := []string{}
	for _, line := range lines {
		if line != "" {
			result = append(result, line)
		}
	}
	return result
}
