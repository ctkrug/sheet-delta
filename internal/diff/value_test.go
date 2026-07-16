package diff

import (
	"math"
	"math/rand"
	"strconv"
	"strings"
	"testing"
)

// normalizeReference is Normalize without the first-byte fast path: the
// straightforward version whose behaviour is the contract. The fast path is
// an optimization, and an optimization that changes an answer is a bug.
func normalizeReference(v string) string {
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return ""
	}
	if f, err := strconv.ParseFloat(trimmed, 64); err == nil && !math.IsInf(f, 0) && !math.IsNaN(f) {
		if f == 0 {
			f = 0
		}
		return strconv.FormatFloat(f, 'g', -1, 64)
	}
	return trimmed
}

// The fast path rejects cells on their first byte. If it ever rejects
// something ParseFloat would have accepted, two numerically equal cells
// start comparing unequal and the diff quietly fills with false positives.
func TestNormalizeFastPathAgreesWithTheReference(t *testing.T) {
	cases := []string{
		"", " ", "0", "-0", "+0", ".5", "-.5", "+.5", "1e3", "1E3", "-1e-3",
		"0x1p-2", "Inf", "-Inf", "+Inf", "inf", "Infinity", "NaN", "nan", "-NaN",
		"007", "1_000", "1,000", "abc", "Ada", "north", "In stock", "Not applicable",
		"n/a", "N/A", "i", "I", "n", "N", "-", "+", ".", "e5", "1.2.3", "٣",
		"true", "TRUE", "2026-07-16", "  42  ", "42%", "$42", "1/2",
	}
	// Random digit-ish strings probe the boundary between the two paths.
	rng := rand.New(rand.NewSource(11))
	alphabet := []byte("0123456789+-.eEinIN xX")
	for i := 0; i < 4000; i++ {
		n := rng.Intn(6) + 1
		b := make([]byte, n)
		for j := range b {
			b[j] = alphabet[rng.Intn(len(alphabet))]
		}
		cases = append(cases, string(b))
	}

	for _, v := range cases {
		if got, want := Normalize(v), normalizeReference(v); got != want {
			t.Errorf("Normalize(%q) = %q, reference says %q", v, got, want)
		}
	}
}

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

// Go's ParseFloat accepts Go *literal* syntax, which is a much larger
// language than "a number a spreadsheet cell holds": underscore digit
// separators and hex-float exponents both parse. A cell reading "1_000" is
// text to every spreadsheet on earth, so treating it as 1000 makes an edit
// from "1_000" to "1000" vanish from the diff — the one failure a diff tool
// must never have.
func TestNormalizeRejectsNumberFormsSpreadsheetsDoNotUse(t *testing.T) {
	for _, v := range []string{"1_000", "1_0", "0x1p-2", "0X1P-2", "0x10", "1_000.5"} {
		if got := Normalize(v); got != v {
			t.Errorf("Normalize(%q) = %q, want it left as text", v, got)
		}
	}
	for _, pair := range [][2]string{{"1_000", "1000"}, {"0x1p-2", "0.25"}, {"0x10", "16"}} {
		if Equal(pair[0], pair[1]) {
			t.Errorf("Equal(%q, %q) = true — a real change would be reported as unchanged", pair[0], pair[1])
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
