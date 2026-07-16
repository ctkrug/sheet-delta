package diff

import (
	"strings"
	"testing"
)

// sheetFromFuzz reads the fuzzer's raw string as a tiny CSV: first line is
// the header, the rest are rows. Rows stay deliberately ragged — real
// exports are, and the engine promises to tolerate it.
func sheetFromFuzz(s string) Sheet {
	// Bound the input so a pathological corpus entry times out the fuzzer
	// instead of finding a bug. Alignment is O(ND); the interesting cases
	// here are structural, not large.
	if len(s) > 4096 {
		s = s[:4096]
	}
	lines := strings.Split(s, "\n")
	sheet := Sheet{Header: strings.Split(lines[0], ",")}
	for _, line := range lines[1:] {
		sheet.Rows = append(sheet.Rows, strings.Split(line, ","))
	}
	return sheet
}

// FuzzDiffHoldsItsInvariants asserts the properties every Result must have,
// whatever it was given. The headline one is conservation: each row of each
// sheet is rendered exactly once. A diff that drops a row — or shows one
// twice — is lying about the data, and a grid is not a shape a reader can
// check by eye, so nothing but a test will catch it.
func FuzzDiffHoldsItsInvariants(f *testing.F) {
	f.Add("id,total\n1,200\n2,300", "id,total\n1,250\n2,300")
	f.Add("id,total\n1,200\n2,300", "id,total\n2,300\n1,200") // pure reorder
	f.Add("a,b\n1,2", "b,a\n2,1")                             // reordered columns
	f.Add("a\n1\n1\n1", "a\n1\n1")                            // duplicate rows
	f.Add("a,b\n1,2", "c,d\n3,4")                             // no shared columns
	f.Add("", "")
	f.Add("a", "")
	f.Add("a,b\n1", "a,b\n1,2,3") // ragged
	f.Add("a\n 1.0 ", "a\n1")     // the normalization rule

	f.Fuzz(func(t *testing.T, beforeCSV, afterCSV string) {
		before := sheetFromFuzz(beforeCSV)
		after := sheetFromFuzz(afterCSV)
		got := Diff(before, after)

		seenA := map[int]bool{}
		seenB := map[int]bool{}
		cellsChanged := 0

		for i, row := range got.Rows {
			if len(row.Cells) != len(got.Columns) {
				t.Fatalf("row %d has %d cells, want one per column (%d)", i, len(row.Cells), len(got.Columns))
			}

			// Indices must name a real row on the sides the op claims, and
			// -1 on the side it says the row does not exist.
			switch row.Op {
			case OpInsert:
				if row.AIndex != -1 {
					t.Fatalf("row %d: inserted row claims before-index %d", i, row.AIndex)
				}
			case OpDelete:
				if row.BIndex != -1 {
					t.Fatalf("row %d: removed row claims after-index %d", i, row.BIndex)
				}
			case OpEqual, OpMove, OpModify:
				if row.AIndex < 0 || row.BIndex < 0 {
					t.Fatalf("row %d: %v row must exist on both sides, got a=%d b=%d", i, row.Op, row.AIndex, row.BIndex)
				}
			default:
				t.Fatalf("row %d: unknown op %v", i, row.Op)
			}

			if row.AIndex >= 0 {
				if row.AIndex >= len(before.Rows) {
					t.Fatalf("row %d: before-index %d out of range (%d rows)", i, row.AIndex, len(before.Rows))
				}
				if seenA[row.AIndex] {
					t.Fatalf("row %d: before-row %d rendered twice", i, row.AIndex)
				}
				seenA[row.AIndex] = true
			}
			if row.BIndex >= 0 {
				if row.BIndex >= len(after.Rows) {
					t.Fatalf("row %d: after-index %d out of range (%d rows)", i, row.BIndex, len(after.Rows))
				}
				if seenB[row.BIndex] {
					t.Fatalf("row %d: after-row %d rendered twice", i, row.BIndex)
				}
				seenB[row.BIndex] = true
			}

			for j, cell := range row.Cells {
				if !cell.Changed {
					continue
				}
				cellsChanged++
				// Only a matched pair on a shared column can hold a change;
				// anything else means a cell was compared against nothing.
				if row.Op != OpModify {
					t.Fatalf("row %d cell %d: changed cell on a %v row", i, j, row.Op)
				}
				if got.Columns[j].Op != OpEqual {
					t.Fatalf("row %d cell %d: changed cell on a %v column", i, j, got.Columns[j].Op)
				}
				if Equal(cell.Before, cell.Value) {
					t.Fatalf("row %d cell %d: %q and %q are equal but flagged changed", i, j, cell.Before, cell.Value)
				}
			}
		}

		// Conservation: nothing dropped from either sheet.
		if len(seenA) != len(before.Rows) {
			t.Fatalf("rendered %d of %d before-rows", len(seenA), len(before.Rows))
		}
		if len(seenB) != len(after.Rows) {
			t.Fatalf("rendered %d of %d after-rows", len(seenB), len(after.Rows))
		}

		// The summary is what the user reads instead of counting; it must
		// agree with the grid exactly.
		s := got.Summary
		if total := s.RowsAdded + s.RowsRemoved + s.RowsChanged + s.RowsMoved + s.RowsUnchanged; total != len(got.Rows) {
			t.Fatalf("summary counts %d rows, grid has %d", total, len(got.Rows))
		}
		if s.CellsChanged != cellsChanged {
			t.Fatalf("summary counts %d changed cells, grid has %d", s.CellsChanged, cellsChanged)
		}
	})
}
