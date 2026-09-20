#!/bin/bash
set -euo pipefail

# Every session starts a fresh container, so anything set up here is gone by
# the next one.

cd "$CLAUDE_PROJECT_DIR"

# Commit identity — see CLAUDE.md's "How to work" rule.
git config user.name "Abhishek Gendah"
git config user.email "75556610+AbhishekGendah@users.noreply.github.com"
git config commit.gpgsign false

# The tenant isolation tests need a real Postgres. Docker is installed in the
# container but its daemon is not started.
if ! docker info >/dev/null 2>&1; then
  sudo dockerd >/tmp/dockerd.log 2>&1 &
fi
