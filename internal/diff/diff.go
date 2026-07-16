// Package diff implements row- and cell-level comparison of tabular data.
//
// Unlike a text diff, DiffRows treats each row as an opaque unit and aligns
// rows via longest-common-subsequence over row fingerprints, so a row that
// simply moved is recognized as unchanged rather than delete+insert. Callers
// then run CellDiff only on matched row pairs to find the specific cells
// that changed.
package diff

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Op identifies how a row in the diff relates to the two input sheets.
type Op int

const (
	// Equal marks a row present in both sheets at the same aligned position.
	Equal Op = iota
	// Insert marks a row present only in the "after" sheet.
	Insert
	// Delete marks a row present only in the "before" sheet.
	Delete
)

// RowDiff describes one row of the aligned output.
type RowDiff struct {
	Op     Op
	AIndex int // index into the "before" rows, or -1 if Insert
	BIndex int // index into the "after" rows, or -1 if Delete
}

// fingerprint collapses a row's cell values into a single comparable key.
// Two rows with identical cell values in the same order produce the same
// fingerprint regardless of where they sit in the sheet.
func fingerprint(row []string) string {
	sum := sha256.Sum256([]byte(strings.Join(row, "\x1f")))
	return hex.EncodeToString(sum[:])
}

// DiffRows aligns the rows of a and b using longest-common-subsequence over
// row fingerprints, returning an edit script of Equal/Insert/Delete
// operations in output order.
func DiffRows(a, b [][]string) []RowDiff {
	fa := make([]string, len(a))
	for i, row := range a {
		fa[i] = fingerprint(row)
	}
	fb := make([]string, len(b))
	for i, row := range b {
		fb[i] = fingerprint(row)
	}

	n, m := len(fa), len(fb)
	// lcs[i][j] = length of the LCS of fa[i:] and fb[j:].
	lcs := make([][]int, n+1)
	for i := range lcs {
		lcs[i] = make([]int, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if fa[i] == fb[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else if lcs[i+1][j] >= lcs[i][j+1] {
				lcs[i][j] = lcs[i+1][j]
			} else {
				lcs[i][j] = lcs[i][j+1]
			}
		}
	}

	result := make([]RowDiff, 0, n+m)
	i, j := 0, 0
	for i < n && j < m {
		switch {
		case fa[i] == fb[j]:
			result = append(result, RowDiff{Op: Equal, AIndex: i, BIndex: j})
			i++
			j++
		case lcs[i+1][j] >= lcs[i][j+1]:
			result = append(result, RowDiff{Op: Delete, AIndex: i, BIndex: -1})
			i++
		default:
			result = append(result, RowDiff{Op: Insert, AIndex: -1, BIndex: j})
			j++
		}
	}
	for ; i < n; i++ {
		result = append(result, RowDiff{Op: Delete, AIndex: i, BIndex: -1})
	}
	for ; j < m; j++ {
		result = append(result, RowDiff{Op: Insert, AIndex: -1, BIndex: j})
	}
	return result
}

// CellDiff compares two equal-role rows cell by cell and returns the
// indices of cells whose values differ. Rows of unequal length are padded
// with empty cells so trailing insertions/removals of columns still surface
// as changed cells rather than a panic.
func CellDiff(a, b []string) []int {
	n := len(a)
	if len(b) > n {
		n = len(b)
	}
	var changed []int
	for i := 0; i < n; i++ {
		var av, bv string
		if i < len(a) {
			av = a[i]
		}
		if i < len(b) {
			bv = b[i]
		}
		if av != bv {
			changed = append(changed, i)
		}
	}
	return changed
}
