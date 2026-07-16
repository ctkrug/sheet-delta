package diff

import (
	"math"
	"strconv"
	"strings"
)

// Normalize reduces a raw cell value to the canonical form used for every
// comparison in this package.
//
// The rule, applied consistently to fingerprints and to cell comparison:
//
//  1. Surrounding whitespace is insignificant — spreadsheet exports pad
//     values unpredictably and " 42" is not a meaningful edit.
//  2. A value that parses as a finite number is canonicalized to its
//     shortest round-trip decimal form, so "1.0", "1", and "1e0" are the
//     same value. This matters because CSV and .xlsx exports of identical
//     data routinely disagree on number formatting, and reporting those as
//     changes would bury the real edits.
//  3. Anything else compares as an exact, case-sensitive string. Text case
//     is real data ("paid" vs "Paid" may matter), so it is preserved.
//
// Infinities and NaN fall through to the string rule: they are not values
// a spreadsheet cell holds as data, and canonicalizing them would make
// "inf" and "Infinity" collide.
func Normalize(v string) string {
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return ""
	}
	// Normalize runs on every cell of both sheets, so a 50,000-row compare
	// calls it hundreds of thousands of times. ParseFloat is expensive even
	// when it fails, and most cells in a real sheet are text that cannot
	// begin a number — rejecting those on the first byte is what keeps the
	// fingerprinting pass from dominating the diff.
	if !canStartNumber(trimmed[0]) {
		return trimmed
	}
	if f, err := strconv.ParseFloat(trimmed, 64); err == nil && !math.IsInf(f, 0) && !math.IsNaN(f) {
		if f == 0 {
			f = 0 // collapse -0 onto 0, which FormatFloat otherwise renders as "-0"
		}
		return strconv.FormatFloat(f, 'g', -1, 64)
	}
	return trimmed
}

// canStartNumber reports whether a byte could begin a number ParseFloat
// accepts. It must not reject anything ParseFloat would take, or two
// numerically equal cells would compare unequal — hence "Ii" and "Nn",
// which cover the Inf and NaN forms Normalize deliberately falls through
// on but which must still reach ParseFloat to be recognized.
func canStartNumber(c byte) bool {
	switch {
	case c >= '0' && c <= '9':
		return true
	case c == '+' || c == '-' || c == '.':
		return true
	case c == 'i' || c == 'I' || c == 'n' || c == 'N':
		return true
	default:
		return false
	}
}

// Equal reports whether two raw cell values represent the same data under
// the rule documented on Normalize.
func Equal(a, b string) bool {
	return Normalize(a) == Normalize(b)
}
