#!/usr/bin/env bash
set -euo pipefail

# Determine repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "=================================================="
echo " Running Clip Capture Full Verification Suite"
echo "=================================================="

# Ensure python path includes repo root and apps/agent
export PYTHONPATH="${REPO_ROOT}:${REPO_ROOT}/apps/agent:${PYTHONPATH:-}"

echo ""
echo "--> [1/4] Running Python Agent Test Suite (pytest apps/agent/tests)..."
pytest apps/agent/tests

echo ""
echo "--> [2/4] Running Next.js Web Test Suite (npm --prefix apps/web test)..."
npm --prefix apps/web test

echo ""
echo "--> [3/4] Running Next.js Production Build (npm --prefix apps/web run build)..."
npm --prefix apps/web run build

echo ""
echo "--> [4/4] Running End-to-End Orchestration Test (python3 scripts/test_e2e_flow.py)..."
python3 scripts/test_e2e_flow.py

echo ""
echo "=================================================="
echo " ALL TEST SUITES PASSED SUCCESSFULLY!"
echo "=================================================="
