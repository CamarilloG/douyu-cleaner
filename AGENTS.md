# Project Memory

## Worktree Discipline

- Treat `/Users/c1mccc/Code/douyu-cleaner` as the canonical development path.
- Temporary worktrees under `.codex/worktrees/` or `.claude/worktrees/` may be used for isolated work, but their changes must be merged back into `main` before being considered current.
- Do not treat a version found only in a temporary worktree as the project latest until it has been merged into canonical `main`.
- Before editing, check the current branch and file version in the canonical path unless the user explicitly points to another worktree.
- After a temporary worktree has been merged, prefer cleaning it up so future agents do not continue from stale paths.

