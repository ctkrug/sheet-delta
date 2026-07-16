package diff

import "testing"

func TestDiffRowsDetectsReorderAsUnchanged(t *testing.T) {
	a := [][]string{{"1", "Alice"}, {"2", "Bob"}, {"3", "Carol"}}
	b := [][]string{{"3", "Carol"}, {"1", "Alice"}, {"2", "Bob"}}

	ops := DiffRows(a, b)

	deletes, inserts := 0, 0
	for _, op := range ops {
		switch op.Op {
		case Delete:
			deletes++
		case Insert:
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
		if op.Op == Insert {
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
		if op.Op != Equal {
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
