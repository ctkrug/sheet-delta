package diff

// ColumnDiff describes one column of the aligned output.
type ColumnDiff struct {
	Op Op `json:"op"`
	// AIndex is the column's index in the "before" header, or -1 if OpInsert.
	AIndex int `json:"aIndex"`
	// BIndex is the column's index in the "after" header, or -1 if OpDelete.
	BIndex int `json:"bIndex"`
	// Name is the column's header text, taken from whichever side has it.
	Name string `json:"name"`
}

// AlignColumns matches the two header rows by name, returning the columns
// in output order.
//
// Columns are aligned before rows for a reason: a column inserted upstream
// shifts every later cell, so a row fingerprint taken over raw positions
// would report every row as changed. Aligning headers first lets rows be
// fingerprinted over only the columns the two sheets share, which keeps an
// inserted column a single column-level insert instead of a sheet-wide
// cascade.
//
// Matching is by header name (under the Normalize rule), not by position,
// so a reordered column follows its data. Duplicate header names are
// aligned positionally among themselves, which is the best available
// guess when a sheet gives two columns the same name.
func AlignColumns(headerA, headerB []string) []ColumnDiff {
	in := newInterner(len(headerA) + len(headerB))
	ka := make([]uint64, len(headerA))
	for i, name := range headerA {
		ka[i] = in.key(Normalize(name))
	}
	kb := make([]uint64, len(headerB))
	for i, name := range headerB {
		kb[i] = in.key(Normalize(name))
	}

	edits := alignKeys(ka, kb)
	cols := make([]ColumnDiff, 0, len(edits))
	for _, e := range edits {
		col := ColumnDiff{Op: e.op, AIndex: e.aIndex, BIndex: e.bIndex}
		if e.bIndex >= 0 {
			col.Name = headerB[e.bIndex]
		} else {
			col.Name = headerA[e.aIndex]
		}
		cols = append(cols, col)
	}
	return cols
}

// sharedColumns returns only the columns present in both sheets, which are
// the columns a row's identity and cell comparison are computed over.
func sharedColumns(cols []ColumnDiff) []ColumnDiff {
	shared := make([]ColumnDiff, 0, len(cols))
	for _, c := range cols {
		if c.Op == OpEqual {
			shared = append(shared, c)
		}
	}
	return shared
}
