# Kronekker AI Kitchen Sink

A multi-application workspace containing independent, self-contained full-stack applications built on `/home/danielbellard/apps/templates/vibe-monorepo-template` (Angular Standalone + Express + Drizzle/SQLite + `@shared/*` TypeScript contracts).

See **[PROJECT_PLAN.md](./PROJECT_PLAN.md)** for the full architecture, workstation environment context, port allocation table, and detailed implementation plan.

## Applications

| Directory | Description | Dev Frontend | Backend / Prod | Status |
| :--- | :--- | :--- | :--- | :--- |
| `local-llm-workbench/` | Local LLM server manager (`kron-llama-server` on `8080`, `ai-toolbox-cockpit` inspector on `8081`) & streaming chat tester with TPS metrics | `4201` | `3101` | v1 Complete |
| `kron-virtual/` | Kron Virtual — Local LLM virtual character & roleplay engine | `4202` | `3102` | Phase 1 Complete |
