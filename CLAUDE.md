# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Karsa is a personal agentic AI companion for (Indonesian) students: a Python FastAPI + LangGraph backend and a React/Vite "Dynamic Island" notch UI meant to be wrapped in Tauri v2. The specs live in `docs/`. They are written in Indonesian, and user-facing strings and intent keywords are Indonesian too.

`docs/00_PROJECT_MEMORY.md` is a living document. The project's convention is to read it before changing code and to update it after each task: phase/status, decision log, and a new session-log row. The other docs are the specs: PRD (`01`), architecture (`02`), SQLite schemas (`03`), tools/MCP (`04`), and UI/companion engine (`05`).

## Commands

Development is on Windows. The Python env is `.venv/` (created with `uv venv`), Python >= 3.11.

```bash
# Install backend (dev + optional extras)
uv pip install -e ".[dev,providers,tools]"

# Run backend gateway (port 8765)
.venv/Scripts/python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8765

# Run all tests (pytest config lives in pyproject.toml: asyncio_mode=auto, testpaths=backend/tests); `backend/tests/conftest.py` gives every test its own throw-away `data_dir`, so tests never write to the real ~/.karsa database
.venv/Scripts/python.exe -m pytest -q

# Single file / single test
.venv/Scripts/python.exe -m pytest backend/tests/test_supervisor.py -q
.venv/Scripts/python.exe -m pytest backend/tests/test_finance.py::test_name -q

# Frontend (desktop-companion/)
npm run dev      # Vite on :5173, proxies /api -> 127.0.0.1:8765
npm run build    # tsc && vite build — the type-check gate; no separate linter is configured
```

`run_karsa.bat` / `run_karsa.ps1` start both the backend and the Vite dev server. The full test suite takes about 2 minutes, mostly in `test_api.py`.

Configuration comes from `.env` at the repo root through `pydantic-settings`, with the `KARSA_` prefix (see `.env.example` and `backend/core/config.py`). API keys can also be saved at runtime from the Settings UI into the SQLite `system_settings` table (e.g. `api_key.gemini`), and code falls back to that table via `get_system_setting`. Runtime data lives outside the repo, in `~/.karsa/` (`storage/karsa_master.db`, `storage/karsa_checkpoints.db`, `outputs/`, `uploads/`, `wardrobe/`).

## Backend architecture

Request flow: `api/main.py` → supervisor graph → specialist module sub-graph → HITL gate.

- **`backend/core/`**: shared singletons. `config.settings`, `llm_router.router`, `database` (SQLite in WAL mode, schema DDL plus versioned migrations, helpers like `get_db_cursor`, and a LangGraph `SqliteSaver` checkpointer), `state.py` (the `KarsaState` TypedDict and Pydantic contracts such as `RouteDecision`, `ProposedAction`, `ApprovalRequest`), `token_tracker` (a LangChain callback that logs token usage and IDR cost to `token_logs`), `hardware_detector` (picks `turbo_gpu` or `eco_cpu`), `council.run_council` (pipeline: Hermes local draft → DeepSeek critique → Gemini synthesis), and the Windows-only `os_bridge` / `app_launcher` (volume, brightness, lock keys, battery, GSMTC media, Start Menu app index).
- **`LLMRouter`**: always get models through `router.get_chat_model(tier=..., module_name=..., session_thread_id=...)`. Never instantiate a provider directly. Tiers are `tier1_utility`, `tier2_code` and `tier3_reasoning`. The provider and model for each tier can be swapped at runtime through the settings endpoints. Provider packages are optional extras, so they are imported lazily.
- **`backend/orchestrator/supervisor.py`**: a 2-node `StateGraph` (`supervisor_triage` → `subagent_dispatch`) compiled with the SQLite checkpointer. Triage runs in this order and stops at the first match:
  1. **Tier 0**: an `@Directive` (`@Money`, `@Todo`, `@Search`, `@Write`, `@Data`, `@Code`, `@Screen`, parsed in `directive_parser.py`). Some directives execute deterministically and return `execution_result` with no LLM call.
  2. **Tier A**: zero-token regex scoring over `BUILTIN_INTENT_PATTERNS` plus each manifest's `intent_patterns`. The module with the strictly highest count of non-overlapping `re.findall` hits wins; a tie falls through.
  3. **Tier B**: a structured-output LLM triage call (`RouteDecision`).
  4. If nothing matches, "general companion mode": canned replies for greetings and capability questions, otherwise the council.

  Dispatch builds the module's sub-graph in isolation and returns **only the last message** (context isolation; don't leak sub-graph history into the parent state).
- **`backend/modules/`**: plugin modules. Each module subclasses `BaseKarsaModule` (`base_module.py`) with a `ClassVar` `ModuleManifest` and implements `get_tools()` and `build_graph(ctx)`. It registers itself at import time with `registry.register(...)` at the bottom of its `module.py`, and it must be imported from `backend/modules/__init__.py`. Module IDs are `finance`, `study_daily`, `research`, `writer` (both in `research_writer/`) and `datascience_code`. Which modules are enabled is persisted in `system_settings['modules.enabled']`. Logic lives in `tools.py`, and the `module.py` graph calls it.
- **Notebook (`backend/modules/notebook/`)**: a NotebookLM-style, source-grounded workspace. `store.py` (SQLite: notebooks, sources, chunks), `retrieval.py` (paragraph chunking + local BM25, no embeddings), `service.py` (ingest, cited Q&A, briefing/study guide, IMRaD paper draft, .docx export through `writer_tools.compile_imrad_to_docx`), `dataset_cleaner.py` (deterministic preview/apply cleaning; writes a NEW `_clean` file, imputation is opt-in; datasets are indexed as a compact profile, never raw rows). Every LLM step takes an injectable `llm_fn` and has an honest extractive fallback, and Q&A never calls the LLM when retrieval finds nothing. Routes are under `/api/v1/notebooks/...`; the UI is `components/widgets/NotebookWidget.tsx`.
- **Function keys**: the OSD stream (`/system/osd/stream`) also emits `osd://fkey` for F1-F12 and media keys (`os_bridge.get_pressed_keys`, polled every ~60 ms; only those keys, only their names; disable with `KARSA_FKEY_OSD=false`).
- **HITL (`orchestrator/hitl_gate.py`)**: a module builds a `ProposedAction` and calls `check_and_request_approval(action, thread_id, manifest.high_risk_actions)`. High or critical risk records a row in `hitl_approvals` and calls LangGraph `interrupt()`. The UI resumes the thread via `POST /api/v1/threads/{id}/resume` with approve, edit or reject. Destructive or overwrite actions (e.g. finance `set_monthly_capital`, overwriting a writer .docx) must go through this gate.
- **HITL safety properties** (`hitl_gate.py`, tested in `backend/tests/test_hitl_harness.py`): never execute straight after `check_and_request_approval`; run the side effect through `execute_approved(decision['action_id'], fn, current_fingerprint=...)` using `decision['final_args']` (the reviewer's edit, not the proposal), and treat `approve` and `edit` as go, anything else as no-go. A resumed node re-runs from its first line, so pass `nonce=` (e.g. `len(messages)`) and never rely on a random `action_id`: the gate derives a stable one. Policy lives in `system_settings['hitl.policy']`; critical actions are never auto-allowed. Audit/policy/retry routes: `/api/v1/approvals/{pending,audit,incomplete,policy}` and `/api/v1/approvals/{id}/retry`; UI: `widgets/ApprovalsWidget.tsx`.
- **Hari Ini & shortcuts**: `core/today.py` builds the home brief and its (max 3) rule-based nudges from real data; `widgets/TodayWidget.tsx` is the default-open docked widget; `stores/shortcuts.ts` owns rebindable in-app shortcuts (always require a modifier) and `components/ShortcutsSheet.tsx` is the `?` sheet. Global hotkeys outside the app are not possible without the Tauri shell.
- **Model plan** (`llm_router.py`): ask for a model with `router.get_chat_model(purpose=...)` (chat/finance/study/research/writer/code), not a tier, so the user's per-purpose choice and free-provider failover apply. Use `router.invoke_text` / `stream_text` where you want automatic failover. Keys live in `system_settings['api_key.<provider>']`; UI: Settings > Model AI (`ModelPlanPanel.tsx`). Greetings and capability questions are answered by `supervisor._canned_reply` with no model call: keep it that way.
- **Karsa (mascot)**: a glowing orb with two white pill eyes, drawn by `MascotCanvas.tsx` (`drawJellyScene`); the top notch face is `ColorEyes.tsx`. Surfaces are macOS-style glass: use `.karsa-surface` / `.karsa-widget` (they read `--glass-tint`, `--glass-border`, `--glass-shadow`). What it wears is `lib/jelly.ts` `OutfitItem[]` (presets + drawn PNGs), persisted via `/api/v1/wardrobe/outfit`. Its mood (`setMood`/`useJellyMood`) follows the AI agent (`hooks/useJellyMoodSync.ts`); `KarsaStage.tsx` is the big, click-through, talking version (Alt+K). Keep new overlays click-through: only the interactive bits get `pointer-events-auto`.
- **Finance ledger & notch editing**: `modules/finance/ledger.py` is the only place that validates and writes manual expenses/income (API `/finance/transactions` and `@Money` both use it). `@Money`/`@Todo` subcommands live in `orchestrator/directive_parser.py` (`_money_subcommand`, `_todo_subcommand`). Never report a success the database did not record.
- **Coding module**: `datascience_code/workspace.py` (safe read of files inside the user's folder, diff, patch with `.bak`, run tests); changes and test runs always go through the HITL gate. **Research** (`research_tools.py`) returns real results or an honest error, never invented papers.
- **`backend/api/main.py`**: one large file, no routers. Most routes live under `/api/v1/...`, and some are duplicated under `/api/...` for legacy callers. Chat is available as plain JSON (`/chat`) or as an SSE stream (`/chat/stream`). Hardware OSD events stream over SSE at `/system/osd/stream`. A few paths are declared twice (`/api/v1/tasks`, `/api/v1/tasks/{id}/complete`, `/api/v1/finance/report`). FastAPI uses the first declaration, so check which one is live before editing.

### Automation, phone and desktop shell (added in sessions #52-#56)

- **LLM calls** (`llm_router.py`): failures are classified (`classify_error`) and reported per provider via `LLMUnavailable`; transient errors back off (2 retries), a per-provider limiter protects free tiers, a reachable local Ollama is the last fallback. Never replace these messages with a generic one. Tests must patch `LLMRouter.ollama_up` (a real Ollama may answer) and `backend.api.automation.llm_available`.
- **Studio** (`backend/modules/studio/`, `finance/reports.py`, `finance/news.py`, `notebook/extras.py`, `notebook/ml_export.py`, routes in `api/automation.py`, UI `widgets/StudioWidget.tsx` + `components/studio/`): every automation has an honest no-model path. `prd_app.py` writes nothing and runs nothing before the plan is approved (audit row in `hitl_approvals`, fingerprint-checked); only whitelisted commands run.
- **File shelf** (`core/shelf.py`): real copies in `~/.karsa/uploads/shelf`, never paths from the browser.
- **Phone** (`core/mobile.py`, `api/mobile.py`, `m.html`, `src/mobile/`): any non-loopback caller needs the pairing token for `/api/`. Run `run_karsa_phone.bat` (host 0.0.0.0) to make the laptop reachable; Settings > HP shows the QR.
- **Desktop shell** (`desktop-companion/src-tauri/`): transparent full-screen window, click-through decided by a cursor thread from the rectangles the frontend reports (`lib/tauriBridge.ts`: elements with `pointer-events-auto` or `data-hit`). Build with `npm install` then `npm run tauri build` (needs Rust + MSVC Build Tools).

### UI zones (session #57)

- **Top Island = daily modules only.** `IslandDeck.tsx` holds the slides (Omni `NotchBar`, Pomodoro, Media+lyrics, Water, Todo, Shelf, Lainnya) and reuses the widget `*Body` components at size M; `Widget` pulls one out as a floating S/M/L widget. Expanded island is 560x262 (`NotchShell`).
- **Right dock = Agentic AI only.** `RightAgenticDock.tsx` (chat + HITL banner + automation cards) and `FullAppStudioModal.tsx` (Alt+Shift+K, state in `stores/studioMode.ts`). The automation list and panels live in `components/studio/AutomationPanel.tsx`; add new automations there. Do not put daily widgets in the dock; no widget is docked any more (`docked` is always false).
- Style with `.karsa-surface karsa-panel` (28px outer), `.karsa-nested` (20px inner card), `.karsa-grad` (primary), `Stepper` for pipelines. Tokens: `--island-bg`, `--bg-card`, `--card-shadow`.

### Project principles (from docs/decision log)

- **Deterministic first**: do the parsing, math and file compilation in Python before reaching for an LLM. Examples: Indonesian amounts such as "25rb" → 25000, Daily Safe Spend, Pandas profiling, and python-docx compilation. Never send raw datasets to an LLM, only compact profile metadata (< 2 KB).
- **Zero dummy data**: UI and endpoints show real SQLite or OS data, or an explicit empty state, never placeholder values.
- **Zero stealth recording**: screen capture (`screen_context/screen_reader.py`) runs only with explicit `user_consented`.
- Currency is formatted Indonesian-style, e.g. `Rp 25.000`.

## Frontend architecture (`desktop-companion/`)

React 19 + TypeScript + Tailwind 3 + Framer Motion. The `@/` import alias points to `src/`. `src-tauri/` contains only `tauri.conf.json` (transparent, undecorated, always-on-top window at the top edge). There's no Rust source yet. `public/` holds the PWA manifest and service worker; Vite binds `host: true` so a phone on the LAN can reach it.

The UI is two zones plus widgets (spec in `docs/05_UI_AND_COMPANION_ENGINE.md`, "Arsitektur v3"):

- **Theme**: `context/ThemeContext.tsx` owns light/dark/system. It sets `data-theme` and the `.dark` class on `<html>`, which swaps the CSS variables in `index.css`; Tailwind uses `darkMode: "class"` and exposes the variables as tokens (`bg-glass`, `bg-pill`, `text-ink`, `border-subtle`, ...). Style new UI with these tokens or `.karsa-surface`, not hard-coded colours. The choice persists to localStorage and to SQLite (`ui.theme`).
- **Top micro-notch**: `NotchIsland.tsx` (state machine: idle eyes -> peek -> OSD toast -> expanded `NotchBar`) renders `NotchShell`. It also owns the chat conversation, the Zero-Heat `isSleeping` state, HITL approvals, receipt drop and the Settings/Wardrobe popovers.
- **Dock + widgets (reverted layout)**: the UI is back to the pre-bento layout. The notch has idle eyes -> peek -> expanded `NotchBar` (orb mascot, orange Karsa button, theme toggle). The right-side dock (`RightSideDock.tsx`, 275px, collapsible) holds docked widgets (Pomodoro, Water, Todo, Finance, Media, AI Chat, Notebook, Approvals, Hari Ini) and a launcher row; widgets can be undocked into floating windows (`context/WidgetsContext.tsx`: `docked`, `toggleDock`, S/M/L sizes, localStorage `karsa_widgets_v3`) and chat is the `ChatWidget` view on the conversation held in `NotchIsland`. There is no island deck, no chat side panel and no bento grid. The big talking Karsa (`KarsaStage.tsx`, Alt+K) is back. Each widget renders an S/M/L layout from a `size` prop; keep widget state in the backend or outside React (Pomodoro runs in `stores/pomodoroStore.ts`).
- `context/SystemStatusContext.tsx` is the single source of truth for API-key and model connection status. `hooks/useDashboard.ts` polls `/api/v1/dashboard/summary`.
- **Click-through constraint**: `html`, `body` and `#root` are transparent and `pointer-events-none`. Only the notch, the dock and active widgets get `pointer-events-auto`. Don't add full-screen overlays or backdrops. The dock and floating widgets are portaled to `document.body` because the notch container has a CSS transform, which re-anchors `fixed` descendants.
