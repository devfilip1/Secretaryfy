# Architecture

> Auto-populated from an ashlr baseline scan at genome init. Edit freely to
> capture intent and tradeoffs that a scanner cannot see.

## Snapshot

- **Files scanned:** 395
- **Runtime:** Node
- **Runtime notes:** package.json type=module; package-lock.json present; walk: git ls-files
- **Top extensions:** .md (136), .ts (117), .py (60), .json (31), .tsx (17), .ps1 (7)
- **Entry points:** dist/index.js (package.json main), src/index.ts, docker-compose.yml
- **Tests:** 71 files

## Largest source files

- `src/modules/scheduling/flow.test.ts` — 604 LOC
- `src/modules/scheduling/flow.ts` — 568 LOC
- `rag/evaluation/report.py` — 506 LOC

## Top-level layout

```
Secretaryfy/
├── .ashlrcode/
├── docs/
├── drizzle/
├── rag/
├── scripts/
├── specs/
├── src/
├── web/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── docker-compose.yml
├── drizzle.config.ts
├── package-lock.json
├── package.json
├── tsconfig.json
```

## Notes

- Replace this section with an intent-level description: why does each top-level dir exist, what does it own, and what crosses its boundary?
