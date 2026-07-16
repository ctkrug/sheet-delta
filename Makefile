.PHONY: dev build test test-wasm test-browser lint clean

dev:
	npm run dev

build:
	npm run build

test:
	go test ./...
	npm test

# Exercises the compiled engine over the real JS boundary; needs a build.
test-wasm: build
	npm run test:wasm

# Drives the app in a real Chromium; needs a build and the browser.
test-browser: build
	npx playwright install chromium
	npm run test:browser

lint:
	gofmt -l .
	go vet ./...
	npm run lint

clean:
	rm -rf dist public/main.wasm public/wasm_exec.js
