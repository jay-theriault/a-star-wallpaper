<!--
LOG DECISIONS WHEN:
- Choosing between architectural approaches
- Selecting libraries or tools
- Making security-related choices
- Deviating from standard patterns

This is append-only. Never delete entries.
-->

# Decision Log

Track key architectural and implementation decisions.

## Format

```
## [YYYY-MM-DD] Decision Title

**Decision**: What was decided
**Context**: Why this decision was needed
**Options Considered**: What alternatives existed
**Choice**: Which option was chosen
**Reasoning**: Why this choice was made
**Trade-offs**: What we gave up
**References**: Related code/docs
```

---

## [2026-02-06] Guardrails Tooling Selection

**Decision**: Use ESLint + Prettier + Husky + lint-staged + commitlint
**Context**: Project had no linting, formatting, or commit validation
**Options Considered**: ESLint only, ESLint+Prettier, full guardrails suite
**Choice**: Full suite with conventional commits
**Reasoning**: Consistent code quality and commit history without overhead (all automated via hooks)
**Trade-offs**: Additional devDependencies, but zero runtime impact
**References**: package.json, eslint.config.js, .prettierrc, commitlint.config.js
