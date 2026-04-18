#!/usr/bin/env bash
# ForgeRoom — Test runner (Docker Compose only)
# Runs the frontend Vitest suite through docker compose using the
# `frontend-tests` service.
# There is no backend — ForgeRoom is a pure frontend SPA, so only frontend
# unit tests are executed.
#
# Usage:
#   bash repo/run_tests.sh               # run unit/integration suite, then e2e
#   bash repo/run_tests.sh --coverage    # run unit/integration with V8 coverage, then e2e
#   bash repo/run_tests.sh --e2e         # run Playwright browser journey suite
#   bash repo/run_tests.sh --all         # alias for --coverage (coverage + e2e)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup_artifacts() {
  local frontend_dir="$SCRIPT_DIR/frontend"
  local node_modules_dir="$frontend_dir/node_modules"
  local coverage_dir="$frontend_dir/coverage"

  # Remove empty host-side node_modules placeholder if present.
  if [[ -d "$node_modules_dir" ]] && [[ -z "$(ls -A "$node_modules_dir" 2>/dev/null)" ]]; then
    rmdir "$node_modules_dir" || true
  fi

  # Remove stale coverage artifact folder when coverage reporter output is disabled.
  if [[ -d "$coverage_dir" ]]; then
    rm -rf "$coverage_dir"
  fi
}

trap cleanup_artifacts EXIT

MODE="test"
RUN_UNIT="true"
RUN_E2E="true"

for arg in "$@"; do
  case "$arg" in
    --coverage)
      MODE="test:coverage"
      ;;
    --e2e)
      RUN_UNIT="false"
      RUN_E2E="true"
      ;;
    --all)
      MODE="test:coverage"
      RUN_UNIT="true"
      RUN_E2E="true"
      ;;
    --help)
      echo "Usage: bash repo/run_tests.sh [--coverage|--e2e|--all]"
      echo "  (default runs unit/integration followed by e2e)"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: bash repo/run_tests.sh [--coverage|--e2e|--all]"
      exit 1
      ;;
  esac
done

echo "=== ForgeRoom Test Runner ==="

cd "$SCRIPT_DIR"

if [[ "$RUN_UNIT" == "true" ]]; then
  echo "Running frontend unit/integration tests in Docker Compose service (frontend-tests) [mode: $MODE]..."
  COMPOSE_IGNORE_ORPHANS=True TEST_MODE="$MODE" docker compose --profile test run --rm frontend-tests
fi

if [[ "$RUN_E2E" == "true" ]]; then
  echo "Running browser e2e tests in Docker Compose service (frontend-e2e)..."
  COMPOSE_IGNORE_ORPHANS=True docker compose --profile e2e run --rm frontend-e2e
fi

echo "=== Tests complete ==="
