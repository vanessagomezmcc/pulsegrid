# PulseGrid developer entrypoints. `make help` lists everything.
SHELL := /bin/bash
GO ?= go

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

setup: ## Install JS deps and download Go modules
	pnpm install
	$(GO) mod download

docker-up: ## Build and start the full stack (dashboard on :3000)
	docker compose up --build -d
	@echo "Web http://localhost:3000 · API docs http://localhost:4000/docs · Grafana http://localhost:3001"

docker-down: ## Stop the stack (keep volumes)
	docker compose down

reset: ## Stop the stack and delete all data volumes
	docker compose down -v

dev: ## Run api+web in watch mode (infra must already be up: make docker-up)
	pnpm dev

build: ## Build all JS apps and Go binaries
	pnpm build
	$(GO) build ./...

migrate: ## Apply migrations to $$DATABASE_URL
	for f in packages/database/migrations/*.sql; do psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -f $$f; done

seed: ## Apply seed data to $$DATABASE_URL
	psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database/seed/seed.sql

lint: ## Lint TS and vet Go
	pnpm lint
	$(GO) vet ./...
	@test -z "$$(gofmt -l go services)" || (gofmt -l go services && exit 1)

format: ## Format everything
	pnpm format
	gofmt -w go services

test-unit: ## Go + vitest unit tests (no infrastructure needed)
	$(GO) test ./go/...
	pnpm --filter @pulsegrid/event-schemas test

test-integration: ## Pipeline integration tests (stack must be up)
	PULSEGRID_INTEGRATION=1 $(GO) test ./tests/integration/... -count=1 -v

test-e2e: ## Playwright end-to-end tests (stack must be up)
	cd tests/e2e && pnpm install --no-frozen-lockfile && pnpm exec playwright install --with-deps chromium && pnpm test

test-load: ## k6 baseline load test against the API
	k6 run tests/load/api-baseline.js

test: test-unit ## Default test target
.PHONY: help setup docker-up docker-down reset dev build migrate seed lint format test-unit test-integration test-e2e test-load test
