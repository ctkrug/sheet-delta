.PHONY: dev build test lint clean

dev:
	npm run dev

build:
	npm run build

test:
	go test ./...
	npm test

lint:
	gofmt -l .
	go vet ./...
	npm run lint

clean:
	rm -rf dist public/main.wasm public/wasm_exec.js
