#!/bin/bash
set -euo pipefail

# Every session starts a fresh container, so the repo-local git config
# from the last session is gone. Re-apply Abhi's identity and turn off
# commit signing before any commit happens — see CLAUDE.md's "How to
# work" rule on commit identity.
cd "$CLAUDE_PROJECT_DIR"

git config user.name "Abhishek Gendah"
git config user.email "75556610+AbhishekGendah@users.noreply.github.com"
git config commit.gpgsign false
