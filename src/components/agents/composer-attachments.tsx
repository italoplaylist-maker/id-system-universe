"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Mic, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

export interface ComposerItem {
  key: string;
  name: string;
  kind: "image" | "file";
  size: number;
  previewUrl?: string;
  status: "uploading" | "ready" | "error";
  id?: string;
  error?: string;
}

const MAX_FILES = 10;
const MAX_FILE = 25 * 1024 * 1024;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Foto grande de celular → JPEG até 2000 px (a API do Claude aceita ≤ 5 MB por imagem e quanto menor, mais rápido). Falhou? envia o original. */
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 1.2 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Anexos do comando: envia cada arquivo na hora (com miniatura e progresso); o comando só leva os ids. */
export function useComposerAttachments() {
  const [items, setItems] = useState<ComposerItem[]>([]);
  const itemsRef = useRef<ComposerItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const patch = useCallback((key: string, p: Partial<ComposerItem>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))), []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = MAX_FILES - itemsRef.current.length;
      if (files.length > room) toast.error(`No máximo ${MAX_FILES} anexos por comando.`);
      for (const original of files.slice(0, Math.max(0, room))) {
        if (original.size > MAX_FILE) {
          toast.error(`${original.name}: passa de ${MAX_FILE / 1024 / 1024} MB.`);
          continue;
        }
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const isImage = original.type.startsWith("image/");
        setItems((cur) => [...cur, { key, name: original.name || "arquivo", kind: isImage ? "image" : "file", size: original.size, previewUrl: isImage ? URL.createObjectURL(original) : undefined, status: "uploading" }]);
        try {
          const file = await shrinkImage(original);
          const form = new FormData();
          form.append("file", file, file.name || "arquivo");
          const res = await fetch("/api/orchestrator/attachments", { method: "POST", body: form });
          const body = (await res.json().catch(() => ({}))) as { attachment?: { id: string; kind: "image" | "file"; size: number }; error?: string };
          if (!res.ok || !body.attachment) throw new Error(body.error ?? `Falha no envio (${res.status}).`);
          patch(key, { status: "ready", id: body.attachment.id, kind: body.attachment.kind, size: body.attachment.size });
        } catch (e) {
          patch(key, { status: "error", error: e instanceof Error ? e.message : "Falha no envio." });
        }
      }
    },
    [patch],
  );

  const remove = useCallback((key: string) => {
    const it = itemsRef.current.find((i) => i.key === key);
    if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
    if (it?.id) void fetch(`/api/orchestrator/attachments/${it.id}`, { method: "DELETE" }).catch(() => undefined);
    setItems((cur) => cur.filter((i) => i.key !== key));
  }, []);

  /** Depois de enviar o comando: limpa sem apagar os arquivos (já pertencem à tarefa). */
  const clear = useCallback(() => {
    for (const i of itemsRef.current) if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
    setItems([]);
  }, []);

  return {
    items,
    addFiles,
    remove,
    clear,
    uploading: items.some((i) => i.status === "uploading"),
    hasError: items.some((i) => i.status === "error"),
    ids: items.filter((i) => i.status === "ready" && i.id).map((i) => i.id as string),
  };
}

export function AttachmentStrip({ items, onRemove }: { items: ComposerItem[]; onRemove: (key: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Anexos do comando">
      {items.map((i) => (
        <li key={i.key} className={cn("relative flex max-w-[11rem] items-center gap-2 rounded-md border bg-surface p-1.5 text-[11px]", i.status === "error" ? "border-status-error/60" : "border-border")}>
          {i.kind === "image" && i.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={i.previewUrl} alt={i.name} className="h-10 w-10 rounded object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded bg-background text-muted"><FileText className="h-5 w-5" aria-hidden /></span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-foreground">{i.name}</span>
            <span className={cn("block", i.status === "error" ? "text-status-error" : "text-muted")}>
              {i.status === "uploading" ? <><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />enviando…</> : i.status === "error" ? i.error : kb(i.size)}
            </span>
          </span>
          <button type="button" onClick={() => onRemove(i.key)} className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-surface-raised p-0.5 text-muted hover:text-foreground" aria-label={`Remover ${i.name}`}>
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Botão de clipe: abre o seletor (no celular oferece câmera, fotos e arquivos). */
export function AttachButton({ onFiles, disabled }: { onFiles: (f: File[]) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()} className="rounded-md border border-border p-1.5 text-muted hover:text-foreground disabled:opacity-50" aria-label="Anexar imagem ou arquivo" title="Anexar imagem ou arquivo">
        <Paperclip className="h-4 w-4" />
      </button>
    </>
  );
}

// ---- ditado por voz -----------------------------------------------------------------------------------------------
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Gravar a voz = ditado (fala → texto), como no app do Claude. O Claude não "ouve" áudio: quem transcreve é o próprio navegador
 * (Chrome/Edge/Safari), e o texto cai no campo do comando para você revisar antes de enviar.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  // Só decidido no cliente (depois da hidratação): calcular no render deixava o botão inconsistente.
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRef = useRef(false);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);
  useEffect(() => {
    setSupported(speechCtor() !== null); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
  }, []);

  const beginRef = useRef<() => void>(() => undefined);
  const begin = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "pt-BR";
    // Sem modo contínuo: no Chrome do Android ele repete frases e para sozinho. Reiniciamos ao fim de cada frase.
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) onTextRef.current(r[0].transcript.trim());
        else live += r[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false;
        toast.error("Microfone bloqueado. Toque no cadeado ao lado do endereço e permita o microfone para este site.");
      } else if (e.error === "audio-capture") {
        wantRef.current = false;
        toast.error("Nenhum microfone encontrado neste aparelho.");
      } else if (e.error === "network") {
        wantRef.current = false;
        toast.error("O ditado do navegador precisa de internet e não funciona em alguns navegadores (ex.: Brave, Firefox). Use Chrome, Edge ou Safari.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        wantRef.current = false;
        toast.error(`Não consegui ouvir (${e.error}).`);
      }
    };
    rec.onend = () => {
      recRef.current = null;
      setInterim("");
      if (wantRef.current) {
        // terminou a frase: continua ouvindo até o usuário parar
        try {
          beginRef.current();
          return;
        } catch {
          wantRef.current = false;
        }
      }
      setListening(false);
    };
    recRef.current = rec;
    rec.start();
  }, []);
  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  const start = useCallback(async () => {
    if (!speechCtor()) return;
    if (!window.isSecureContext) {
      toast.error("O microfone só funciona em conexão segura (https).");
      return;
    }
    // Pede a permissão ANTES: o reconhecimento de voz falha em silêncio em vários navegadores quando ela ainda não foi dada.
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        toast.error(name === "NotFoundError" ? "Nenhum microfone encontrado neste aparelho." : "Microfone bloqueado. Toque no cadeado ao lado do endereço e permita o microfone para este site.");
        return;
      }
    }
    wantRef.current = true;
    setListening(true);
    try {
      begin();
    } catch {
      wantRef.current = false;
      setListening(false);
      toast.error("Não consegui iniciar o microfone.");
    }
  }, [begin]);

  useEffect(
    () => () => {
      wantRef.current = false;
      recRef.current?.stop();
    },
    [],
  );
  return { supported, listening, interim, toggle: () => (listening ? stop() : void start()) };
}

export function MicButton({ listening, supported, onClick }: { listening: boolean; supported: boolean; onClick: () => void }) {
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-md border p-1.5", listening ? "animate-pulse border-status-error bg-status-error/15 text-status-error" : "border-border text-muted hover:text-foreground")}
      aria-label={listening ? "Parar de ditar" : "Ditar por voz"}
      aria-pressed={listening}
      title={listening ? "Parar de ditar" : "Ditar por voz (fala vira texto)"}
    >
      {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>
  );
}
