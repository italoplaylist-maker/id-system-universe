/**
 * Instalador de uma linha para o ambiente de nuvem (Setup script): coloca o hook em ~/.claude e
 * registra os hooks em ~/.claude/settings.json (escopo de USUÁRIO — vale para todos os repositórios,
 * sem tocar em nenhum). Idempotente e preserva o que já existir no settings.json.
 * Uso: curl -fsSL https://painel/api/claude/install | bash -s -- https://painel
 */
export const INSTALL_SCRIPT = `#!/usr/bin/env bash
set -eu
BASE="\${1:-}"
[ -n "$BASE" ] || { echo "Uso: curl -fsSL <painel>/api/claude/install | bash -s -- <painel>" >&2; exit 1; }
BASE="\${BASE%/}"
mkdir -p "$HOME/.claude/hooks"
curl -fsSL "$BASE/api/claude/hook" -o "$HOME/.claude/hooks/isu-hook.py"
python3 -m py_compile "$HOME/.claude/hooks/isu-hook.py"
rm -rf "$HOME/.claude/hooks/__pycache__"
python3 - <<'PY'
import json, os
path = os.path.expanduser("~/.claude/settings.json")
try:
    with open(path) as f:
        data = json.load(f)
except (FileNotFoundError, ValueError):
    data = {}
cmd = 'python3 "$HOME/.claude/hooks/isu-hook.py"'
hooks = data.setdefault("hooks", {})
for event in ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "Notification", "SessionEnd"]:
    entries = hooks.setdefault(event, [])
    if any("isu-hook.py" in h.get("command", "") for e in entries for h in e.get("hooks", [])):
        continue
    entry = {"hooks": [{"type": "command", "command": cmd}]}
    if event.endswith("ToolUse"):
        entry = {"matcher": "*", **entry}
    entries.append(entry)
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\\n")
PY
echo "ID System Universe: hook instalado em ~/.claude (vale para todos os repositórios)."
`;
