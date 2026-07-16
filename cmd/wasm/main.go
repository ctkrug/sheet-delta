//go:build js && wasm

// Command wasm compiles the diff engine to WebAssembly and exposes it to
// the browser as redline.diff. It is the only bridge between the Go
// diff engine and the TypeScript frontend, and it is deliberately the only
// place data crosses any boundary at all: there is no server, so a
// spreadsheet dropped into this tool never leaves the tab.
package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/ctkrug/sheet-delta/internal/diff"
)

// fail builds the error shape the frontend checks for. Errors are returned
// as a tagged value rather than thrown: a Go panic across the JS boundary
// unwinds the whole WASM instance, which would take the page down with it
// and force a reload to diff anything else.
func fail(msg string) any {
	out, _ := json.Marshal(map[string]any{"ok": false, "error": msg})
	return string(out)
}

// diffJS accepts two JSON-encoded diff.Sheet arguments (the "before" and
// "after" sheets) and returns a JSON-encoded {ok, result} or {ok, error}.
// JSON is used across the boundary because syscall/js has to copy values
// one at a time, and one copy of a whole sheet beats a copy per cell.
func diffJS(this js.Value, args []js.Value) (result any) {
	// The engine is pure and well-tested, but a panic here would kill the
	// WASM instance for the rest of the session. Report it as a normal
	// error state instead so the user can retry with another file.
	defer func() {
		if r := recover(); r != nil {
			result = fail("the diff engine hit an unexpected error")
		}
	}()

	if len(args) != 2 {
		return fail("diff requires exactly 2 arguments")
	}
	if args[0].Type() != js.TypeString || args[1].Type() != js.TypeString {
		return fail("diff requires two JSON strings")
	}

	var before, after diff.Sheet
	if err := json.Unmarshal([]byte(args[0].String()), &before); err != nil {
		return fail("invalid before-sheet JSON: " + err.Error())
	}
	if err := json.Unmarshal([]byte(args[1].String()), &after); err != nil {
		return fail("invalid after-sheet JSON: " + err.Error())
	}

	out, err := json.Marshal(map[string]any{"ok": true, "result": diff.Diff(before, after)})
	if err != nil {
		return fail("failed to encode diff result: " + err.Error())
	}
	return string(out)
}

func main() {
	redline := js.Global().Get("Object").New()
	redline.Set("diff", js.FuncOf(diffJS))
	js.Global().Set("redline", redline)

	// Block forever: returning from main tears down the instance, and the
	// exported function must stay callable for the life of the page.
	select {}
}
