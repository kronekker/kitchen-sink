# Vibe Monorepo Template - Creation Process Log

This document serves as a historical record of the design decisions, architectural choices, and steps taken to build this full-stack monorepo template. It is designed to help future developers understand *why* the project is structured the way it is.

---

## Part 1: Design Decisions & Rationale

### 1. The Monorepo Choice
* **Decision**: Single repository containing `frontend`, `backend`, and `shared`.
* **Rationale**: For modern, fast-paced "vibe-coded" development, maintaining separate repositories adds unnecessary friction (multiple git origins, independent versioning, synchronizing type changes). A monorepo lets developers make atomic changes to frontend, backend, and types in a single commit.
* **Benefit** Having a single place to orchestrate all processes allows us to build tools like the CLI setup wizard which can be run before any other tools are installed. This also means AI agents can implement features across the stack using shared skills that enforce design decisions

### 2. Express on Node.js (Backend)
* **Decision**: Express is used as the API framework, run on Node.js with TypeScript executed through `tsx`.
* **Rationale**: Express has the largest codebase ecosystem, the most mature documentation, and the highest level of competence among AI code generators. Node.js is the most universally available runtime, so the backend needs no extra toolchain beyond what the frontend already requires.
* **Benefit** A single runtime (Node + npm) for the CLI, frontend, and backend keeps setup simple and avoids runtime-specific caveats.

### 3. Isolated TUI CLI Setup Wizard
* **Decision**: The CLI wizard resides in `cli/` with its own `package.json` and runs via Node.js + `tsx` (TypeScript Execute).
* **Rationale**: The CLI needs to run *before* the developer has installed the Angular CLI or other tools. By building it as an isolated project that runs on plain Node/NPM, the bootstrap process requires zero global pre-requisites other than Node. It can then verify and install other tools (like the Angular CLI) on behalf of the developer.
* **Benefit** Makes explicit the decisions that are intended to be made for personalization into the app or your own custom starter template repository.

### 4. Shared TS Contracts
* **Decision**: A simple folder `/shared` containing TypeScript files mapped in compiler settings via paths (`@shared/*`).
* **Rationale**: Many full-stack frameworks require publishing shared types to private registries or configuring complex package workspaces (npm/yarn/pnpm workspaces). Using simple compiler path mapping allows both IDE autocomplete and build engines to immediately pick up shared changes without running a build or publish step.
* **Benefit**: Allows AI coding agents to easily reference and use shared types in the frontend and backend code without needing to understand the complex build configurations of monorepos. This also means hallucinations across types during AI implementation can be caught at compile time instead of an obscure runtime error later down the line. This also prevents the AI from hallucinating type implementations in files where they don't exist.

### 5. Drizzle ORM + SQLite (Default)
* **Decision**: Drizzle ORM configured with a local SQLite database file (`dev.db`) by default.
* **Rationale**: We wanted a database experience that works immediately after cloning without requiring Docker or a running Postgres instance. Drizzle ORM is lightweight and provides an identical query syntax for SQLite and Postgres, making it trivial for developers to shift to PostgreSQL when ready (documented in `DATABASE_SETUP.md`).
* **Benefit** Drizzle ORM's syntax is almost identical to TypeORM, a very popular ORM that is widely used in Angular projects. This makes it easy for developers to switch to Drizzle ORM if they are familiar with TypeORM. It's also straightforward to convert to different databasae backends like postgres,mysql, or cloudflare db, including cloud hosted versions of these when the time comes.

---

## Part 2: Step-by-Step Build Log

### Step 1: Initializing Workspace (2026-06-03)
* Created project layout and basic bootstrap documentation (`GETTING_STARTED.md`, `DATABASE_SETUP.md`, `CREATION_PROCESS.md`).
* Set up a unified root-level `.gitignore` file to clean workspace repository indexing.

### Step 2: Implementing Modules and Dev Scripts (2026-06-03)
* **CLI Customizer Tool**: Built a self-contained Node project in `/cli` using `@clack/prompts` and `tsx` (TypeScript Execute) to bootstrap configurations and audit tools. Added automated options to run backend/frontend dependency installation and Drizzle schema migrations (`db:push`) at the end of the wizard to ensure the database tables are fully ready out-of-the-box.
* **Shared TypeScript library**: Implemented data models and API response templates inside `/shared` mapped across projects.
* **Backend Express Server**: Implemented Drizzle ORM mappings, dynamic SQLite/Postgres selection, and production static hosting configurations inside `/backend`.
* **Drizzle Migrations Configuration**: Added `backend/drizzle.config.ts` to map schemas and generate SQL migration scripts. SQLite schema migrations also run programmatically at startup using `drizzle-orm/better-sqlite3/migrator` inside `backend/src/index.ts`, so tables are created automatically from the pre-compiled SQL in `backend/drizzle/`.
* **Frontend Angular SPA**: Generated a standalone Angular client, configured TS path-mappings, resolved TS `baseUrl` deprecations using `ignoreDeprecations: "6.0"`, and established development proxy forwarding configurations.
* **Orchestration**: Created dev and production scripts to simplify launching dev environments and production previews (since consolidated into a single `serve.sh`, see Step 7).
* **Orchestration Bugfix**: Resolved an issue where running scripts from the root directory caused the Angular CLI to fail (due to running outside of the workspace directory containing `angular.json`) and the SQLite database (`dev.db`) to generate in the monorepo root instead of the backend folder. Addressed by wrapping executions inside subshells/jobs that explicitly change directory (`cd`) to `frontend/` or `backend/` before launching.
* **CLI Command Execution Bugfix**: Fixed an issue where the setup CLI failed to install dependencies automatically on Windows due to a string quoting typo (`'cmd.exe /c "${pm}"'` used single quotes, preventing JS template literal interpolation). Resolved by shifting to Node's native `{ shell: true }` execution setting in `execSync`, which natively and safely resolves system executables (including `.cmd` files) cross-platform.
* **CLI Dependency Installer**: The customization CLI always builds the `node_modules` folders for *both* frontend and backend using **`npm install`**. It detects the database driver:
  - If **SQLite**: Skips manual database pushes; tables synchronize automatically on backend startup using pre-compiled SQL files in `backend/drizzle/`.
  - If **PostgreSQL**: Prompts the developer to run `npm run db:push:pg` (which uses pure JS drivers and is fully compile-free).

### Step 3: Platform Cross-Compatibility & Environment Tuning (2026-06-03)
* **Linux Permissions Bugfix**: Set execution permissions directly in the Git repository index (`chmod +x` file mode `100755`) for the orchestration scripts. This ensures Unix/Linux developers clone the scripts as executable by default.
* **Angular CLI Version Mismatch Bugfix**: Addressed an issue where Angular CLI refused to start compiling on Linux setups running Node.js minor versions slightly out of sync with Angular's engines (e.g., Node `v24.14.0` on Fedora). Injected `NG_DISABLE_VERSION_CHECK=1` into the run scripts to bypass these warnings safely.

### Step 4: Frontend Layout, Routing, and Theming Refactor (2026-06-04)
* **Routing Architecture**: Configured Angular's `RouterModule` to handle discrete views rather than a single monolith page. Split the default monolith into a `Starter` component (default route `/`) and a `Demo` component (`/demo`) for showcasing widgets and typography.
* **Collapsible Side Navigation Layout**: Rewrote the main `App` layout to employ a flexbox-based side navigation. Added state (`isSidebarOpen`) and logic to dynamically transition the sidebar width between an expanded state (250px) and a collapsed icon-only state (72px), enhancing available screen real estate.
* **Component Extraction**: Extracted the theme selector into a standalone `<app-theme-selector>` component, making it highly portable. When the side navigation is collapsed, the component is dynamically swapped for an intuitive gear icon.
* **Expanded Theme Capabilities**: Updated `theme.service.ts` and `styles.css` to support three new custom dynamic themes: OLED (true black), Solar (warm, low-contrast), and Cyberpunk (neon, high-contrast), complete with an updated dropdown selector in the UI.

### Step 5: Vibe UI Styling Standards, Python Integration & AI Skills Framework (2026-06-04)
* **Standardized UI Utility Elements**: Added a core set of custom CSS utility classes in `frontend/src/styles.css` including status alerts (`.vb-alert` with info, success, warning, and error modifiers), loading indicators (`.vb-spinner` with size selectors), and progress tracking components (`.vb-progress` and `.vb-progress-bar`). Integrated dedicated notification variables (`--color-info`, `--color-success`, `--color-warning`) in the CSS themes database.
* **Python Executing Engine**: Added backend capability to run local Python subprocesses securely. Configured an Express route `POST /api/python-test` using Node's `child_process.execFile` model to run `backend/src/scripts/test.py`. Established unified API response contracts (`PythonRunRequest` and `PythonRunResponse` in `shared/types/api.ts`) and integrated a live demo widget in the frontend `Starter` page to test execution state and capture standard outputs.
* **Branded Navigation Logo**: Imported application icon branding assets (`frontend/public/logo.png` and `frontend/public/favicon.ico`) and updated the header within `frontend/src/app/app.html` to establish complete custom design identity.
* **AI-First Skill Guides**: Introduced a modular context-injecting framework to guide AI coding assistants. Created the `skills/` directory with 7 specialized guides for project structure, standalone components, styling constraints, backend database schemas, and Python integration. Added a detailed walkthrough component (`SuggestedFlow`) detailing the developer setup sequence.
* **AI-ASSISTANCE Manual**: Created a project root guide `AI-ASSISTANCE.md` showing how developers can prompt popular tools (Cursor, Windsurf, Copilot, Cline, and web LLMs) using the `skills/` folder, utilizing the S-C-R-I-P-T prompting framework and comprehensive step-by-step feature addition examples.

### Step 6: Uniform Secrets Management & Robust Error Propagation (2026-06-05)
* **Secret Resolver Utility**: Introduced a centralized `Secrets` utility (`backend/src/secrets.ts`) supporting uniform, "run-anywhere" environment configuration. It enables reading configuration from standard environment variables (e.g., `PORT`, `DB_TYPE`) or via mounted files using a `_FILE` suffix (e.g., `PORT_FILE`, `DATABASE_URL_FILE`) to facilitate container/orchestrator secret mapping (Docker/Kubernetes).
* **Startup Config Refactoring**: Refactored `backend/src/index.ts` to utilize the `Secrets` helper to dynamically resolve server binding ports and database configuration types (`DB_TYPE` and `PORT`).
* **Secrets Management Guide**: Authored a developer skill guide (`skills/SECRETS-MANAGEMENT.md`) detailing the environment-agnostic secrets resolution flow and key architectural constraints (avoiding direct `process.env` references or `fs.readFileSync` invocations inside business handlers).
* **Frontend Error Parsing Bugfix**: Refactored error handling in frontend Angular features (specifically the `Starter` component) to properly parse structured JSON error messages returned by the API server (`err.error?.error || err.message`) rather than outputting generic error strings.


### Step 7: Node-Only Backend & Unified Orchestrator (2026-10-23)
* **Single Script**: Replaced the separate dev/prod PowerShell and Bash scripts with one `serve.sh` offering a menu (1. Build, 2. Run in develop mode, 3. Run in production mode). Passing `build`, `dev`, or `prod` as an argument skips the menu. On Windows, run it via Git Bash or WSL.
* **Node Runtime**: The backend runs on Node.js through `tsx` and uses `better-sqlite3` for SQLite. SQLite migrations run synchronously at startup.
