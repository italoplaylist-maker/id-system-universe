"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useAgentTools, useAgentToolsMutations } from "@/hooks/use-orchestrator";

const field = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none";
const SKILL_TEMPLATE = `---\nname: minha-skill\ndescription: Quando usar esta skill (o Claude decide por esta frase)\n---\n\nInstruções da skill aqui.\n`;
const onErr = (e: Error) => toast.error(e.message);

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h3>
      {hint && <p className="text-[11px] leading-snug text-muted">{hint}</p>}
      {children}
    </section>
  );
}

function Packs({ canWrite }: { canWrite: boolean }) {
  const { data } = useAgentTools(true);
  const { installPack } = useAgentToolsMutations();
  if (!data || data.packs.length === 0) return null;
  return (
    <Section title="Kits prontos" hint="Já vêm dentro do Universe e valem para TODOS os agentes (ficam no ~/.claude do servidor). Nada de terceiros é executado: só arquivos copiados.">
      <ul className="space-y-2">
        {data.packs.map((p) => (
          <li key={p.id} className="space-y-1 rounded border border-border bg-surface p-2 text-xs">
            <p className="font-medium text-foreground">{p.name} <span className="font-normal text-muted">· v{p.version} · {p.license}</span></p>
            <p className="text-muted">{p.description}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className={p.skillsInstalled ? "text-status-running" : "text-muted"}>{p.skillsInstalled ? "● Skills instaladas" : "○ Skills não instaladas"}</span>
              {p.mcpAvailable && <span className={p.mcpInstalled ? "text-status-running" : "text-muted"}>{p.mcpInstalled ? "● MCP ligado" : "○ MCP desligado"}</span>}
              {canWrite && (
                <Button size="sm" variant="secondary" disabled={installPack.isPending} onClick={() => installPack.mutate({ id: p.id, withMcp: false }, { onSuccess: () => toast.success("Skills instaladas para todos os agentes."), onError: onErr })}>
                  {p.skillsInstalled ? "Reinstalar skills" : "Instalar skills"}
                </Button>
              )}
              {canWrite && p.mcpAvailable && !p.mcpInstalled && (
                <Button size="sm" variant="secondary" disabled={installPack.isPending} onClick={() => installPack.mutate({ id: p.id, withMcp: true }, { onSuccess: () => toast.success("Skills e MCP ligados."), onError: onErr })}>
                  Instalar + ligar MCP do Motion
                </Button>
              )}
            </div>
            {p.mcpAvailable && <p className="text-[11px] text-muted">O MCP é um serviço externo (mcp.motion.dev) usado para buscar documentação; só liga se você pedir.</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Skills({ canWrite }: { canWrite: boolean }) {
  const { data } = useAgentTools(true);
  const { saveSkill, deleteSkill } = useAgentToolsMutations();
  const [name, setName] = useState("");
  const [content, setContent] = useState(SKILL_TEMPLATE);
  return (
    <Section title="Skills" hint="Ficam em ~/.claude/skills no servidor e valem para todos os agentes. Skills do repositório (.claude/skills) já são lidas sozinhas.">
      <ul className="space-y-1">
        {data?.skills.map((s) => (
          <li key={s.name} className="flex items-start justify-between gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs">
            <button className="min-w-0 text-left" onClick={() => { setName(s.name); setContent(s.content); }}>
              <span className="block font-medium text-foreground">{s.name}</span>
              <span className="block truncate text-muted">{s.description ?? "—"}</span>
            </button>
            {canWrite && <button aria-label={`Remover ${s.name}`} className="text-muted hover:text-status-error" onClick={() => deleteSkill.mutate(s.name, { onError: onErr })}><Trash2 className="h-3.5 w-3.5" /></button>}
          </li>
        ))}
        {data && data.skills.length === 0 && <li className="text-xs text-muted">Nenhuma skill instalada.</li>}
      </ul>
      {canWrite && (
        <>
          <input className={field} placeholder="nome-da-skill" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className={cn(field, "h-32 font-mono")} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
          <Button size="sm" variant="primary" disabled={!name.trim() || saveSkill.isPending} onClick={() => saveSkill.mutate({ name: name.trim(), content }, { onSuccess: () => toast.success("Skill salva."), onError: onErr })}>Salvar skill</Button>
        </>
      )}
    </Section>
  );
}

function ClaudeMd({ canWrite }: { canWrite: boolean }) {
  const { data } = useAgentTools(true);
  const { saveClaudeMd } = useAgentToolsMutations();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? data?.claudeMd ?? "";
  return (
    <Section title="CLAUDE.md global" hint="Instruções que todos os agentes seguem (~/.claude/CLAUDE.md). O CLAUDE.md de cada repositório continua valendo.">
      <textarea className={cn(field, "h-28 font-mono")} value={value} onChange={(e) => setDraft(e.target.value)} readOnly={!canWrite} spellCheck={false} />
      {canWrite && <Button size="sm" variant="primary" disabled={draft === null || saveClaudeMd.isPending} onClick={() => saveClaudeMd.mutate(value, { onSuccess: () => { setDraft(null); toast.success("CLAUDE.md salvo."); }, onError: onErr })}>Salvar</Button>}
    </Section>
  );
}

function Mcp({ canWrite }: { canWrite: boolean }) {
  const { data } = useAgentTools(true);
  const { createMcp, toggleMcp, deleteMcp } = useAgentToolsMutations();
  const [f, setF] = useState({ name: "", type: "stdio", command: "", args: "", url: "", secrets: "" });
  const submit = () => {
    const secrets: Record<string, string> = {};
    for (const line of f.secrets.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) secrets[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    createMcp.mutate(
      { name: f.name, type: f.type, command: f.command || undefined, args: f.args.trim() ? f.args.trim().split(/\s+/) : undefined, url: f.url || undefined, secrets },
      { onSuccess: () => { setF({ name: "", type: "stdio", command: "", args: "", url: "", secrets: "" }); toast.success("MCP adicionado."); }, onError: onErr },
    );
  };
  return (
    <Section title="Servidores MCP" hint="Rodam no servidor do Universe. Chaves e tokens ficam cifrados e nunca são exibidos de volta.">
      <ul className="space-y-1">
        {data?.mcp.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs">
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{m.name} <span className="font-normal text-muted">· {m.type}</span></span>
              <span className="block truncate text-muted">{m.command ? `${m.command} ${m.args.join(" ")}` : m.url}{m.secretKeys.length ? ` · segredos: ${m.secretKeys.join(", ")}` : ""}</span>
            </span>
            {canWrite && (
              <span className="flex shrink-0 items-center gap-2">
                <button className="text-muted hover:text-foreground" onClick={() => toggleMcp.mutate({ id: m.id, enabled: !m.enabled }, { onError: onErr })}>{m.enabled ? "Desligar" : "Ligar"}</button>
                <button aria-label={`Remover ${m.name}`} className="text-muted hover:text-status-error" onClick={() => deleteMcp.mutate(m.id, { onError: onErr })}><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </li>
        ))}
        {data && data.mcp.length === 0 && <li className="text-xs text-muted">Nenhum MCP cadastrado.</li>}
      </ul>
      {canWrite && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input className={field} placeholder="nome (ex.: github)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <select className={field} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Tipo">
              <option value="stdio">stdio (comando)</option><option value="http">http</option><option value="sse">sse</option>
            </select>
          </div>
          {f.type === "stdio" ? (
            <>
              <input className={field} placeholder="comando (ex.: npx)" value={f.command} onChange={(e) => setF({ ...f, command: e.target.value })} />
              <input className={field} placeholder="argumentos (ex.: -y @modelcontextprotocol/server-github)" value={f.args} onChange={(e) => setF({ ...f, args: e.target.value })} />
            </>
          ) : (
            <input className={field} placeholder="URL do servidor MCP" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          )}
          <textarea className={cn(field, "h-14 font-mono")} placeholder={f.type === "stdio" ? "Variáveis de ambiente, uma por linha: CHAVE=valor" : "Cabeçalhos, um por linha: Authorization=Bearer ..."} value={f.secrets} onChange={(e) => setF({ ...f, secrets: e.target.value })} spellCheck={false} />
          <Button size="sm" variant="primary" disabled={!f.name.trim() || createMcp.isPending} onClick={submit}>Adicionar MCP</Button>
        </div>
      )}
    </Section>
  );
}

function Plugins({ canWrite }: { canWrite: boolean }) {
  const { data } = useAgentTools(true);
  const { plugin } = useAgentToolsMutations();
  const [value, setValue] = useState("");
  const run = (action: string, v: string) => plugin.mutate({ action, value: v }, { onSuccess: (r) => toast.success(r.output?.slice(-160) || "Feito."), onError: onErr });
  return (
    <Section title="Plugins" hint="Instalados pelo comando oficial do Claude Code no servidor. Primeiro adicione o marketplace (owner/repositório), depois instale plugin@marketplace.">
      <ul className="space-y-1 text-xs">
        {data?.plugins.installed.map((p, i) => (
          <li key={p.id ?? p.name ?? i} className="flex items-center justify-between rounded border border-border bg-surface px-2 py-1.5">
            <span className="text-foreground">{p.id ?? p.name}{p.version ? <span className="text-muted"> · {p.version}</span> : null}</span>
            {canWrite && (p.id ?? p.name) && (
              <span className="flex gap-2 text-muted">
                <button className="hover:text-foreground" onClick={() => run(p.enabled === false ? "enable" : "disable", String(p.id ?? p.name))}>{p.enabled === false ? "Ativar" : "Desativar"}</button>
                <button className="hover:text-status-error" onClick={() => run("uninstall", String(p.id ?? p.name))}>Remover</button>
              </span>
            )}
          </li>
        ))}
        {data && data.plugins.installed.length === 0 && <li className="text-muted">Nenhum plugin instalado.</li>}
        {data && data.plugins.marketplaces.length > 0 && <li className="text-muted">Marketplaces: {data.plugins.marketplaces.map((m) => m.name).filter(Boolean).join(", ")}</li>}
      </ul>
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <input className={cn(field, "min-w-0 flex-1")} placeholder="owner/repositorio  ou  plugin@marketplace" value={value} onChange={(e) => setValue(e.target.value)} />
          <Button size="sm" variant="secondary" disabled={!value.trim() || plugin.isPending} onClick={() => run("marketplace-add", value.trim())}>Add marketplace</Button>
          <Button size="sm" variant="primary" disabled={!value.trim() || plugin.isPending} onClick={() => run("install", value.trim())}>
            {plugin.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Instalar"}
          </Button>
        </div>
      )}
    </Section>
  );
}

/** Tudo que deixa os agentes parecidos com o Claude Code: skills, CLAUDE.md global, MCPs e plugins. */
export function ToolsPanel({ canWrite, onBack }: { canWrite: boolean; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2"><button className="text-xs text-muted hover:text-foreground" onClick={onBack}>← Voltar</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Packs canWrite={canWrite} />
        <ClaudeMd canWrite={canWrite} />
        <Skills canWrite={canWrite} />
        <Mcp canWrite={canWrite} />
        <Plugins canWrite={canWrite} />
      </div>
    </div>
  );
}
