package diff

import (
	"encoding/json"
	"testing"
)

// Every op the pipeline can emit must have a name. An op with no entry
// marshals as an error, which the WASM bridge reports as "the engine hit
// an unexpected error" — so a constant added without a name would take the
// whole comparison down rather than mislabel one row.
func TestOpNamesCoverEveryOp(t *testing.T) {
	want := map[Op]string{
		OpEqual:  "equal",
		OpInsert: "insert",
		OpDelete: "delete",
		OpMove:   "move",
		OpModify: "modify",
	}
	for op, name := range want {
		if got := op.String(); got != name {
			t.Errorf("Op(%d).String() = %q, want %q", int(op), got, name)
		}
		data, err := json.Marshal(op)
		if err != nil {
			t.Errorf("Marshal(%v): %v", op, err)
			continue
		}
		if string(data) != `"`+name+`"` {
			t.Errorf("Marshal(%v) = %s, want %q", op, data, name)
		}
	}
}

func TestOpStringNamesAnUnknownOpInsteadOfPanicking(t *testing.T) {
	if got := Op(99).String(); got != "Op(99)" {
		t.Errorf("Op(99).String() = %q, want %q", got, "Op(99)")
	}
	if _, err := json.Marshal(Op(99)); err == nil {
		t.Error("marshalling an unknown op succeeded, want an error")
	}
}
