package diff

import "testing"

// names renders an alignment as "name:op" pairs so expectations read as
// the shape a user would see, not as index arithmetic.
func names(cols []ColumnDiff) []string {
	out := make([]string, 0, len(cols))
	for _, c := range cols {
		var op string
		switch c.Op {
		case OpEqual:
			op = "="
		case OpInsert:
			op = "+"
		case OpDelete:
			op = "-"
		}
		out = append(out, c.Name+op)
	}
	return out
}

func assertColumns(t *testing.T, got []ColumnDiff, want []string) {
	t.Helper()
	g := names(got)
	if len(g) != len(want) {
		t.Fatalf("got %v, want %v", g, want)
	}
	for i := range want {
		if g[i] != want[i] {
			t.Fatalf("got %v, want %v", g, want)
		}
	}
}

func TestAlignColumnsDetectsIdenticalHeaders(t *testing.T) {
	h := []string{"id", "name", "total"}
	assertColumns(t, AlignColumns(h, h), []string{"id=", "name=", "total="})
}

// Story 4: an inserted column is one insert, not a cascade that marks
// every column after it as changed.
func TestAlignColumnsDetectsAMidSheetInsertAsASingleInsert(t *testing.T) {
	before := []string{"id", "name", "total"}
	after := []string{"id", "name", "region", "total"}
	assertColumns(t, AlignColumns(before, after), []string{"id=", "name=", "region+", "total="})
}

// Story 4: removing a column must not misalign the columns that remain.
func TestAlignColumnsDetectsAMidSheetRemoval(t *testing.T) {
	before := []string{"id", "name", "region", "total"}
	after := []string{"id", "name", "total"}
	assertColumns(t, AlignColumns(before, after), []string{"id=", "name=", "region-", "total="})
}

func TestAlignColumnsFollowsReorderedColumnsByName(t *testing.T) {
	before := []string{"id", "name", "total"}
	after := []string{"id", "total", "name"}

	cols := AlignColumns(before, after)
	shared := sharedColumns(cols)
	if len(shared) != 2 {
		t.Fatalf("reorder matched %d columns by name, want 2: %v", len(shared), names(cols))
	}
	// A moved column keeps its data: whichever one is matched must point at
	// the same header text on both sides.
	for _, c := range shared {
		if Normalize(before[c.AIndex]) != Normalize(after[c.BIndex]) {
			t.Fatalf("matched %q to %q", before[c.AIndex], after[c.BIndex])
		}
	}
}

func TestAlignColumnsIgnoresHeaderWhitespaceAndNumericFormatting(t *testing.T) {
	before := []string{"id", " name ", "2024"}
	after := []string{"id", "name", "2024.0"}
	assertColumns(t, AlignColumns(before, after), []string{"id=", "name=", "2024.0="})
}

func TestAlignColumnsHandlesEmptyHeaders(t *testing.T) {
	if cols := AlignColumns(nil, nil); len(cols) != 0 {
		t.Errorf("two empty headers produced %v, want none", names(cols))
	}
	assertColumns(t, AlignColumns(nil, []string{"id"}), []string{"id+"})
	assertColumns(t, AlignColumns([]string{"id"}, nil), []string{"id-"})
}

func TestAlignColumnsHandlesFullReplacement(t *testing.T) {
	assertColumns(t, AlignColumns([]string{"a", "b"}, []string{"x", "y"}),
		[]string{"a-", "b-", "x+", "y+"})
}

// A sheet with two columns of the same name is malformed but real; the
// alignment must stay well-formed rather than dropping or duplicating one.
func TestAlignColumnsHandlesDuplicateHeaderNames(t *testing.T) {
	cols := AlignColumns([]string{"id", "id", "total"}, []string{"id", "id", "total"})
	assertColumns(t, cols, []string{"id=", "id=", "total="})

	cols = AlignColumns([]string{"id", "total"}, []string{"id", "id", "total"})
	if got := len(sharedColumns(cols)); got != 2 {
		t.Fatalf("matched %d columns, want 2: %v", got, names(cols))
	}
}

// Empty header cells are common in real exports (trailing commas, spacer
// columns) and must not be treated as absent.
func TestAlignColumnsTreatsBlankHeadersAsRealColumns(t *testing.T) {
	assertColumns(t, AlignColumns([]string{"id", ""}, []string{"id", ""}), []string{"id=", "="})
}
