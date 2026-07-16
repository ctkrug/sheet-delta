// Package diff compares two sheets of tabular data cell by cell.
//
// A text diff flattens a sheet to lines, so it reports a row that merely
// moved as a delete plus an insert, and a row with one edited cell as two
// entirely different lines. This package treats the problem as
// two-dimensional instead:
//
//  1. Columns are aligned by header name, so a column inserted upstream
//     does not shift every later cell into looking changed.
//  2. Rows are fingerprinted over the columns the two sheets share and
//     aligned with a longest-common-subsequence edit script, so a row's
//     identity is its content, not its position.
//  3. Leftover rows are paired into moves (same content, new position) and
//     modifications (same row, edited cells).
//  4. Only within a matched pair are cells compared, so exactly the cells
//     that changed are flagged.
//
// The result is the sheet itself, laid out as a grid, with changes marked
// in place — see Result.
package diff

import "strings"

// Sheet is one side of a comparison: a header row plus its data rows.
// Rows are ragged-tolerant; a short row is treated as having empty cells.
type Sheet struct {
	Header []string   `json:"header"`
	Rows   [][]string `json:"rows"`
}

// Cell is one rendered cell of the diff grid.
type Cell struct {
	// Value is the cell's content in the "after" sheet, or in the "before"
	// sheet for a deleted row or column.
	Value string `json:"value"`
	// Before is the prior content, set only when Changed is true.
	Before string `json:"before,omitempty"`
	// Changed marks a cell whose value differs between two matched rows.
	Changed bool `json:"changed"`
}

// RowResult is one rendered row of the diff grid. Cells is parallel to
// Result.Columns, so the frontend can render a row without consulting the
// column alignment.
type RowResult struct {
	Op Op `json:"op"`
	// AIndex is the row's index in the "before" sheet, or -1 if inserted.
	AIndex int `json:"aIndex"`
	// BIndex is the row's index in the "after" sheet, or -1 if deleted.
	BIndex int    `json:"bIndex"`
	Cells  []Cell `json:"cells"`
}

// Summary counts the diff at a glance. Rows are counted by what happened
// to them, so every rendered row falls into exactly one row bucket.
type Summary struct {
	RowsAdded      int `json:"rowsAdded"`
	RowsRemoved    int `json:"rowsRemoved"`
	RowsChanged    int `json:"rowsChanged"`
	RowsMoved      int `json:"rowsMoved"`
	RowsUnchanged  int `json:"rowsUnchanged"`
	CellsChanged   int `json:"cellsChanged"`
	ColumnsAdded   int `json:"columnsAdded"`
	ColumnsRemoved int `json:"columnsRemoved"`
}

// Result is a complete comparison, shaped for direct rendering as a grid.
type Result struct {
	Columns []ColumnDiff `json:"columns"`
	Rows    []RowResult  `json:"rows"`
	Summary Summary      `json:"summary"`
}

// cellAt reads a row's cell defensively: real exports contain ragged rows,
// and a short row means an empty cell, not a panic.
func cellAt(row []string, i int) string {
	if i < 0 || i >= len(row) {
		return ""
	}
	return row[i]
}

// Diff compares two sheets and returns the aligned grid.
func Diff(before, after Sheet) Result {
	cols := AlignColumns(before.Header, after.Header)
	shared := sharedColumns(cols)

	if len(shared) == 0 {
		// With no column in common there is nothing to establish row
		// identity from, so no row of one sheet can be "the same row" as any
		// row of the other. Matching on an empty fingerprint would pair rows
		// arbitrarily.
		return replaceAll(before, after, cols)
	}

	// One interner across both sheets: keys are only comparable if they come
	// from the same mapping.
	in := newInterner(len(before.Rows) + len(after.Rows))
	keysA := fingerprintRows(in, before.Rows, shared, func(c ColumnDiff) int { return c.AIndex })
	keysB := fingerprintRows(in, after.Rows, shared, func(c ColumnDiff) int { return c.BIndex })

	script := alignKeys(keysA, keysB)
	pairs := pairRows(script, keysA, keysB, func(ai, bi int) float64 {
		return rowSimilarity(before.Rows[ai], after.Rows[bi], shared)
	})

	result := Result{Columns: cols, Rows: make([]RowResult, 0, len(script))}
	for _, e := range script {
		switch e.op {
		case OpEqual:
			result.Rows = append(result.Rows, buildRow(OpEqual, e.aIndex, e.bIndex, before, after, cols))
		case OpInsert:
			// An insert that found a partner is really that partner moved or
			// modified; it renders here, at its position in the "after" sheet.
			ai, paired := pairs.bToA[e.bIndex]
			if !paired {
				result.Rows = append(result.Rows, buildRow(OpInsert, -1, e.bIndex, before, after, cols))
				continue
			}
			op := OpModify
			if _, isMove := pairs.moved[e.bIndex]; isMove {
				op = OpMove
			}
			result.Rows = append(result.Rows, buildRow(op, ai, e.bIndex, before, after, cols))
		case OpDelete:
			// A paired delete already rendered at its partner's position.
			if _, paired := pairs.pairedA[e.aIndex]; paired {
				continue
			}
			result.Rows = append(result.Rows, buildRow(OpDelete, e.aIndex, -1, before, after, cols))
		}
	}

	result.Summary = summarize(result)
	return result
}

// replaceAll renders every "before" row as removed and every "after" row
// as added, for the case where the two sheets have no column in common.
func replaceAll(before, after Sheet, cols []ColumnDiff) Result {
	result := Result{Columns: cols, Rows: make([]RowResult, 0, len(before.Rows)+len(after.Rows))}
	for i := range before.Rows {
		result.Rows = append(result.Rows, buildRow(OpDelete, i, -1, before, after, cols))
	}
	for i := range after.Rows {
		result.Rows = append(result.Rows, buildRow(OpInsert, -1, i, before, after, cols))
	}
	result.Summary = summarize(result)
	return result
}

// fingerprintRows reduces each row to a key over the shared columns only.
// Comparing over shared columns is what lets an inserted column stay a
// single column-level insert: the rows either side of it still fingerprint
// identically. index selects which side's column position to read.
func fingerprintRows(in *interner, rows [][]string, shared []ColumnDiff, index func(ColumnDiff) int) []uint64 {
	keys := make([]uint64, len(rows))
	var sb strings.Builder
	for i, row := range rows {
		sb.Reset()
		for _, c := range shared {
			sb.WriteString(Normalize(cellAt(row, index(c))))
			// A separator no spreadsheet cell contains keeps ["a","b"] from
			// colliding with ["ab", ""].
			sb.WriteByte(0x1f)
		}
		keys[i] = in.key(sb.String())
	}
	return keys
}

// rowSimilarity is the fraction of shared columns on which two rows agree.
// Sheets with no shared columns have no basis for pairing rows at all.
func rowSimilarity(a, b []string, shared []ColumnDiff) float64 {
	if len(shared) == 0 {
		return 0
	}
	same := 0
	for _, c := range shared {
		if Equal(cellAt(a, c.AIndex), cellAt(b, c.BIndex)) {
			same++
		}
	}
	return float64(same) / float64(len(shared))
}

// buildRow renders one row across every column of the aligned output.
func buildRow(op Op, ai, bi int, before, after Sheet, cols []ColumnDiff) RowResult {
	row := RowResult{Op: op, AIndex: ai, BIndex: bi, Cells: make([]Cell, len(cols))}
	for i, c := range cols {
		var cell Cell
		switch {
		case c.Op == OpDelete:
			// A removed column has no "after" value; show what was there.
			if ai >= 0 {
				cell.Value = cellAt(before.Rows[ai], c.AIndex)
			}
		case bi >= 0:
			cell.Value = cellAt(after.Rows[bi], c.BIndex)
		default:
			cell.Value = cellAt(before.Rows[ai], c.AIndex)
		}

		// Only a matched pair on a shared column can hold a changed cell:
		// an added column's values are new everywhere, and an added or
		// removed row has nothing to compare against.
		if op == OpModify && c.Op == OpEqual && ai >= 0 && bi >= 0 {
			old := cellAt(before.Rows[ai], c.AIndex)
			if !Equal(old, cell.Value) {
				cell.Changed = true
				cell.Before = old
			}
		}
		row.Cells[i] = cell
	}
	return row
}

func summarize(r Result) Summary {
	var s Summary
	for _, c := range r.Columns {
		switch c.Op {
		case OpInsert:
			s.ColumnsAdded++
		case OpDelete:
			s.ColumnsRemoved++
		}
	}
	for _, row := range r.Rows {
		switch row.Op {
		case OpEqual:
			s.RowsUnchanged++
		case OpInsert:
			s.RowsAdded++
		case OpDelete:
			s.RowsRemoved++
		case OpMove:
			s.RowsMoved++
		case OpModify:
			s.RowsChanged++
		}
		for _, cell := range row.Cells {
			if cell.Changed {
				s.CellsChanged++
			}
		}
	}
	return s
}
