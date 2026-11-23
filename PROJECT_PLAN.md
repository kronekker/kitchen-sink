# Kronekker AI Kitchen Sink — Project Plan & Architecture

> **Purpose of this document**: Master blueprint for the `kronekker-ai-kitchen-sink` repository. It captures the repository structure, workstation environment, shared conventions, and the detailed design for the first application (`local-llm-workbench/`) so both the developer and future AI coding sessions can pick up seamlessly with zero architectural drift.

---

## 1. Repository Vision & Multi-App Structure

`kronekker-ai-kitchen-sink` is a collection of **independent, self-contained full-stack applications** stored as top-level subdirectories.

- **No root-level JS/TS workspace coupling**: Each subdirectory is an isolated full-stack project with its own `frontend/`, `backend/`, `shared/`, `skills/`, `serve.sh`, dependencies, and local SQLite database (`dev.db`).
- **Standardized Boilerplate**: Every new app is bootstrapped from a copy of the local boilerplate template:
  - Template path: `/home/danielbellard/apps/templates/vibe-monorepo-template`
- **Opinionated Stack (Inherited by All Apps)**:
  - **Frontend**: Angular SPA (Standalone Components, Signals, modern control flow, Vanilla CSS with `.vb-*` classes — **strictly NO Tailwind**).
  - **Backend**: Node.js + Express (TypeScript executed via `tsx`).
  - **Database**: Drizzle ORM + SQLite (`better-sqlite3`, local `dev.db`).
  - **Shared Types**: `@shared/*` TypeScript path mapping shared directly between `frontend/` and `backend/`.
  - **API Pattern**: All backend routes live under `/api` (starting in `backend/src/routes/api.ts`), and all frontend HTTP calls are centralized in `frontend/src/app/core/services/backend.service.ts`.

### Target Directory Layout

```text
kronekker-ai-kitchen-sink/
├── README.md                  # Quick overview & pointer to PROJECT_PLAN.md
├── PROJECT_PLAN.md            # This master plan & session handoff doc
└── local-llm-workbench/       # App #1: Local LLM server manager & streaming chat tester
    ├── AI-ASSISTANCE.md
    ├── skills/                # AI guardrails (UI-STYLING, BACKEND-API-GUIDELINES, etc.)
    ├── shared/                # Shared TypeScript contracts (@shared/*)
    ├── backend/               # Express + Drizzle/SQLite + local service/container bridges
    ├── frontend/              # Angular Standalone SPA
    └── serve.sh               # Build / Dev / Prod runner
```

---

## 2. App Registry & Port Allocation

Because multiple kitchen-sink apps and local LLM servers may run concurrently on the workstation, ports are explicitly reserved here. Update this table whenever a new app is added.

### Reserved Infrastructure Ports (External to this Repo)

| Port | Service / Tool | Notes |
| :--- | :--- | :--- |
| `8080` | `kron-llama-server.service` | User systemd service running `llama-server` inside `toolbox` (`llama-vulkan-radv`) |
| `8081` | `ai-toolbox-cockpit` | TUI-managed Docker/Podman containers running various tested LLM backends & models |

### Kitchen-Sink Applications

| Subdirectory | Purpose | Frontend Dev Port | Backend API / Prod Port | Status |
| :--- | :--- | :--- | :--- | :--- |
| `local-llm-workbench/` | Local LLM server manager, log/container inspector & streaming chat tester | `4201` | `3101` | v1 Complete |
| `kron-virtual/` | Kron Virtual — Local LLM virtual character & roleplay engine (see [`kron-virtual/PROJECT_PLAN.md`](./kron-virtual/PROJECT_PLAN.md)) | `4202` | `3102` | Phase 1 Complete |
| *(future app)* | — | `4203` | `3103` | — |

### Bootstrapping a New Sub-App

1. *(Planned utility — see Future Repo-Level Tasks below)* Run the root port-scanner script to check both currently listening localhost ports and registered kitchen-sink ports, and pick an unused Frontend/Backend pair.
2. Copy `/home/danielbellard/apps/templates/vibe-monorepo-template` into `<new-app-name>/` (excluding `.git`).
3. Run the template's setup wizard (`npm run bootstrap`) or manually configure the assigned Frontend/Backend ports from the table above.
4. Follow `<new-app-name>/skills/INITIAL-FLOW.md` to clean up starter/demo scaffolding.
5. Register the new app and its ports in the table above.

### Future Repo-Level Tasks

- [ ] **Root Port-Scanner Tool (`scripts/check-ports.sh` or similar)**: Create a lightweight CLI utility at the root of `kronekker-ai-kitchen-sink` that inspects live listening TCP ports on the workstation (e.g., via `ss -tlnp`) alongside the App Registry in `PROJECT_PLAN.md`, and suggests the next collision-free Frontend/Backend port pair for a new sub-app. Document usage in `README.md` and `PROJECT_PLAN.md` under *Bootstrapping a New Sub-App*.

---

## 3. Workstation & Local LLM Environment Context

This repository runs on an **AMD Strix Halo (128GB unified memory)** Linux workstation used for local LLM hosting and evaluation.

### A. Port `8080` — `kron-llama-server.service`

- **Systemd Unit**: `~/.config/systemd/user/kron-llama-server.service`
  - Managed via `systemctl --user {status|start|stop|restart} kron-llama-server.service`
  - Logs via `journalctl --user -u kron-llama-server.service`
- **Launch Script**: `/home/danielbellard/.local/bin/start-llama-cpp.sh`
  - Runs `exec /usr/bin/toolbox run --container llama-vulkan-radv llama-server ...` on `0.0.0.0:8080`.
  - Contains explicit configuration variables at the top of the file:
    ```bash
    # --- PYTHON INJECTION TARGETS ---
    MODEL_NAME="ReadyArt/Dark-Scarlett-v0.3-26B-A4B-GGUF"
    MODEL_QUANT="Q8_0"
    MODEL_CTX="262144"
    IS_MTP="unknown"     # "true", "false", or "unknown" (auto-detects "-MTP-" in name)
    # --------------------------------
    ```
  - Exposes OpenAI-compatible endpoints (`/v1/models`, `/v1/chat/completions`) and llama.cpp health/props endpoints (`/health`, `/props`).

### B. Port `8081` — `ai-toolbox-cockpit`

- Dedicated workstation TUI that pulls and launches pre-tested LLM server + model combinations inside containers on port `8081`.
- Many of the containerized backends (e.g., vLLM, SGLang, llama.cpp variants, etc.) expose an OpenAI-compatible HTTP API on `http://localhost:8081/v1/*` **without** providing a built-in web chat UI.
- Management of `ai-toolbox-cockpit` itself remains in its TUI; `local-llm-workbench` provides **read-only** health monitoring, container status/log inspection, and a clean chat/testing UI against port `8081`.

---

## 4. App #1 Plan: `local-llm-workbench/`

### 4.1 Goals & Non-Goals

**Goals (v1)**:
- Provide a clean, straightforward, fast web UI to **chat with and exercise** whichever local model is running on `8080`, `8081`, or any custom OpenAI-compatible endpoint.
- Measure and display real-time **tokens per second (TPS)**, **time to first token (TTFT)**, and token counts while streaming replies.
- Persist **chat conversations** and **system prompt presets** in SQLite.
- Manage **`kron-llama-server.service` (`8080`)**: start/stop/restart, stream live `journalctl` logs, edit `start-llama-cpp.sh` parameters (`MODEL_NAME`, `MODEL_QUANT`, `MODEL_CTX`, `IS_MTP`), and save/apply favorite model presets.
- Inspect **`ai-toolbox-cockpit` (`8081`)** read-only: endpoint health, active model detection via `/v1/models`, and container status/logs for whatever container is currently bound to port `8081`.

**Non-Goals (v1 — Defer to Future Iterations)**:
- Side-by-side A/B dual-model chat comparison.
- Launching or mutating `ai-toolbox-cockpit` containers directly.
- Multi-user authentication (single-user local workstation app; bind to `127.0.0.1` by default).

---

### 4.2 Feature Breakdown

#### 1. Endpoint Health & Discovery
- Pre-seeded default endpoints in SQLite:
  - `llama-server (8080)` → `http://127.0.0.1:8080`
  - `ai-toolbox-cockpit (8081)` → `http://127.0.0.1:8081`
- Users can also add/edit/remove custom OpenAI-compatible endpoints (name, base URL, optional API key).
- Health probe queries `/v1/models` (and `/health` when available) with a short timeout (e.g., 2.5s) to report:
  - Online / Loading / Offline status
  - Active model ID(s)
  - Probe latency (ms)

#### 2. Straightforward Streaming Chat Tester (`/chat` — Default View)
- **Top Control Bar**:
  - Endpoint selector (`8080`, `8081`, or custom) with live online/offline status dot.
  - Model selector auto-populated from the endpoint's `/v1/models` response (with manual text override if a server omits it).
  - Live telemetry badge showing current/last turn **TPS**, **TTFT**, and **output tokens**.
- **Conversation Sidebar**:
  - Create new chat, switch between saved SQLite conversations, rename, delete.
- **System Prompt & Inference Parameters (Collapsible Panel)**:
  - Simple system prompt textarea + dropdown to load/save **System Prompt Presets** (SQLite).
  - Inference parameter controls: `temperature`, `top_p`, `max_tokens` (with sensible defaults and an option to omit/use server defaults).
- **Streaming Chat Transcript**:
  - Streams responses via Server-Sent Events (SSE) proxied through Express (`POST /api/chat/stream`), preventing browser CORS issues with arbitrary local backends.
  - Supports **Stop Generation** (`AbortController` cancels both upstream fetch and SSE stream).
  - **Reasoning / Thinking Support**: Detects `delta.reasoning_content` (or `<think>...</think>` tags in streamed content) and renders thinking traces in a clean, collapsible block separate from the final answer.
  - **Per-Message Metrics Footer**: Displays `TPS` (tok/s), `TTFT` (ms), prompt/completion token counts, endpoint & model used, and total elapsed time.
    - *TPS Calculation*: Prefer exact `usage.completion_tokens` from the final SSE chunk (`stream_options: { include_usage: true }`) divided by generation duration (`lastTokenTime - firstTokenTime`). If a backend omits `usage`, fall back to streamed chunk/estimated token count and mark with `~` (estimated).

#### 3. `kron-llama-server.service` Manager (`8080`)
- **Service Controls**: `Start`, `Stop`, `Restart`, and live `ActiveState` / `SubState` / `MainPID` / uptime via `systemctl --user`.
- **Script Configuration Editor**:
  - Parses `MODEL_NAME`, `MODEL_QUANT`, `MODEL_CTX`, and `IS_MTP` from `/home/danielbellard/.local/bin/start-llama-cpp.sh`.
  - Allows editing these 4 fields with strict validation, writing them back safely (preserving all other script content and creating a `.bak` backup before overwriting), with an optional **"Save & Restart Service"** action.
- **Model Presets (SQLite)**:
  - Save current config as a named preset (e.g., `"Dark Scarlett 26B Q8"`, `"Qwen 27B Q4"`), edit/delete presets, and click **"Load"** or **"Load & Restart"** to apply to `start-llama-cpp.sh`.
- **Live Log Viewer**:
  - Streams `journalctl --user -u kron-llama-server.service -n 100 -f` over SSE with pause/resume, auto-scroll toggle, and clear view.

#### 4. `ai-toolbox-cockpit` Container Inspector (`8081`, Read-Only)
- Queries local container runtime (`podman` and/or `docker`, auto-detected) using read-only commands to find any running/recent container exposing or publishing port `8081` (or matching `ai-toolbox` naming conventions).
- Displays container name, image, status, uptime, and port mappings.
- Provides a read-only **Live Log Viewer** (`podman logs` / `docker logs --tail 100 -f`) over SSE.
- Gracefully degrades if no container runtime is accessible or no container is running on `8081` (still shows HTTP `/v1/models` probe status).

---

### 4.3 Technical Architecture (`local-llm-workbench/`)

#### Shared Types (`shared/types/`)
- `endpoints.ts`: `LlmEndpoint`, `EndpointHealthStatus`, `ModelInfo`
- `chat.ts`: `InferenceParams`, `ChatMetrics`, `ChatSession`, `ChatMessage`, `SystemPromptPreset`, `ChatStreamRequest`, `ChatStreamEvent`
- `servers.ts`: `SystemdStatus`, `LlamaScriptConfig`, `ModelPreset`, `ContainerInfo`

#### SQLite / Drizzle Schema (`backend/src/db/schema.ts`)
1. `endpoints` — `id`, `name`, `baseUrl`, `apiKey` (nullable), `isBuiltIn`, `sortOrder`, `createdAt`
2. `model_presets` — `id`, `name`, `modelName`, `modelQuant`, `modelCtx`, `isMtp`, `notes`, `createdAt`, `updatedAt`
3. `system_prompts` — `id`, `name`, `content`, `isDefault`, `createdAt`, `updatedAt`
4. `chat_sessions` — `id`, `title`, `endpointId`, `modelId`, `systemPrompt`, `paramsJson`, `createdAt`, `updatedAt`
5. `chat_messages` — `id`, `sessionId` (FK cascade), `role` (`user` | `assistant` | `system`), `content`, `reasoningContent` (nullable), `modelId`, `endpointName`, `metricsJson` (TTFT, TPS, tokens, duration), `createdAt`

#### Backend API Surface (`backend/src/routes/`)
Mounted under `/api` via `backend/src/routes/api.ts`:
- **Endpoints & Health**
  - `GET /api/endpoints` — list configured endpoints
  - `POST /api/endpoints`, `PUT /api/endpoints/:id`, `DELETE /api/endpoints/:id` — manage custom endpoints
  - `GET /api/endpoints/:id/status` — probe `/health` + `/v1/models` and return status, models, latency
  - `GET /api/endpoints/status-all` — parallel probe of all endpoints for the header status pills
- **Chat & Streaming**
  - `GET /api/chats`, `POST /api/chats`, `GET /api/chats/:id`, `PATCH /api/chats/:id`, `DELETE /api/chats/:id`
  - `POST /api/chat/stream` — proxies streaming `POST {baseUrl}/v1/chat/completions` to the client as SSE (`data: {...}\n\n`), tracks TTFT/TPS, and saves user + assistant messages to SQLite on completion (or partial save on abort)
- **System Prompt Presets**
  - `GET /api/prompts`, `POST /api/prompts`, `PUT /api/prompts/:id`, `DELETE /api/prompts/:id`
- **Llama Server (`8080`) Management**
  - `GET /api/systemd/llama/status` — `systemctl --user show kron-llama-server.service`
  - `POST /api/systemd/llama/:action` — `start | stop | restart`
  - `GET /api/systemd/llama/logs` — SSE stream of `journalctl --user -u kron-llama-server.service`
  - `GET /api/systemd/llama/config` — parse `start-llama-cpp.sh`
  - `PUT /api/systemd/llama/config` — validate & update `start-llama-cpp.sh` (optional `?restart=true`)
  - `GET /api/presets/models`, `POST /api/presets/models`, `PUT /api/presets/models/:id`, `DELETE /api/presets/models/:id`, `POST /api/presets/models/:id/apply`
- **Cockpit Container Inspector (`8081`, Read-Only)**
  - `GET /api/containers/port-8081` — list matching container(s) & metadata
  - `GET /api/containers/:runtime/:id/logs` — SSE stream of read-only container logs

#### Security & Reliability Guardrails
- **No Shell Injection**: Always invoke `systemctl`, `journalctl`, `podman`, and `docker` via Node's `execFile` / `spawn` with explicit argument arrays (`shell: false`). Never interpolate user input into shell strings.
- **Safe Script Editing**: When updating `/home/danielbellard/.local/bin/start-llama-cpp.sh`:
  - Validate `MODEL_NAME` (alphanumeric, `/`, `_`, `-`, `.`), `MODEL_QUANT` (alphanumeric, `_`, `-`, `.`), `MODEL_CTX` (positive integer), `IS_MTP` (`true | false | unknown`).
  - Only replace the 4 target variable assignment lines; write atomically via temp file + rename after creating a `.bak` copy.
- **Process Cleanup**: Kill spawned `journalctl` / `podman logs` / `docker logs` child processes immediately on `req.on('close')` so no zombie log-tailers accumulate.

#### Frontend Structure (`frontend/src/app/`)
- `core/services/backend.service.ts` — centralized REST + SSE client methods (following `skills/BACKEND-API-GUIDELINES.md`).
- `core/components/` — reusable standalone components (status pill, log terminal viewer, metrics badge).
- `features/chat/` — primary streaming chat tester UI (`/chat`).
- `features/servers/` — `kron-llama-server` manager + `ai-toolbox-cockpit` container inspector (`/servers`).
- Styling: Strictly Vanilla CSS using `.vb-*` design tokens and utility classes per `skills/UI-STYLING.md`.

---

### 4.4 Phased Implementation Roadmap (`local-llm-workbench/`)

- **Phase 0 — Bootstrap & Skeleton** *(Done)*
  - Copy `/home/danielbellard/apps/templates/vibe-monorepo-template` into `local-llm-workbench/`.
  - Configure ports (`4201` frontend / `3101` backend), clean up template demo pages per `skills/INITIAL-FLOW.md`, upgrade `better-sqlite3` to `^13.2.0` for Node 26, and verify build & backend startup.
- **Phase 1 — Shared Contracts, DB & Endpoint Probing** *(Done)*
  - Define `@shared/*` types, Drizzle SQLite tables, seed default `8080` and `8081` endpoints + default system prompts.
  - Implement `/api/endpoints/*` health/model probing and header status bar in Angular.
- **Phase 2 — Streaming Chat Tester** *(Done)*
  - Implement `/api/chats/*`, `/api/prompts/*`, and `/api/chat/stream` with SSE streaming, `AbortController`, TTFT/TPS calculation, and reasoning/thinking block handling.
  - Build `/chat` Angular feature with conversation sidebar, system prompt & inference parameter drawer, streaming transcript, and live TPS readout.
- **Phase 3 — `kron-llama-server.service` Manager (`8080`)** *(Done)*
  - Implement `systemctl --user` control routes, `journalctl` SSE log stream, `start-llama-cpp.sh` parser/writer, and SQLite model presets CRUD.
  - Build the `8080` management panel in `/servers`.
- **Phase 4 — `ai-toolbox-cockpit` Inspector (`8081`) & Verification** *(Done)*
  - Implement read-only `podman`/`docker` container detection & SSE log streaming for port `8081` (including full launch command inspection with Copy button and ANSI log stripping).
  - End-to-end verification against live `8080` / `8081` servers, plus `./serve.sh build` check.

---

## 5. Guide for Future AI Coding Sessions

When starting a new session in this repository:
1. **Read this file (`PROJECT_PLAN.md`) first** to understand the multi-app layout, port reservations, and workstation context.
2. **Scope work to the target app subdirectory** (e.g., `local-llm-workbench/`). Never mix dependencies or code across app directories.
3. **Read the app's `AI-ASSISTANCE.md` and `skills/` directory** before writing code:
   - Strictly follow `skills/UI-STYLING.md` (Vanilla CSS + `.vb-*` classes, **NO Tailwind**).
   - Strictly follow `skills/NEW-UI-COMPONENTS.md` (Angular Standalone Components + Signals).
   - Strictly follow `skills/BACKEND-API-GUIDELINES.md` (all routes under `/api`, all frontend HTTP calls in `BackendService`, shared types in `@shared/*`).
4. **Keep this plan updated**: When a phase completes, a new app is added, or port assignments change, update the status/tables in `PROJECT_PLAN.md`.
