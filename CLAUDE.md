# claude.md — Workflow Principles

> This file defines **how** the agent thinks and works. It complements `instructions.md` (the execution loop) and `AGENTS.md` (skill rules).
>
> Every agent MUST read this file at the start of every session.

---

## 1. Planning Discipline

### When to Plan
- **Non-trivial tasks** (3+ steps, architectural decisions, multiple files): Write a plan to `tasks/todo.md` before coding.
- **Trivial tasks** (typo fixes, one-line changes, spacing adjustments): Skip planning, go straight to building.

### Plan Format
- Use checkable items: `- [ ]` uncompleted, `- [/]` in-progress, `- [x]` completed.
- Reference which skills are being loaded and why.
- Break large tasks into small, independently verifiable steps.

### Plan Updates
- Mark items `[/]` when starting work on them.
- Mark items `[x]` when completed and verified.
- Add new items if scope expands during implementation.

---

## 2. Code Quality Standards

### Simplicity First
- Write the simplest correct solution.
- Don't add abstractions until they're needed at least twice.
- Prefer standard library / built-in solutions over third-party packages.
- Every line should earn its place — if removing it doesn't break anything, remove it.

### Minimal Impact
- Change as few files as possible to achieve the goal.
- Preserve existing patterns and conventions in the codebase.
- Don't refactor unrelated code while fixing a bug.
- Match the style of surrounding code (formatting, naming, structure).

### Completeness
- Never leave `// TODO` comments in delivered code unless explicitly discussed.
- Never truncate output or use `// ... rest unchanged`.
- Every function must handle errors.
- Every edge case mentioned in the task must be addressed.

---

## 3. Debugging Methodology

When a bug or error occurs:

1. **Read the error message** — the answer is usually in it.
2. **Find the root cause** — don't patch symptoms. Trace the issue to its origin.
3. **Make the smallest fix** — don't rewrite the module. Fix the line that's wrong.
4. **Verify the fix** — prove it works by running the relevant test or dev server.
5. **Check for regressions** — make sure you didn't break something else.

### Common Pitfalls
- Don't guess at the problem. Read logs, check types, trace execution.
- Don't add workarounds. If the fix feels hacky, find the real cause.
- Don't change multiple things at once. Make one change, verify, then move on.

---

## 4. Communication Rules

### With the User
- Be concise. Lead with what changed and why.
- Show, don't tell. If you made a visual change, show the result.
- If you're uncertain, ask. Don't make assumptions about requirements.
- When you hit a blocker, explain what you tried and what failed.

### In Code
- Write self-documenting code. Good names > good comments.
- Preserve all existing comments and docstrings that are unrelated to your changes.
- Add comments only for non-obvious logic (performance tricks, workarounds, subtle behavior).

---

## 5. Lessons Learned Loop

### When Corrected
If the user corrects your work:

1. **Acknowledge** the correction without defensiveness.
2. **Fix** the issue immediately.
3. **Log the pattern** to `tasks/lessons.md` so you don't repeat it.

### Lesson Format in `tasks/lessons.md`

```markdown
### [Date] — [Short description]
- **What happened**: [What went wrong]
- **Root cause**: [Why it went wrong]
- **Rule**: [The principle to follow next time]
```

### At Session Start
- Always check `tasks/lessons.md` for relevant past mistakes before starting work.
- Apply learned patterns proactively — don't wait to be corrected twice.

---

## 6. Technology Preferences

<!-- ✏️ CUSTOMIZE: Add your project's technology preferences and conventions. Examples below. -->

### General
- Prefer TypeScript over JavaScript where the project uses TypeScript.
- Prefer `const` over `let`. Never use `var`.
- Prefer named exports over default exports.
- Prefer async/await over raw Promises.

### File Organization
- Co-locate related files (component + styles + tests in the same directory).
- Keep files focused — one component / module per file.
- Use index files for clean public APIs, not for dumping everything.

---

## 7. Security & Safety

- Never commit secrets, API keys, or credentials.
- Never log sensitive data (passwords, tokens, PII).
- Always validate and sanitize user input.
- Use parameterized queries — never concatenate SQL.
- When in doubt, ask the user before running destructive operations.

---

## 8. Summary of Principles

| Principle | Meaning |
|---|---|
| **Simplicity first** | Write the simplest correct solution |
| **Minimal impact** | Change as little as possible |
| **Root cause over symptoms** | Find and fix the real problem |
| **Prove it works** | Verify before delivering |
| **Learn from mistakes** | Log corrections, don't repeat them |
| **Complete code only** | No placeholders, no truncation |
| **Ask, don't assume** | Clarify unclear requirements |

