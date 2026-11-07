# Instructions — Agent Orchestration

> **Read order**: `instructions.md` → `AGENTS.md` → `claude.md` → relevant `skills/<name>/SKILL.md`
>
> This file is the **master control loop**. Every agent (Claude Code, Cursor, Copilot, Antigravity, etc.) MUST read this file at the start of every task and follow it exactly.

---

## 1. Project Context

<!-- ✏️ FILL THIS IN for your project. Delete example rows, add your own. -->

| Key | Value |
|---|---|
| **App name** | <!-- e.g. MyApp --> |
| **Platform** | <!-- e.g. Next.js 15 / React 19 (Web) --> |
| **Language** | <!-- e.g. TypeScript 5.x --> |
| **Backend** | <!-- e.g. Supabase, Firebase, Express, Django --> |
| **Database** | <!-- e.g. PostgreSQL, SQLite, MongoDB --> |
| **Styling** | <!-- e.g. Tailwind CSS, CSS Modules, styled-components --> |
| **State** | <!-- e.g. Zustand, Redux, React Context --> |
| **Testing** | <!-- e.g. Vitest, Jest, Playwright --> |
| **Package Manager** | <!-- e.g. npm, pnpm, bun --> |

---

## 2. Skill Registry — Intent → Skill Routing

Before writing **any** code, the agent MUST check the table below and load the matching `SKILL.md` file. If multiple skills match, load all of them and follow each in order.

<!-- ✏️ ADD your own skills below. Delete example rows. -->

### 2.1 Frontend Tasks

| User Intent | Skill to Load | Path |
|---|---|---|
| Build / modify a UI component or page | `building-ui` | `skills/building-ui/SKILL.md` |
| Polish, audit, or critique existing UI/UX | `ui-review` | `skills/ui-review/SKILL.md` |
| <!-- Add more rows --> | | |

### 2.2 Backend / Database Tasks

| User Intent | Skill to Load | Path |
|---|---|---|
| Database schema, queries, migrations | `database` | `skills/database/SKILL.md` |
| API design or endpoint work | `api-design` | `skills/api-design/SKILL.md` |
| <!-- Add more rows --> | | |

### 2.3 Infrastructure / DevOps Tasks

| User Intent | Skill to Load | Path |
|---|---|---|
| CI/CD, deployment, Docker | `devops` | `skills/devops/SKILL.md` |
| <!-- Add more rows --> | | |

### 2.4 Workflow / Meta Tasks

| User Intent | Skill to Load | Path |
|---|---|---|
| Plan or brainstorm before building a feature | `brainstorming` | `skills/brainstorming/SKILL.md` |
| Agent is truncating output or using placeholders | `full-output-enforcement` | `skills/full-output-enforcement/SKILL.md` |

---

## 3. The Execution Loop — MANDATORY for Every Task

Every user request MUST be processed through this loop. **Do not skip steps. Do not short-circuit.**

```
┌──────────────────────────────────────────────────┐
│                 USER REQUEST                     │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  STEP 1: UNDERSTAND  │
        │  Parse intent.       │
        │  Read claude.md      │
        │  Read AGENTS.md      │
        │  Read instructions.md│
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  STEP 2: ROUTE       │
        │  Match intent to     │
        │  skill(s) from §2.   │
        │  Load each SKILL.md  │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  STEP 3: PLAN        │
        │  Write plan to       │
        │  tasks/todo.md       │
        │  (if non-trivial)    │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  STEP 4: BUILD       │
        │  Execute the skill   │
        │  workflow step by    │
        │  step. Write code.   │
        │  Follow skill rules. │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  STEP 5: VERIFY      │
        │  Run the app / test. │
        │  Check for errors.   │
        │  Prove it works.     │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────────────────┐
        │  STEP 6: COMPARE & SELF-REVIEW   │
        │                                  │
        │  Ask these 5 questions:          │
        │                                  │
        │  1. Does the output match what   │
        │     the user explicitly asked?   │
        │                                  │
        │  2. Does it satisfy the skill's  │
        │     exit criteria / standards?   │
        │                                  │
        │  3. Would a staff engineer at a  │
        │     top company approve this?    │
        │                                  │
        │  4. Are there visual or logic    │
        │     regressions from the change? │
        │                                  │
        │  5. Is the code complete? No     │
        │     placeholders, no truncation? │
        └──────────┬───────────────────────┘
                   │
            ┌──────┴──────┐
            │  ALL 5 YES? │
            └──────┬──────┘
              NO ──┤── YES
              │    │
              │    ▼
              │  ┌─────────────────────┐
              │  │ STEP 7: DELIVER     │
              │  │ Present to user.    │
              │  │ Commit if needed.   │
              │  │ Update todo.md      │
              │  │ Log to lessons.md   │
              │  │ if corrected.       │
              │  └─────────────────────┘
              │
              ▼
        ┌──────────────────────┐
        │  LOOP BACK → STEP 4  │
        │  Fix what failed.    │
        │  Re-verify.          │
        │  Re-compare.         │
        │  Keep looping until  │
        │  ALL 5 checks pass.  │
        └──────────────────────┘
```

---

## 4. Step Details

### Step 1 — UNDERSTAND

1. Parse the user's message into a clear **goal statement** (one sentence).
2. Identify: is this a feature, bug fix, UI redesign, backend change, or question?
3. Re-read `claude.md` workflow rules (plan mode, verification, elegance, lessons).
4. Re-read `AGENTS.md` skill-mapping rules.

### Step 2 — ROUTE

1. Scan the intent routing table in §2 above.
2. Open and read every matching `SKILL.md` file **in full** before proceeding.
3. If no skill matches, proceed with general best practices — but still follow the loop.
4. Multiple skills can be combined (e.g., `database` + `building-ui` for a new page that calls the backend).

### Step 3 — PLAN

- For **non-trivial** tasks (3+ steps or architectural decisions): write a plan to `tasks/todo.md` with checkable items.
- For trivial tasks (fix a typo, adjust spacing): skip directly to Step 4.
- Reference which skills you loaded and why.

### Step 4 — BUILD

- Follow the loaded skill(s) exactly. Do not deviate.
- Apply `full-output-enforcement`: never truncate, never use `// ... rest unchanged`, never leave placeholders.
- Follow `claude.md` principles: simplicity first, minimal impact, find root causes.
- Track progress by marking `tasks/todo.md` items `[/]` → `[x]`.

### Step 5 — VERIFY

- **Must prove the code works.** Options (use whichever apply):
  - Run the dev server and confirm no errors.
  - Run TypeScript type check: `npx tsc --noEmit` or equivalent.
  - Run linting / formatter.
  - Run tests: `npm test` or equivalent.
  - Visual inspection of rendered output.
- If verification fails, log the error and loop back to Step 4.

### Step 6 — COMPARE & SELF-REVIEW

This is the **quality gate**. The agent must answer all 5 questions honestly:

| # | Question | Fail Action |
|---|---|---|
| 1 | Does output match the user's explicit request? | Re-read the request. Fix the gap. Loop. |
| 2 | Does it meet the loaded skill's quality bar / exit criteria? | Re-read `SKILL.md`. Fix violations. Loop. |
| 3 | Would a staff engineer approve this? | Refactor. Remove hacks. Loop. |
| 4 | Any visual or logic regressions? | Revert partial changes. Fix. Loop. |
| 5 | Complete code? No truncation/placeholders? | Apply `full-output-enforcement`. Loop. |

**If ANY answer is NO → Loop back to Step 4.**

### Step 7 — DELIVER

1. Present the result to the user with a brief summary.
2. Commit with a descriptive message (per `AGENTS.md` commit routine).
3. Mark all `tasks/todo.md` items as `[x]`.
4. If the user corrects you after delivery → update `tasks/lessons.md` with the pattern.

---

## 5. Anti-Patterns — NEVER Do These

| Anti-Pattern | Correct Behavior |
|---|---|
| Skip skill loading ("I know how to do this") | Always load the matching `SKILL.md` first |
| Skip verification ("It should work") | Always prove it works before delivering |
| Deliver on first attempt without review | Always run the 5-question self-review |
| Use `// ... rest of file` or `/* existing code */` | Write complete code, every time |
| Edit code before reading the skill | Read skill first, code second |
| Ignore `claude.md` plan-mode rules | Follow plan mode for non-trivial work |
| Make a fix without logging the lesson | Update `tasks/lessons.md` when corrected |
| Over-engineer trivial fixes | Match effort to task complexity |

---

## 6. File Hierarchy & Authority

When instructions conflict, follow this precedence order (highest first):

1. **User's explicit request** — always takes priority
2. **`instructions.md`** (this file) — orchestration & loop rules
3. **`claude.md`** — workflow principles & task management
4. **`AGENTS.md`** — skill invocation rules & commit routine
5. **`skills/<name>/SKILL.md`** — domain-specific implementation guidance

---

## 7. Quick Reference — Common Task Flows

<!-- ✏️ CUSTOMIZE these for your project. Examples below. -->

### "Build a new page / component"
→ `brainstorming` → `building-ui` → `ui-review` (audit) → verify → deliver

### "Fix a database bug"
→ `database` → fix → verify → deliver

### "Add an API endpoint"
→ `api-design` + `database` → build → verify → deliver

### "Refactor or clean up code"
→ identify scope → plan in `todo.md` → refactor → verify → deliver

---

## 8. Session Start Checklist

At the start of every new session or conversation, the agent MUST:

- [ ] Read `instructions.md` (this file)
- [ ] Read `claude.md` (workflow principles)
- [ ] Read `AGENTS.md` (skill rules)
- [ ] Check `tasks/todo.md` for in-progress work
- [ ] Check `tasks/lessons.md` for relevant past mistakes
- [ ] Confirm skill directory is populated at `skills/` (if applicable)

