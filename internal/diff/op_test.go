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

func TestOpRoundTripsThroughJSON(t *testing.T) {
	for _, op := range []Op{OpEqual, OpInsert, OpDelete, OpMove, OpModify} {
		data, err := json.Marshal(op)
		if err != nil {
			t.Fatalf("Marshal(%v): %v", op, err)
		}
		var got Op
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("Unmarshal(%s): %v", data, err)
		}
		if got != op {
			t.Errorf("round-trip of %v gave %v", op, got)
		}
	}
}

// An unknown op must fail loudly rather than decode to OpEqual, which is
// the one wrong answer that would read as "nothing changed here".
func TestOpRejectsUnknownNames(t *testing.T) {
	for _, data := range []string{`"rewritten"`, `""`, `"Equal"`, `5`, `null`, `{}`} {
		var op Op = OpModify
		if err := json.Unmarshal([]byte(data), &op); err == nil {
			t.Errorf("Unmarshal(%s) succeeded, want an error", data)
		}
		if op != OpModify {
			t.Errorf("Unmarshal(%s) overwrote the op with %v on failure", data, op)
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
