package diff

import "testing"

func TestDiffRowsDetectsReorderAsUnchanged(t *testing.T) {
	a := [][]string{{"1", "Alice"}, {"2", "Bob"}, {"3", "Carol"}}
	b := [][]string{{"3", "Carol"}, {"1", "Alice"}, {"2", "Bob"}}

	ops := DiffRows(a, b)

	deletes, inserts := 0, 0
	for _, op := range ops {
		switch op.Op {
		case OpDelete:
			deletes++
		case OpInsert:
			inserts++
		}
	}
	// A pure reorder should never be reported as a wholesale delete+insert
	// of every row; some rows must line up as Equal even though every row
	// in b sits at a different index than in a.
	if deletes == len(a) && inserts == len(b) {
		t.Fatalf("reorder reported as full delete+insert, want at least one Equal: %+v", ops)
	}
}

func TestDiffRowsAddedAndRemovedRows(t *testing.T) {
	a := [][]string{{"1", "Alice"}, {"2", "Bob"}}
	b := [][]string{{"1", "Alice"}, {"2", "Bob"}, {"3", "Carol"}}

	ops := DiffRows(a, b)

	var inserts int
	for _, op := range ops {
		if op.Op == OpInsert {
			inserts++
		}
	}
	if inserts != 1 {
		t.Fatalf("got %d inserts, want 1: %+v", inserts, ops)
	}
}

func TestDiffRowsIdenticalSheetsAreAllEqual(t *testing.T) {
	a := [][]string{{"1", "Alice"}, {"2", "Bob"}}
	b := [][]string{{"1", "Alice"}, {"2", "Bob"}}

	ops := DiffRows(a, b)
	if len(ops) != 2 {
		t.Fatalf("got %d ops, want 2: %+v", len(ops), ops)
	}
	for _, op := range ops {
		if op.Op != OpEqual {
			t.Fatalf("op %+v is not Equal for identical sheets", op)
		}
	}
}

func TestCellDiffFindsChangedIndices(t *testing.T) {
	a := []string{"1", "Alice", "NY"}
	b := []string{"1", "Alicia", "NY"}

	changed := CellDiff(a, b)
	if len(changed) != 1 || changed[0] != 1 {
		t.Fatalf("got %v, want [1]", changed)
	}
}

func TestCellDiffHandlesColumnLengthMismatch(t *testing.T) {
	a := []string{"1", "Alice"}
	b := []string{"1", "Alice", "NY"}

	changed := CellDiff(a, b)
	if len(changed) != 1 || changed[0] != 2 {
		t.Fatalf("got %v, want [2]", changed)
	}
}

func TestDiffRowsEmptySheets(t *testing.T) {
	if ops := DiffRows(nil, nil); len(ops) != 0 {
		t.Fatalf("got %+v, want no ops for two empty sheets", ops)
	}
}

func TestDiffRowsFullReplacement(t *testing.T) {
	a := [][]string{{"1", "Alice"}, {"2", "Bob"}}
	b := [][]string{{"9", "Zed"}, {"8", "Yara"}}

	ops := DiffRows(a, b)

	var deletes, inserts, equals int
	for _, op := range ops {
		switch op.Op {
		case OpDelete:
			deletes++
		case OpInsert:
			inserts++
		case OpEqual:
			equals++
		}
	}
	if deletes != len(a) || inserts != len(b) || equals != 0 {
		t.Fatalf("got deletes=%d inserts=%d equals=%d, want %d/%d/0: %+v",
			deletes, inserts, equals, len(a), len(b), ops)
	}
}

func TestCellDiffIdenticalRowsHaveNoChanges(t *testing.T) {
	row := []string{"1", "Alice", "NY"}
	if changed := CellDiff(row, row); len(changed) != 0 {
		t.Fatalf("got %v, want no changes for identical rows", changed)
	}
}
