package diff

import "fmt"

// Op identifies how a row or column in the diff relates to the two sheets.
type Op int

const (
	// OpEqual marks a row or column present and identical in both sheets.
	OpEqual Op = iota
	// OpInsert marks a row or column present only in the "after" sheet.
	OpInsert
	// OpDelete marks a row or column present only in the "before" sheet.
	OpDelete
	// OpMove marks a row whose cells are unchanged but whose position
	// differs between the two sheets. Reporting these separately from
	// insert/delete is the point of the tool: a sorted-differently export
	// should show zero added and zero removed rows.
	OpMove
	// OpModify marks a row matched across both sheets in which at least one
	// cell changed. The changed cells are flagged individually.
	OpModify
)

var opNames = map[Op]string{
	OpEqual:  "equal",
	OpInsert: "insert",
	OpDelete: "delete",
	OpMove:   "move",
	OpModify: "modify",
}

// String returns the op's lowercase name.
func (o Op) String() string {
	if name, ok := opNames[o]; ok {
		return name
	}
	return fmt.Sprintf("Op(%d)", int(o))
}

// opJSON holds each op's encoded form. A large sheet marshals one op per
// row, so the quoted bytes are built once here rather than allocated tens
// of thousands of times.
var opJSON = func() map[Op][]byte {
	encoded := make(map[Op][]byte, len(opNames))
	for op, name := range opNames {
		encoded[op] = []byte(`"` + name + `"`)
	}
	return encoded
}()

// MarshalJSON encodes the op as its name. The frontend reads these values
// to pick a highlight style, and a name survives reordering the constants
// in a way that a bare integer would not.
func (o Op) MarshalJSON() ([]byte, error) {
	encoded, ok := opJSON[o]
	if !ok {
		return nil, fmt.Errorf("diff: cannot marshal unknown op %d", int(o))
	}
	return encoded, nil
}
