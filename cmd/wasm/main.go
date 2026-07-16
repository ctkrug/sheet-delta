//go:build js && wasm

// Command wasm compiles the diff engine to WebAssembly and exposes it to
// the browser as a global JS function, sheetDelta.diffRows. It is the only
// bridge between the Go diff engine and the TypeScript frontend: no data
// leaves the browser, so the whole comparison happens in this process.
package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/ctkrug/sheet-delta/internal/diff"
)

// diffRowsJS accepts two JSON-encoded [][]string arguments (the "before"
// and "after" sheet rows) and returns a JSON-encoded []diff.RowDiff, or
// throws a JS error if either argument fails to parse.
func diffRowsJS(this js.Value, args []js.Value) any {
	if len(args) != 2 {
		return js.Global().Get("Error").New("diffRows requires exactly 2 arguments")
	}

	var a, b [][]string
	if err := json.Unmarshal([]byte(args[0].String()), &a); err != nil {
		return js.Global().Get("Error").New("invalid before-sheet JSON: " + err.Error())
	}
	if err := json.Unmarshal([]byte(args[1].String()), &b); err != nil {
		return js.Global().Get("Error").New("invalid after-sheet JSON: " + err.Error())
	}

	ops := diff.DiffRows(a, b)
	out, err := json.Marshal(ops)
	if err != nil {
		return js.Global().Get("Error").New("failed to encode diff result: " + err.Error())
	}
	return string(out)
}

func main() {
	done := make(chan struct{})

	sheetDelta := js.Global().Get("Object").New()
	sheetDelta.Set("diffRows", js.FuncOf(diffRowsJS))
	js.Global().Set("sheetDelta", sheetDelta)

	<-done // keep the WASM module alive to serve JS calls
}
