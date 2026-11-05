/** Ativar/desativar o push neste aparelho. Só roda no navegador. */
export type PushSupport = "ok" | "unsupported" | "needs-install" | "denied";

function isIos(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // iPhone/iPad só liberam push para apps adicionados à Tela de Início
    return typeof window !== "undefined" && isIos() && !isStandalone() ? "needs-install" : "unsupported";
  }
  if (isIos() && !isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() === "unsupported" || pushSupport() === "needs-install") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Você não permitiu notificações neste navegador.");
  const cfg = await fetch("/api/notifications/config").then((r) => r.json() as Promise<{ publicKey?: string; error?: string }>);
  if (!cfg.publicKey) throw new Error(cfg.error ?? "Não foi possível obter a chave de notificação.");
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) }));
  const res = await fetch("/api/notifications/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) throw new Error("O servidor não aceitou a assinatura.");
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/notifications/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
  await sub.unsubscribe();
}
