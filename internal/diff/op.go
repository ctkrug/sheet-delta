package diff

import (
	"encoding/json"
	"fmt"
)

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

// MarshalJSON encodes the op as its name. The frontend reads these values
// to pick a highlight style, and a name survives reordering the constants
// in a way that a bare integer would not.
func (o Op) MarshalJSON() ([]byte, error) {
	name, ok := opNames[o]
	if !ok {
		return nil, fmt.Errorf("diff: cannot marshal unknown op %d", int(o))
	}
	return json.Marshal(name)
}

// UnmarshalJSON decodes an op name, keeping the JSON encoding round-trippable.
func (o *Op) UnmarshalJSON(data []byte) error {
	var name string
	if err := json.Unmarshal(data, &name); err != nil {
		return err
	}
	for op, n := range opNames {
		if n == name {
			*o = op
			return nil
		}
	}
	return fmt.Errorf("diff: unknown op %q", name)
}
