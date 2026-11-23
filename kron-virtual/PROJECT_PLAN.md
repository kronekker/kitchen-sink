# Kron Virtual — Architecture & Implementation Plan

> **Purpose**: Blueprint for **Kron Virtual** (`kron-virtual/`), a local-first AI roleplaying (RP) application inspired by SillyTavern, Kindroid, and Character.ai. This document defines the Phase 1 core fundamentals (Characters, Personas, Sessions, auto-detected local LLM routing, and streaming RP chat mechanics) grounded in [`technical-guide.md`](./technical-guide.md) and reusing the proven SSE streaming patterns from [`local-llm-workbench`](../local-llm-workbench/).

---

## 1. Vision & Phased Roadmap

Kron Virtual is designed to deliver high-quality, long-horizon text roleplay against locally hosted open-weight LLMs (Qwen, DeepSeek, Llama, Mistral, etc.) by treating **prompt structure, KV-cache preservation, and prose-drift prevention** as first-class engineering concerns.

### Phase 1 — Core Fundamentals & RP Mechanics *(Current Focus)*
Build the backend persistence layer, automatic local engine detection, and streaming RP chat loop so we can immediately test and tune real roleplay sessions:
1. **Characters Store (SQLite)**: Create, edit, list, and delete RP characters structured for XML-delimited static prompts.
2. **Personas Store (SQLite)**: Create, edit, list, and delete user personas (who the user roleplays as), with a default persona option.
3. **Sessions Store (SQLite)**: Create and persist RP sessions pairing a **Character** + **Persona**, with session-level RP directives, Depth-1 scene notes, cadence reminders, and sampler parameters.
4. **Runtime Local Engine Auto-Detection (`8080` / `8081`)**: Automatically detect whether `http://127.0.0.1:8080` (`kron-llama-server`) or `http://127.0.0.1:8081` (`ai-toolbox-cockpit`) is running at runtime and route all inference traffic to the active engine.
5. **RP Streaming Chat Interface**: Built on the streaming chat architecture from `local-llm-workbench`, extended with RP-specific turn controls (opening greeting, message editing to prune tics, rewind/delete, regenerate, and a live Prompt Inspector).

### Future Phases *(Deferred Until Phase 1 Mechanics Are Nailed Down)*
- **Phase 2 — Context Window & Episodic Memory**: High-water / low-water chunked sliding-window eviction + out-of-band asynchronous `<episode_log>` telemetry summarizer (append-only, KV-cache friendly per `technical-guide.md`).
- **Phase 3 — Lorebooks & Vector Recall**: Keyword-triggered lorebook entries and semantic memory retrieval injected at configurable positional depth (Depth 1–2 for active constraints vs. Depth 4–6 for background flavor).
- **Phase 4 — Media & Immersive Layout**: Character/persona avatars, local image generation hooks, and richer RP stage layouts.

---

## 2. Runtime Local Engine Routing (`8080` vs `8081`)

On this workstation, only one local OpenAI-compatible inference engine runs at a time:
- **`http://127.0.0.1:8080`** — `kron-llama-server.service` (`llama-server`)
- **`http://127.0.0.1:8081`** — `ai-toolbox-cockpit` (containerized vLLM / SGLang / llama.cpp)

### Detection & Routing Behavior (`backend/src/services/inference-router.ts`)
- Probes `8080` and `8081` in parallel with a short timeout (~1.5s) via `GET /v1/models` (falling back to `/health` if needed to detect a loading state).
- Resolves the currently online engine (`baseUrl`, `port`, `label`, `activeModel`, `models[]`, `latencyMs`) and routes all chat inference requests to it automatically — no manual endpoint switching required.
- Caches the probe briefly (e.g., 5s) for status checks, and always re-resolves on-demand if a cached target fails to connect (so switching between `8080` and `8081` mid-session works seamlessly without restarting Kron Virtual).
- Exposes `GET /api/engine/status` so the frontend header displays a live status pill (e.g., `Online · :8080 · Dark-Scarlett-26B` or `Offline · No local engine detected on 8080/8081`).

---

## 3. RP Prompt Assembly & Context Mechanics

Implementing the guidelines in [`technical-guide.md`](./technical-guide.md) from day one ensures Phase 1 sessions already benefit from prefix KV-caching and clean model-agnostic formatting.

### 3.1 Single Static-Prefix System Message (Index `0`)
All immutable session context is packed into **one** leading `system` message using XML semantic tags (never raw JSON/YAML, and never multiple mid-thread `system` messages which break strict Jinja chat templates):

```text
<directives>
Write in first-person limited, present tense. Stay strictly in character as {{character.name}}.
Avoid summarizing {{persona.name}}'s actions or speaking for them.
</directives>

<character name="{{character.name}}">
{{character.description}}
{{character.personality}}
{{character.speechPatterns}}
</character>

<user_persona name="{{persona.name}}">
{{persona.description}}
{{persona.background}}
</user_persona>

<scenario>
{{session.scenario || character.scenario}}
</scenario>

<example_dialogue>
{{character.exampleDialogue}}
</example_dialogue>
```

Empty optional sections (e.g., if `scenario` or `exampleDialogue` is blank) are omitted cleanly. Because this index-0 block never mutates turn-to-turn, `llama.cpp` / vLLM prefix KV-caching stays hot across turns.

### 3.2 Dynamic Depth-1 Injection (Inline in Latest User Turn)
Per `technical-guide.md` §2–§3, dynamic per-turn steering (`sceneNote` / Author's Note and `cadenceReminder`) is **never** sent as a second `system` message. Instead, when non-empty, the prompt assembler prepends it inline to the latest `user` message sent to the LLM (while storing only the user's raw RP text in SQLite so the transcript stays clean):

```text
<scene_note>
{{session.sceneNote}}
</scene_note>

<cadence_reminder>
{{session.cadenceReminder}}
</cadence_reminder>

{{rawUserMessage}}
```

### 3.3 Repetition-Aware RP Sampling Parameters
`InferenceParams` supports standard OpenAI fields plus local `llama.cpp`-compatible RP samplers recommended in `technical-guide.md`:
- `temperature` (default `0.85`)
- `top_p` (default `0.95`)
- `min_p` (default `0.05`)
- `max_tokens` (optional; omit to use server default)
- `dry_multiplier` (optional, e.g., `0.8` when enabled for DRY anti-repetition sampling)
- `dry_base` (optional, e.g., `1.75`)
- `dry_allowed_length` (optional, e.g., `2`)

Optional fields are only included in the upstream JSON body when explicitly set, preventing unknown-field errors on stricter OpenAI-compatible servers.

### 3.4 Prose-Drift & Turn Controls in Phase 1
To support testing RP mechanics directly in the chat UI:
- **Opening Greeting**: Creating a session seeds the Character's `firstMessage` (with `{{user}}` / `{{char}}` placeholder substitution) as the first persisted `assistant` message if defined.
- **Edit Any Message**: Inline edit on both user and assistant messages so repetitive phrasing/tics can be pruned immediately (Defense #4 in `technical-guide.md`).
- **Regenerate Last Reply**: Deletes/replaces the last assistant turn and re-streams a fresh response from the same context.
- **Delete / Rewind**: Delete a message (or rewind conversation to a specific turn) to test alternate branches.
- **Prompt Inspector**: Collapsible drawer calling `GET /api/sessions/:id/prompt-preview` to inspect the exact `messages[]` array and approximate token count being sent to the local LLM.

---

## 4. Data Model (Drizzle ORM + SQLite)

All tables live in `kron-virtual/backend/src/db/schema.ts` and persist to local `dev.db`.

### 4.1 `characters`
| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `integer` PK autoincrement | |
| `name` | `text` NOT NULL | Character display name (e.g., `"Vex"`) |
| `tagline` | `text` NOT NULL default `''` | Short 1-line summary for list cards |
| `description` | `text` NOT NULL default `''` | Background, appearance, history |
| `personality` | `text` NOT NULL default `''` | Traits, flaws, motivations |
| `speechPatterns` | `text` NOT NULL default `''` | Voice, cadence, vocabulary quirks |
| `scenario` | `text` NOT NULL default `''` | Default starting scenario / setting |
| `firstMessage` | `text` NOT NULL default `''` | Opening greeting seeded into new sessions (`{{user}}`, `{{char}}` supported) |
| `exampleDialogue` | `text` NOT NULL default `''` | 2–3 short few-shot dialogue exchanges to anchor voice |
| `createdAt` | `text` NOT NULL | ISO timestamp |
| `updatedAt` | `text` NOT NULL | ISO timestamp |

### 4.2 `personas`
| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `integer` PK autoincrement | |
| `name` | `text` NOT NULL | Persona display name (e.g., `"Kael"`) |
| `description` | `text` NOT NULL default `''` | Appearance, demeanor, traits |
| `background` | `text` NOT NULL default `''` | Key facts, relationship context |
| `isDefault` | `integer` (boolean) NOT NULL default `0` | Pre-selected when starting a new session |
| `createdAt` | `text` NOT NULL | ISO timestamp |
| `updatedAt` | `text` NOT NULL | ISO timestamp |

### 4.3 `rp_sessions`
| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `integer` PK autoincrement | |
| `title` | `text` NOT NULL | Defaults to `"{Character} & {Persona}"` (editable) |
| `characterId` | `integer` NOT NULL FK → `characters.id` (restrict/cascade) | Active RP character |
| `personaId` | `integer` NOT NULL FK → `personas.id` (restrict/cascade) | Active user persona |
| `directives` | `text` NOT NULL | Global RP rules placed in `<directives>` (seeded with sensible default) |
| `scenarioOverride` | `text` NOT NULL default `''` | Optional per-session scenario override |
| `sceneNote` | `text` NOT NULL default `''` | Dynamic `<scene_note>` injected at Depth 1 |
| `cadenceReminder` | `text` NOT NULL default `''` | Short positive style anchor injected at Depth 1 |
| `paramsJson` | `text` NOT NULL default `'{}'` | Serialized `InferenceParams` |
| `createdAt` | `text` NOT NULL | ISO timestamp |
| `updatedAt` | `text` NOT NULL | ISO timestamp |

### 4.4 `rp_messages`
| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `integer` PK autoincrement | |
| `sessionId` | `integer` NOT NULL FK → `rp_sessions.id` ON DELETE CASCADE | |
| `role` | `text` NOT NULL | `'user' \| 'assistant'` |
| `content` | `text` NOT NULL | Raw RP message text (no injected tags) |
| `reasoningContent` | `text` nullable | Captured `delta.reasoning_content` or `<think>...</think>` trace |
| `modelId` | `text` nullable | Model ID reported by active local engine |
| `engineLabel` | `text` nullable | e.g., `llama-server (8080)` or `ai-toolbox-cockpit (8081)` |
| `metricsJson` | `text` nullable | Serialized `ChatMetrics` (TTFT, TPS, prompt/completion tokens, duration) |
| `createdAt` | `text` NOT NULL | ISO timestamp |
| `updatedAt` | `text` NOT NULL | ISO timestamp |

> **Starter Seed Data**: On first launch (when tables are empty), seed 1 example Character (e.g., *Vex* from `technical-guide.md`) and 1 default Persona (e.g., *Kael*) so you can immediately launch a test session without filling out forms first.

---

## 5. Shared Types & Backend API Surface

### 5.1 Shared Contracts (`kron-virtual/shared/types/`)
- `engine.ts`: `ActiveEngineStatus`, `EngineModelInfo`
- `characters.ts`: `Character`, `CreateCharacterRequest`, `UpdateCharacterRequest`
- `personas.ts`: `Persona`, `CreatePersonaRequest`, `UpdatePersonaRequest`
- `sessions.ts`: `InferenceParams`, `ChatMetrics`, `RpSession`, `RpSessionSummary`, `CreateSessionRequest`, `UpdateSessionRequest`, `RpMessage`, `UpdateMessageRequest`, `PromptPreview`, `ChatStreamRequest`, `ChatStreamEvent`

### 5.2 Backend Routes (`kron-virtual/backend/src/routes/`, mounted under `/api`)
- **Engine Status**
  - `GET /api/engine/status` — returns active engine (`8080` or `8081`), status (`online | loading | offline`), active model, and probe latency.
- **Characters**
  - `GET /api/characters` — list all characters
  - `GET /api/characters/:id` — get single character
  - `POST /api/characters` — create character
  - `PUT /api/characters/:id` — update character
  - `DELETE /api/characters/:id` — delete character
- **Personas**
  - `GET /api/personas` — list all personas
  - `GET /api/personas/:id` — get single persona
  - `POST /api/personas` — create persona
  - `PUT /api/personas/:id` — update persona (handles single `isDefault` toggle)
  - `DELETE /api/personas/:id` — delete persona
- **Sessions**
  - `GET /api/sessions` — list sessions with joined character/persona names and message counts
  - `POST /api/sessions` — create session (`characterId`, `personaId`, optional `title`, `directives`, `scenarioOverride`, `sceneNote`, `cadenceReminder`, `params`); seeds `firstMessage` if present
  - `GET /api/sessions/:id` — returns `{ session, character, persona, messages }`
  - `PATCH /api/sessions/:id` — update title, directives, sceneNote, cadenceReminder, scenarioOverride, or inference params
  - `DELETE /api/sessions/:id` — delete session and cascade messages
  - `DELETE /api/sessions/:id/messages` — reset session transcript (optionally re-seeding `firstMessage`)
  - `GET /api/sessions/:id/prompt-preview` — returns the assembled OpenAI `messages[]` array and estimated token count for inspection
- **Messages**
  - `PATCH /api/messages/:id` — edit message content (for pruning repetitive tics / tweaking prose)
  - `DELETE /api/messages/:id` — delete message (`?truncateAfter=true` to rewind from that turn)
- **Streaming RP Chat (`POST /api/chat/stream`)**
  - Mirrors `local-llm-workbench`'s SSE event protocol (`start`, `delta` with `content`/`reasoning`, `metrics`, `done`, `error`).
  - Accepts `{ sessionId, userMessage?, regenerate?: boolean, sceneNote?, cadenceReminder?, params? }`.
  - Auto-resolves active local engine (`8080` or `8081`), assembles the XML-structured prompt via `prompt-assembler.ts`, streams tokens over SSE with `AbortController` cleanup, tracks TTFT/TPS, and persists the assistant message (or partial content on abort).

---

## 6. Frontend Architecture (Angular Standalone + Signals + `.vb-*`)

Strictly follows `skills/UI-STYLING.md` (Vanilla CSS + `.vb-*` tokens, **NO Tailwind**), `skills/NEW-UI-COMPONENTS.md` (Standalone Components + Signals), and `skills/BACKEND-API-GUIDELINES.md` (all HTTP/SSE calls centralized in `BackendService`).

### 6.1 Core Services & Pipes (`frontend/src/app/core/`)
- `services/backend.service.ts` — centralized REST methods for engine, characters, personas, sessions, messages + `streamChat()` (`fetch` + `ReadableStream` SSE parser modeled directly on `local-llm-workbench`).
- `services/engine-status.service.ts` — lightweight signal store polling `/api/engine/status` (with manual Refresh button) so the app shell and chat view always know which local engine/model is live.
- `pipes/markdown.pipe.ts` — lightweight markdown formatter (italics for `*action beats*`, bold, paragraphs, code) ported cleanly from `local-llm-workbench`.

### 6.2 Routes & Views (`frontend/src/app/features/`)
- **`/sessions` (Default Route)** — `features/sessions/`
  - **Left Sidebar**: Session list (showing Character × Persona + timestamp), **"New Session"** button (opens inline/modal selector to pick Character + Persona + optional title), delete session action.
  - **Top Bar**: Active Character × Persona badge, live Engine status pill (`:8080` / `:8081` + active model), live TPS / TTFT metrics readout, toggles for **Scene & Samplers Drawer** and **Prompt Inspector**.
  - **Collapsible RP Controls Drawer**:
    - Depth-1 **Scene Note** (`<scene_note>`) and **Cadence Reminder** (`<cadence_reminder>`) textareas (auto-saved or Save button).
    - **Directives** (`<directives>`) and **Scenario Override** editors.
    - **Sampler Controls**: `temperature`, `top_p`, `min_p`, `max_tokens`, and optional DRY toggle/multiplier.
  - **RP Transcript**:
    - Displays Character name on assistant turns and Persona name on user turns.
    - Collapsible **Thinking / Reasoning** block when the model emits `reasoning_content` or `<think>...</think>`.
    - Per-message hover/footer actions: **Edit**, **Regenerate** (on last assistant message), **Rewind/Delete**, and compact metrics footer (`TPS`, `TTFT`, tokens, engine).
    - rAF-batched streaming updates + **Stop Generation** button (`AbortController`), identical in smoothness to `local-llm-workbench`.
- **`/characters`** — `features/characters/`
  - List/card view of saved characters + create/edit form covering all XML prompt fields (`name`, `tagline`, `description`, `personality`, `speechPatterns`, `scenario`, `firstMessage`, `exampleDialogue`).
- **`/personas`** — `features/personas/`
  - List/card view of saved user personas + create/edit form (`name`, `description`, `background`, `isDefault`).

---

## 7. Implementation Checklist (Phase 1)

1. **Shared Contracts (`shared/types/`)**: Define `engine.ts`, `characters.ts`, `personas.ts`, `sessions.ts` and export via `shared/index.ts`.
2. **Database Schema & Seeding (`backend/src/db/`)**: Define Drizzle SQLite tables (`characters`, `personas`, `rp_sessions`, `rp_messages`), generate/apply SQLite migrations, and seed starter Character + Persona if empty.
3. **Backend Services (`backend/src/services/`)**: Implement `inference-router.ts` (`8080`/`8081` auto-detection) and `prompt-assembler.ts` (static XML prefix + Depth-1 injection).
4. **Backend Routes (`backend/src/routes/`)**: Implement `engine.ts`, `characters.ts`, `personas.ts`, `sessions.ts`, `messages.ts`, and `chat-stream.ts`, mounted in `api.ts`.
5. **Frontend Core (`frontend/src/app/core/`)**: Implement `BackendService`, `EngineStatusService`, and `MarkdownPipe`; update `app.html` sidebar navigation (`Sessions`, `Characters`, `Personas`) and header engine status pill.
6. **Frontend Features (`frontend/src/app/features/`)**: Build `characters`, `personas`, and `sessions` (RP streaming chat + Scene/Sampler drawer + Prompt Inspector).
7. **Verification**: Run `./serve.sh build`, verify CRUD persistence in SQLite, verify live `8080`/`8081` auto-detection, and test a full streaming RP session end-to-end.
