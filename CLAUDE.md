# CLAUDE.md

## Skills

Read and follow these skills before writing any code:

- .claude/skills/base/SKILL.md
- .claude/skills/security/SKILL.md
- .claude/skills/project-tooling/SKILL.md
- .claude/skills/session-management/SKILL.md
- .claude/skills/existing-repo/SKILL.md

## Project Overview

A lightweight HTML/Canvas wallpaper that animates an A\* search (open/closed sets + final path) over the Greater Boston bounding box. Routes on cached OSM road graph with grid fallback. Designed for Lively Wallpaper (Windows).

## Tech Stack

- Language: JavaScript (vanilla, ES modules)
- Runtime: Browser (Canvas API) + Node.js (build scripts, tests)
- Testing: Node.js built-in test runner (`node --test`)
- CI/CD: GitHub Actions (test + dist packaging)
- Deployment: Local (Lively Wallpaper) or local HTTP server

## Key Commands

```bash
# Run tests
npm test

# Lint
npm run lint

# Lint + fix
npm run lint:fix

# Format
npm run format

# Check formatting
npm run format:check

# Build distributable
npm run build:dist

# Build road graph cache
npm run build:road-graph

# Verify tooling
bash scripts/verify-tooling.sh
```

## Documentation

- `docs/` - Technical documentation
- `_project_specs/` - Project specifications and todos

## Atomic Todos

All work is tracked in `_project_specs/todos/`:

- `active.md` - Current work
- `backlog.md` - Future work
- `completed.md` - Done (for reference)

Every todo must have validation criteria and test cases. See base.md skill for format.

## Project Structure

```
a-star-wallpaper/
├── index.html               # Entry point (opens in browser/Lively)
├── main.js                  # Canvas rendering, animation loop
├── astar.js                 # A* algorithm implementation
├── road-graph.js            # OSM road graph loading/querying
├── roads-data.js            # Road segment data for rendering
├── guardrails.js            # Runtime guardrails
├── endPhase.js              # End-of-search phase logic
├── data/                    # OSM data (GeoJSON, graph cache)
├── scripts/                 # Build/tooling scripts
├── tests/                   # Test files
├── docs/                    # Technical documentation
└── _project_specs/          # Todos, session state, specs
```

## Session Management

### State Tracking

Maintain session state in `_project_specs/session/`:

- `current-state.md` - Live session state (update every 15-20 tool calls)
- `decisions.md` - Key architectural/implementation decisions (append-only)
- `code-landmarks.md` - Important code locations for quick reference
- `archive/` - Past session summaries

### Automatic Updates

Update `current-state.md`:

- After completing any todo item
- Every 15-20 tool calls during active work
- Before any significant context shift
- When encountering blockers

### Decision Logging

Log to `decisions.md` when:

- Choosing between architectural approaches
- Selecting libraries or tools
- Making security-related choices
- Deviating from standard patterns

### Context Compression

When context feels heavy (~50+ tool calls):

1. Summarize completed work in current-state.md
2. Archive verbose exploration notes to archive/
3. Keep only essential context for next steps

### Session Handoff

When ending a session or approaching context limits, update current-state.md with:

- What was completed this session
- Current state of work
- Immediate next steps (numbered, specific)
- Open questions or blockers
- Files to review first when resuming

### Resuming Work

When starting a new session:

1. Read `_project_specs/session/current-state.md`
2. Check `_project_specs/todos/active.md`
3. Review recent entries in `decisions.md` if context needed
4. Continue from "Next Steps" in current-state.md

## Git Conventions

- Use conventional commit format (feat:, fix:, style:, chore:, docs:, test:, refactor:)

## Project-Specific Patterns

- All source files are vanilla JS ES modules (no bundler, no TypeScript)
- Canvas rendering in `main.js`, A\* algorithm in `astar.js`
- OSM data lives in `data/osm/` (GeoJSON + compact JSON + graph cache)
- Query params control runtime configuration (see README.md)
- No external runtime dependencies — dev dependencies only for tooling
