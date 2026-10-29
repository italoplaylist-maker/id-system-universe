/**
 * Hook do Claude Code (Python 3, só biblioteca padrão), servido em /api/claude/hook.
 * Envia apenas: tipo do evento, nome da ferramenta e um alvo curto (arquivo/comando truncado).
 * NUNCA envia o texto do prompt, o conteúdo de arquivos nem a saída dos comandos.
 */
export const HOOK_VERSION = "1.1.0";

export const HOOK_SCRIPT = `#!/usr/bin/env python3
# ID System Universe — hook do Claude Code v${HOOK_VERSION}
# Variáveis: ISU_URL (https://seu-painel) e ISU_CLAUDE_TOKEN (isc_...). Sem elas, não faz nada.
import json, os, subprocess, sys, tempfile, time, urllib.request

EVENTS = {
    "SessionStart": "session_start", "UserPromptSubmit": "prompt", "PreToolUse": "tool_start",
    "PostToolUse": "tool_end", "Stop": "stop", "Notification": "notify", "SessionEnd": "session_end",
}

def short_path(p, cwd):
    try:
        rel = os.path.relpath(p, cwd) if cwd and os.path.isabs(p) else p
    except ValueError:
        rel = p
    parts = [x for x in rel.split(os.sep) if x not in ("", ".")]
    return "/".join(parts[-3:]) if parts else p

def target_of(tool, inp, cwd):
    if not isinstance(inp, dict):
        return None
    for key in ("file_path", "notebook_path", "path"):
        if isinstance(inp.get(key), str):
            return short_path(inp[key], cwd)
    if isinstance(inp.get("command"), str):
        return " ".join(inp["command"].split())[:80]
    for key in ("pattern", "query", "url", "description"):
        if isinstance(inp.get(key), str):
            return inp[key][:80]
    return None

def failed(resp):
    if isinstance(resp, dict):
        if resp.get("is_error") or resp.get("error") or resp.get("interrupted"):
            return True
        for key in ("exit_code", "exitCode", "returncode"):
            if isinstance(resp.get(key), int) and resp[key] != 0:
                return True
    return False

def git(cwd, *args):
    try:
        return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=1.5).stdout.strip()
    except Exception:
        return ""

def flag_path(sid):
    safe = "".join(c for c in sid if c.isalnum() or c in "-_")[:80]
    return os.path.join(tempfile.gettempdir(), "isu-pending-" + safe)

def send(url, token, body, timeout):
    req = urllib.request.Request(url + "/api/claude/events", data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read() or b"{}")

def main():
    url, token = os.environ.get("ISU_URL", "").rstrip("/"), os.environ.get("ISU_CLAUDE_TOKEN", "")
    if not url or not token:
        return
    data = json.load(sys.stdin)
    event = EVENTS.get(data.get("hook_event_name"))
    sid = data.get("session_id")
    if not event or not sid:
        return
    cwd = data.get("cwd") or os.getcwd()
    body = {"sessionId": sid, "event": event, "at": int(time.time() * 1000)}
    if event in ("tool_start", "tool_end"):
        body["tool"] = str(data.get("tool_name", ""))[:60]
        tgt = target_of(data.get("tool_name"), data.get("tool_input"), cwd)
        if tgt:
            body["target"] = tgt
        if event == "tool_end":
            body["ok"] = not failed(data.get("tool_response"))
    else:
        remote = git(cwd, "remote", "get-url", "origin")
        if remote:
            body["repo"] = remote.removesuffix(".git").split("github.com")[-1].lstrip(":/")[-160:]
        branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD")
        if branch:
            body["branch"] = branch[:120]
        if isinstance(data.get("model"), str):
            body["model"] = data["model"][:80]

    flag = flag_path(sid)
    # Pedidos do painel: ao terminar a resposta (Stop), ao receber uma mensagem sua (UserPromptSubmit)
    # ou, no meio do trabalho, quando um evento anterior avisou que há pedido na fila (arquivo-sinal).
    wait = event in ("stop", "prompt") or (event == "tool_end" and os.path.exists(flag))
    if wait:
        body["deliver"] = True
        try:
            resp = send(url, token, body, 3)
        except Exception:
            return
        try:
            os.remove(flag)
        except OSError:
            pass
        command = resp.get("command")
        if command:
            if event == "prompt":
                print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": command}}))
            else:
                print(json.dumps({"decision": "block", "reason": command}))
        return

    # O Claude não espera pela rede: o pai sai já, o filho envia e, se houver pedido na fila, deixa o sinal.
    if hasattr(os, "fork") and os.fork() != 0:
        return
    try:
        resp = send(url, token, body, 4)
        if resp.get("pending"):
            open(flag, "w").close()
    except Exception:
        pass

try:
    main()
except Exception:
    pass
sys.exit(0)
`;
