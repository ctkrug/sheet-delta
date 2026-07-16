package diff

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"testing"
)

// sheet builds a Sheet from a header and rows written inline, so tests read
// like the spreadsheets they describe.
func sheet(header []string, rows ...[]string) Sheet {
	return Sheet{Header: header, Rows: rows}
}

// render draws the result the way the grid does, one line per row, so a
// failure shows the actual shape a user would see. Changed cells are
// bracketed.
func render(r Result) string {
	var sb strings.Builder
	for _, row := range r.Rows {
		fmt.Fprintf(&sb, "%-6s", row.Op)
		for _, c := range row.Cells {
			if c.Changed {
				fmt.Fprintf(&sb, " [%s->%s]", c.Before, c.Value)
			} else {
				fmt.Fprintf(&sb, " %s", c.Value)
			}
		}
		sb.WriteByte('\n')
	}
	return sb.String()
}

func changedCells(r Result) []string {
	var out []string
	for _, row := range r.Rows {
		for i, c := range row.Cells {
			if c.Changed {
				out = append(out, fmt.Sprintf("%s:%s->%s", r.Columns[i].Name, c.Before, c.Value))
			}
		}
	}
	return out
}

// THE WOW MOMENT (Story 1). One cell edited and one row moved must render
// as exactly one highlighted cell and zero added/removed rows. A text diff
// gets this wrong in both directions, which is the entire reason this tool
// exists.
func TestDiffReportsAnEditAndAReorderWithoutFalsePositives(t *testing.T) {
	before := sheet([]string{"id", "name", "total"},
		[]string{"1", "Ada", "100"},
		[]string{"2", "Grace", "200"},
		[]string{"3", "Alan", "300"},
		[]string{"4", "Edsger", "400"},
	)
	// Row 3 moved to the top; row 2's total changed 200 -> 250.
	after := sheet([]string{"id", "name", "total"},
		[]string{"3", "Alan", "300"},
		[]string{"1", "Ada", "100"},
		[]string{"2", "Grace", "250"},
		[]string{"4", "Edsger", "400"},
	)

	got := Diff(before, after)

	if want := []string{"total:200->250"}; !equalStrings(changedCells(got), want) {
		t.Fatalf("changed cells = %v, want %v\n%s", changedCells(got), want, render(got))
	}
	if got.Summary.CellsChanged != 1 {
		t.Errorf("CellsChanged = %d, want 1\n%s", got.Summary.CellsChanged, render(got))
	}
	if got.Summary.RowsAdded != 0 || got.Summary.RowsRemoved != 0 {
		t.Errorf("reorder reported as +%d/-%d rows, want 0/0\n%s",
			got.Summary.RowsAdded, got.Summary.RowsRemoved, render(got))
	}
	if got.Summary.RowsChanged != 1 {
		t.Errorf("RowsChanged = %d, want 1\n%s", got.Summary.RowsChanged, render(got))
	}
	if got.Summary.RowsMoved != 1 {
		t.Errorf("RowsMoved = %d, want 1\n%s", got.Summary.RowsMoved, render(got))
	}
	// The grid must still show every row of the "after" sheet.
	if len(got.Rows) != 4 {
		t.Errorf("rendered %d rows, want 4\n%s", len(got.Rows), render(got))
	}
}

// The same wow moment, but with the edited row landing on the far side of
// an unchanged row from where it started. Re-sorting a sheet and editing it
// is one action to a user ("I sorted by region and fixed a total"), and the
// edited row's delete and insert end up in different change blocks — so the
// pairing has to reach across the sheet, not just within a block.
func TestDiffPairsARowThatBothMovedAndChanged(t *testing.T) {
	before := sheet([]string{"id", "region", "total"},
		[]string{"1", "North", "200"},
		[]string{"2", "South", "300"},
		[]string{"3", "East", "410"},
	)
	// Row 1 moved below row 2, and its total changed 200 -> 250.
	after := sheet([]string{"id", "region", "total"},
		[]string{"2", "South", "300"},
		[]string{"1", "North", "250"},
		[]string{"3", "East", "410"},
	)

	got := Diff(before, after)

	if want := []string{"total:200->250"}; !equalStrings(changedCells(got), want) {
		t.Fatalf("changed cells = %v, want %v\n%s", changedCells(got), want, render(got))
	}
	if got.Summary.RowsAdded != 0 || got.Summary.RowsRemoved != 0 {
		t.Errorf("moved-and-edited row reported as +%d/-%d rows, want 0/0\n%s",
			got.Summary.RowsAdded, got.Summary.RowsRemoved, render(got))
	}
	if got.Summary.RowsChanged != 1 {
		t.Errorf("RowsChanged = %d, want 1\n%s", got.Summary.RowsChanged, render(got))
	}
	if len(got.Rows) != 3 {
		t.Errorf("rendered %d rows, want 3\n%s", len(got.Rows), render(got))
	}
}

// A block too big to search all-pairs falls back to pairing rows by
// position. That branch only fires above maxBlockComparisons, so nothing
// smaller reaches it — and it is the path a genuinely large edited sheet
// takes, which is exactly when a wrong answer is hardest to spot by eye.
func TestDiffPairsALargeEditedBlockPositionally(t *testing.T) {
	const n = 400 // 400*400 = 160,000 comparisons, over the budget
	before := Sheet{Header: []string{"id", "name", "total"}}
	after := Sheet{Header: []string{"id", "name", "total"}}
	for i := 0; i < n; i++ {
		id := strconv.Itoa(i)
		before.Rows = append(before.Rows, []string{id, "name-" + id, strconv.Itoa(100 + i)})
		// Every row's total is edited, so no row fingerprints equal and the
		// whole sheet lands in one change block.
		after.Rows = append(after.Rows, []string{id, "name-" + id, strconv.Itoa(900 + i)})
	}

	got := Diff(before, after)

	if got.Summary.RowsChanged != n {
		t.Errorf("RowsChanged = %d, want %d", got.Summary.RowsChanged, n)
	}
	if got.Summary.RowsAdded != 0 || got.Summary.RowsRemoved != 0 {
		t.Errorf("edited rows reported as +%d/-%d, want 0/0",
			got.Summary.RowsAdded, got.Summary.RowsRemoved)
	}
	if got.Summary.CellsChanged != n {
		t.Errorf("CellsChanged = %d, want %d (one total per row)", got.Summary.CellsChanged, n)
	}
	if len(got.Rows) != n {
		t.Errorf("rendered %d rows, want %d", len(got.Rows), n)
	}
}

// The other side of that budget: rows too dissimilar to be the same row
// must stay honest adds and removes rather than pair up just because they
// sit at the same position.
func TestDiffLeavesADissimilarLargeBlockAsAddsAndRemoves(t *testing.T) {
	const n = 400
	before := Sheet{Header: []string{"id", "name", "total"}}
	after := Sheet{Header: []string{"id", "name", "total"}}
	for i := 0; i < n; i++ {
		before.Rows = append(before.Rows, []string{strconv.Itoa(i), "alpha-" + strconv.Itoa(i), strconv.Itoa(i)})
		after.Rows = append(after.Rows, []string{strconv.Itoa(i + 10_000), "omega-" + strconv.Itoa(i), strconv.Itoa(i + 5)})
	}

	got := Diff(before, after)

	if got.Summary.RowsChanged != 0 {
		t.Errorf("RowsChanged = %d, want 0 — unrelated rows must not pair", got.Summary.RowsChanged)
	}
	if got.Summary.RowsAdded != n || got.Summary.RowsRemoved != n {
		t.Errorf("summary = +%d/-%d, want +%d/-%d", got.Summary.RowsAdded, got.Summary.RowsRemoved, n, n)
	}
}

func TestDiffReportsIdenticalSheetsAsEntirelyUnchanged(t *testing.T) {
	s := sheet([]string{"id", "total"}, []string{"1", "10"}, []string{"2", "20"})

	got := Diff(s, s)

	if got.Summary != (Summary{RowsUnchanged: 2}) {
		t.Fatalf("summary = %+v, want only 2 unchanged rows\n%s", got.Summary, render(got))
	}
}

// A pure re-sort is the headline false positive of every naive diff tool.
func TestDiffReportsAPureReorderAsZeroChanges(t *testing.T) {
	before := sheet([]string{"id"}, []string{"1"}, []string{"2"}, []string{"3"})
	after := sheet([]string{"id"}, []string{"3"}, []string{"2"}, []string{"1"})

	got := Diff(before, after)

	if got.Summary.RowsAdded != 0 || got.Summary.RowsRemoved != 0 || got.Summary.CellsChanged != 0 {
		t.Fatalf("pure reorder reported changes: %+v\n%s", got.Summary, render(got))
	}
	if got.Summary.RowsMoved+got.Summary.RowsUnchanged != 3 {
		t.Fatalf("expected 3 moved/unchanged rows, got %+v\n%s", got.Summary, render(got))
	}
}

func TestDiffReportsAddedAndRemovedRows(t *testing.T) {
	before := sheet([]string{"id"}, []string{"1"}, []string{"2"})
	after := sheet([]string{"id"}, []string{"1"}, []string{"3"})

	got := Diff(before, after)

	if got.Summary.RowsAdded != 1 || got.Summary.RowsRemoved != 1 {
		t.Fatalf("summary = %+v, want 1 added and 1 removed\n%s", got.Summary, render(got))
	}
	// A single-column sheet has nothing left to match on, so these are
	// genuinely different rows rather than one modified row.
	if got.Summary.RowsChanged != 0 {
		t.Errorf("RowsChanged = %d, want 0\n%s", got.Summary.RowsChanged, render(got))
	}
}

// Story 4: an inserted column must not cascade into every cell changing.
func TestDiffTreatsAnInsertedColumnAsOneColumnInsert(t *testing.T) {
	before := sheet([]string{"id", "total"},
		[]string{"1", "10"},
		[]string{"2", "20"},
	)
	after := sheet([]string{"id", "region", "total"},
		[]string{"1", "west", "10"},
		[]string{"2", "east", "20"},
	)

	got := Diff(before, after)

	if got.Summary.ColumnsAdded != 1 || got.Summary.ColumnsRemoved != 0 {
		t.Errorf("columns +%d/-%d, want +1/-0", got.Summary.ColumnsAdded, got.Summary.ColumnsRemoved)
	}
	if got.Summary.CellsChanged != 0 {
		t.Errorf("CellsChanged = %d, want 0 — an added column is not a cell edit\n%s",
			got.Summary.CellsChanged, render(got))
	}
	if got.Summary.RowsUnchanged != 2 {
		t.Errorf("RowsUnchanged = %d, want 2\n%s", got.Summary.RowsUnchanged, render(got))
	}
	// The new column's values must still render in the grid.
	if v := got.Rows[0].Cells[1].Value; v != "west" {
		t.Errorf("inserted column cell = %q, want %q\n%s", v, "west", render(got))
	}
}

// Story 4: a removed column must not misalign the cell diffs that remain.
func TestDiffTreatsARemovedColumnAsOneColumnRemoval(t *testing.T) {
	before := sheet([]string{"id", "region", "total"},
		[]string{"1", "west", "10"},
		[]string{"2", "east", "20"},
	)
	after := sheet([]string{"id", "total"},
		[]string{"1", "10"},
		[]string{"2", "99"}, // and one real edit, which must still be found
	)

	got := Diff(before, after)

	if got.Summary.ColumnsRemoved != 1 {
		t.Errorf("ColumnsRemoved = %d, want 1", got.Summary.ColumnsRemoved)
	}
	if want := []string{"total:20->99"}; !equalStrings(changedCells(got), want) {
		t.Fatalf("changed cells = %v, want %v\n%s", changedCells(got), want, render(got))
	}
}

// Story 11: empty is a value. Going from blank to filled is an edit, and
// silently ignoring it would hide exactly the kind of change people open
// this tool to find.
func TestDiffFlagsCellsChangingToAndFromEmpty(t *testing.T) {
	before := sheet([]string{"id", "note"},
		[]string{"1", ""},
		[]string{"2", "keep"},
	)
	after := sheet([]string{"id", "note"},
		[]string{"1", "added"},
		[]string{"2", ""},
	)

	got := Diff(before, after)

	want := []string{"note:->added", "note:keep->"}
	if !equalStrings(changedCells(got), want) {
		t.Fatalf("changed cells = %v, want %v\n%s", changedCells(got), want, render(got))
	}
}

// Story 11: identical numbers formatted differently are not edits.
func TestDiffIgnoresNumericReformatting(t *testing.T) {
	before := sheet([]string{"id", "total"}, []string{"1", "1.0"}, []string{"2", "2.50"})
	after := sheet([]string{"id", "total"}, []string{"1", "1"}, []string{"2", "2.5"})

	got := Diff(before, after)

	if got.Summary.CellsChanged != 0 {
		t.Fatalf("reformatting reported as %d changed cells\n%s", got.Summary.CellsChanged, render(got))
	}
}

// Story 10: byte-identical rows are common (blank spacers, repeated
// placeholders) and must not collapse onto one another.
func TestDiffKeepsDuplicateRowsDistinct(t *testing.T) {
	before := sheet([]string{"id", "note"},
		[]string{"", ""},
		[]string{"", ""},
		[]string{"1", "real"},
	)
	after := sheet([]string{"id", "note"},
		[]string{"", ""},
		[]string{"", ""},
		[]string{"", ""},
		[]string{"1", "real"},
	)

	got := Diff(before, after)

	if len(got.Rows) != 4 {
		t.Fatalf("rendered %d rows, want 4\n%s", len(got.Rows), render(got))
	}
	if got.Summary.RowsAdded != 1 {
		t.Errorf("RowsAdded = %d, want 1 (one extra blank row)\n%s", got.Summary.RowsAdded, render(got))
	}
	if got.Summary.RowsRemoved != 0 || got.Summary.CellsChanged != 0 {
		t.Errorf("duplicate rows produced -%d rows / %d changed cells, want 0/0\n%s",
			got.Summary.RowsRemoved, got.Summary.CellsChanged, render(got))
	}
}

func TestDiffHandlesEmptySheets(t *testing.T) {
	empty := sheet(nil)
	full := sheet([]string{"id"}, []string{"1"})

	if got := Diff(empty, empty); len(got.Rows) != 0 || got.Summary != (Summary{}) {
		t.Errorf("empty vs empty = %+v, want nothing", got.Summary)
	}
	if got := Diff(empty, full); got.Summary.RowsAdded != 1 || got.Summary.ColumnsAdded != 1 {
		t.Errorf("empty vs full summary = %+v, want 1 row and 1 column added", got.Summary)
	}
	if got := Diff(full, empty); got.Summary.RowsRemoved != 1 || got.Summary.ColumnsRemoved != 1 {
		t.Errorf("full vs empty summary = %+v, want 1 row and 1 column removed", got.Summary)
	}
}

// Real exports have ragged rows: trailing empty cells get dropped. A short
// row means empty cells, not a panic.
func TestDiffHandlesRaggedRows(t *testing.T) {
	before := sheet([]string{"id", "name", "note"},
		[]string{"1"},
		[]string{"2", "Grace"},
	)
	after := sheet([]string{"id", "name", "note"},
		[]string{"1", "", ""},
		[]string{"2", "Grace", "new"},
	)

	got := Diff(before, after)

	if want := []string{"note:->new"}; !equalStrings(changedCells(got), want) {
		t.Fatalf("changed cells = %v, want %v\n%s", changedCells(got), want, render(got))
	}
}

// Sheets that share no columns have no basis for matching rows; the result
// must still be a well-formed grid rather than a panic or a bogus pairing.
func TestDiffHandlesSheetsWithNoSharedColumns(t *testing.T) {
	before := sheet([]string{"a"}, []string{"1"})
	after := sheet([]string{"z"}, []string{"9"})

	got := Diff(before, after)

	if got.Summary.RowsAdded != 1 || got.Summary.RowsRemoved != 1 {
		t.Errorf("summary = %+v, want 1 added and 1 removed row\n%s", got.Summary, render(got))
	}
	if got.Summary.CellsChanged != 0 {
		t.Errorf("CellsChanged = %d, want 0\n%s", got.Summary.CellsChanged, render(got))
	}
	for _, row := range got.Rows {
		if len(row.Cells) != len(got.Columns) {
			t.Fatalf("row has %d cells but there are %d columns", len(row.Cells), len(got.Columns))
		}
	}
}

// Every rendered row must carry one cell per column, or the frontend's
// grid would tear.
func TestDiffAlwaysRendersOneCellPerColumn(t *testing.T) {
	before := sheet([]string{"id", "drop", "total"}, []string{"1", "x", "10"}, []string{"2", "y", "20"})
	after := sheet([]string{"id", "add", "total"}, []string{"1", "n", "11"}, []string{"3", "m", "30"})

	got := Diff(before, after)

	if len(got.Columns) != 4 { // id, drop(-), add(+), total
		t.Fatalf("got %d columns, want 4: %v", len(got.Columns), names(got.Columns))
	}
	for i, row := range got.Rows {
		if len(row.Cells) != len(got.Columns) {
			t.Fatalf("row %d has %d cells, want %d\n%s", i, len(row.Cells), len(got.Columns), render(got))
		}
	}
}

// The frontend consumes this over the WASM boundary as JSON, so ops must
// survive as readable names rather than bare ordinals.
func TestResultMarshalsOpsAsNames(t *testing.T) {
	before := sheet([]string{"id"}, []string{"1"})
	after := sheet([]string{"id"}, []string{"2"})

	data, err := json.Marshal(Diff(before, after))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(data), `"op":"insert"`) || !strings.Contains(string(data), `"op":"delete"`) {
		t.Fatalf("ops did not marshal as names: %s", data)
	}

	// Decode the way the frontend does — ops as strings — rather than back
	// into a Result. Nothing decodes an Op on this side of the boundary, so
	// reading the payload as JS sees it is the contract worth pinning.
	var wire struct {
		Rows []struct {
			Op string `json:"op"`
		} `json:"rows"`
		Summary Summary `json:"summary"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if wire.Summary != Diff(before, after).Summary {
		t.Errorf("summary did not survive the encoding: %+v", wire.Summary)
	}
	for i, row := range wire.Rows {
		if row.Op == "" {
			t.Errorf("row %d encoded no op name: %s", i, data)
		}
	}
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
