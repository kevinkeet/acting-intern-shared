#!/bin/sh
# Installs the TEACH-AI pre-push guard for this clone; every worktree of the clone shares it.
# The installed hook runs the pushing checkout's own scripts/git-hooks/pre-push, so the guard
# itself is versioned with the code. A checkout without that file pushes unchecked.
hooks="$(git rev-parse --git-common-dir)/hooks"
mkdir -p "$hooks"
if [ -f "$hooks/pre-push" ] && ! grep -q "install-git-hooks.sh" "$hooks/pre-push"; then
    echo "A different pre-push hook already exists at $hooks/pre-push; not replacing it."
    exit 1
fi
cat > "$hooks/pre-push" <<'EOF'
#!/bin/sh
# Installed by scripts/install-git-hooks.sh (TEACH-AI guardrails). Runs this checkout's guard.
hook="$(git rev-parse --show-toplevel)/scripts/git-hooks/pre-push"
if [ -f "$hook" ]; then exec bash "$hook" "$@"; fi
exit 0
EOF
chmod +x "$hooks/pre-push"
echo "Installed $hooks/pre-push"
