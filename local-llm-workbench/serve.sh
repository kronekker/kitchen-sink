#!/bin/bash
# Vibe Monorepo orchestrator.
# Usage: ./serve.sh [build|dev|prod]   (or 1|2|3)
# With no argument, an interactive menu is shown.

# Dev Port Configurations (CLI will update these)
FE_PORT=4201
BE_PORT=3101

export NG_DISABLE_VERSION_CHECK=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1

ensure_deps() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing $dir dependencies first..."
    npm install --prefix "$dir" || return 1
  fi
}

do_build() {
  echo "--------------------------------------------------"
  echo "⚡ Building Frontend & Backend ⚡"
  echo "--------------------------------------------------"

  ensure_deps frontend || { echo "Frontend dependency install failed."; return 1; }
  ensure_deps backend || { echo "Backend dependency install failed."; return 1; }

  echo "Building Angular client production bundle..."
  if ! npm run build --prefix frontend; then
    echo "Angular production build failed."
    return 1
  fi
  echo "Angular build complete."

  echo "Type-checking Node backend..."
  if ! (cd backend && npx tsc --noEmit); then
    echo "Backend type-check failed."
    return 1
  fi
  echo "Build complete."
}

do_dev() {
  echo "--------------------------------------------------"
  echo "⚡ Starting Vibe Monorepo Dev Servers ⚡"
  echo "--------------------------------------------------"

  ensure_deps frontend || return 1
  ensure_deps backend || return 1

  # Trap Ctrl+C (SIGINT) and exit signals to kill children
  cleanup() {
    trap - INT TERM EXIT
    echo ""
    echo "Shutting down background processes..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "Development environment stopped."
    exit 0
  }
  trap cleanup INT TERM EXIT

  echo "[Backend] Starting on http://localhost:$BE_PORT..."
  (cd backend && PORT=$BE_PORT npx tsx watch src/index.ts) 2>&1 | sed 's/^/[Backend] /' &
  BACKEND_PID=$!

  echo "[Frontend] Starting on http://localhost:$FE_PORT..."
  (cd frontend && npx ng serve --port $FE_PORT --open) 2>&1 | sed 's/^/[Frontend] /' &
  FRONTEND_PID=$!

  echo "Both servers started in background. Press Ctrl+C to terminate."
  echo "=================================================="

  wait $BACKEND_PID $FRONTEND_PID
}

do_prod() {
  echo "--------------------------------------------------"
  echo "⚡ Building & Serving Production Bundle ⚡"
  echo "--------------------------------------------------"

  do_build || return 1

  # Express serves the Angular static dist automatically
  echo "Starting Node backend server..."
  cd backend && npx tsx src/index.ts
}

show_menu() {
  echo "=================================================="
  echo "  ⚡ Vibe Monorepo ⚡"
  echo "=================================================="
  echo "  1) Build"
  echo "  2) Run in develop mode"
  echo "  3) Run in production mode"
  echo "  q) Quit"
  echo "=================================================="
  read -r -p "Select an option [1-3]: " CHOICE
}

run_choice() {
  case "$1" in
    1|build|Build)  do_build ;;
    2|dev|develop)  do_dev ;;
    3|prod|production) do_prod ;;
    q|Q|quit|exit) exit 0 ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [build|dev|prod]"
      exit 1
      ;;
  esac
}

if [ -n "$1" ]; then
  run_choice "$1"
else
  show_menu
  run_choice "$CHOICE"
fi
