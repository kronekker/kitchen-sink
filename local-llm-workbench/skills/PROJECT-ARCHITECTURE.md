# Project Architecture & Monorepo Structure

This project uses a monorepo setup to minimize friction when making full-stack changes. 

## Directory Overview

- `/frontend`: The Angular Single Page Application (SPA).
- `/backend`: The Express server running on Node.js.
- `/shared`: Shared TypeScript definitions (types, interfaces, constants) used by both frontend and backend.
- `/cli`: An isolated Node.js/CLI tool used to bootstrap the project. You rarely need to touch this during standard application development.

## Typescript Path Mapping

The magic of the monorepo relies on TypeScript path mapping rather than complex npm workspaces.
Both the `frontend/tsconfig.json` and `backend/tsconfig.json` contain a `paths` configuration mapping `@shared/*` to the `/shared/*` directory. This allows instant intellisense and cross-stack refactoring without build steps.

## Running the Application

Always use the provided orchestration script in the root directory to run the application:
- `./serve.sh` shows a menu (1. Build, 2. Run in develop mode, 3. Run in production mode)
- `./serve.sh build`, `./serve.sh dev`, `./serve.sh prod` run a specific option directly (on Windows use Git Bash or WSL)

Develop mode automatically starts both the frontend Angular dev server and the backend Node server in parallel, ensuring proper proxying.

## Philosophy
- **Speed & Vibe**: The goal is to build quickly. Avoid over-engineering. If a feature can be accomplished with a simple Express route, a shared type, and an Angular Standalone Component using Vanilla CSS, prefer that over adding new libraries or complex architectures.
