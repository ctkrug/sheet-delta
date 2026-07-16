package diff

import (
	"math/rand"
	"strconv"
	"testing"
)

func TestEqualTreatsNumericFormattingAsTheSameValue(t *testing.T) {
	same := [][2]string{
		{"1", "1.0"},
		{"1.0", "1.00"},
		{"1e3", "1000"},
		{"0", "-0"},
		{" 42 ", "42"},
		{"3.14", "3.140"},
		{"-0.5", "-.5"},
	}
	for _, pair := range same {
		if !Equal(pair[0], pair[1]) {
			t.Errorf("Equal(%q, %q) = false, want true", pair[0], pair[1])
		}
	}
}

func TestEqualDistinguishesGenuinelyDifferentValues(t *testing.T) {
	differ := [][2]string{
		{"1", "2"},
		{"1", "1.1"},
		{"paid", "Paid"},   // text case is real data
		{"", "0"},          // empty is not zero
		{"", " x"},         //
		{"abc", "abd"},     //
		{"1,000", "1000"},  // thousands separators are not parsed as numbers
		{"0.1", "0.10001"}, //
	}
	for _, pair := range differ {
		if Equal(pair[0], pair[1]) {
			t.Errorf("Equal(%q, %q) = true, want false", pair[0], pair[1])
		}
	}
}

func TestEqualTreatsBlankAndWhitespaceOnlyCellsAsEmpty(t *testing.T) {
	for _, v := range []string{"", " ", "\t", "\n", "   "} {
		if !Equal(v, "") {
			t.Errorf("Equal(%q, \"\") = false, want true", v)
		}
		if Normalize(v) != "" {
			t.Errorf("Normalize(%q) = %q, want empty", v, Normalize(v))
		}
	}
}

func TestNormalizeLeavesNonNumericTextIntact(t *testing.T) {
	for _, v := range []string{"NaN", "Inf", "+Inf", "-Infinity", "N/A", "TRUE", "2026-07-16"} {
		if got := Normalize(" " + v + " "); got != v {
			t.Errorf("Normalize(%q) = %q, want %q", v, got, v)
		}
	}
}

// Equal must be an equivalence relation: anything else makes row
// fingerprinting (which relies on Normalize as a canonical key) disagree
// with cell comparison, and cells would flip between changed and unchanged
// depending on which side they were read from.
func TestEqualIsAnEquivalenceRelation(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	pool := make([]string, 0, 64)
	for i := 0; i < 18; i++ {
		n := rng.Float64()*200 - 100
		pool = append(pool,
			strconv.FormatFloat(n, 'f', rng.Intn(4), 64),
			strconv.FormatFloat(n, 'g', -1, 64),
			strconv.FormatFloat(n, 'e', rng.Intn(4), 64),
		)
	}
	pool = append(pool, "", " ", "text", "Text", "0", "-0", "1e3")

	for _, a := range pool {
		if !Equal(a, a) {
			t.Fatalf("not reflexive: Equal(%q, %q) = false", a, a)
		}
		for _, b := range pool {
			if Equal(a, b) != Equal(b, a) {
				t.Fatalf("not symmetric: %q vs %q", a, b)
			}
			for _, c := range pool {
				if Equal(a, b) && Equal(b, c) && !Equal(a, c) {
					t.Fatalf("not transitive: %q ~ %q ~ %q but %q !~ %q", a, b, c, a, c)
				}
			}
		}
	}
}
