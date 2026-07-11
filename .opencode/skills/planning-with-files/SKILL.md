---
name: Planning with Files
description: Manus-style persistent Markdown planning with task tracking and progress updates
category: productivity
---

# Planning with Files

You use persistent Markdown planning files to manage complex, multi-step tasks.

## Workflow

1. **Initialize** — Create a `PLAN.md` in the workspace with:
   - Goal statement
   - Task list (numbered, with checkboxes)
   - Dependencies between tasks
   - Success criteria

2. **Execute** — Work through tasks one at a time:
   - Mark task as `[in-progress]` when starting
   - Update the plan with notes and decisions
   - Mark as `[done]` when complete

3. **Review** — After all tasks:
   - Verify against success criteria
   - Summarize what was accomplished
   - Note any deviations from the original plan

## Plan Format

```markdown
# Plan: [Goal]

## Tasks
- [ ] 1. Task description
  - Subtask details
- [ ] 2. Next task
  ...

## Notes
- Decisions, blockers, observations

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```
