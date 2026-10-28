"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";

import { deviceName } from "@/lib/push";

import { useAdminText } from "./admin-text";
import { Button, Card, List, ListRow, RowLead } from "./ui";

type Done = { ok: true } | { ok: false; problem: string };
type AsyncDone = Promise<Done>;
type Ready = Promise<ServiceWorkerRegistration>;

export type PushStore = { slug: string; id: string; name: string };
export type PushDeviceView = { id: string; storeId: string; storeName: string; device: string; endpoint: string };

/** The VAPID public key (base64url) as the browser's `applicationServerKey`. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const noChange = () => () => {};

async function registration(): Ready {
  await navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" });
  return navigator.serviceWorker.ready;
}

/**
 * Notifications on this device (D361), on Your account: a switch per store whose orders the person reads; turning one on asks the browser's
 * permission, subscribes this device with the VAPID key and keeps it on the server; the list shows every device that gets them.
 */
export function PushSettings({
  publicKey,
  stores,
  devices,
  actions,
}: {
  publicKey: string | null;
  stores: PushStore[];
  devices: PushDeviceView[];
  actions: { save: (store: string, subscription: unknown) => AsyncDone; remove: (store: string, endpoint: string) => AsyncDone; removeDevice: (id: string) => AsyncDone };
}) {
  const w = useAdminText("shell").push;
  // Whether this browser can get notifications: known only in the browser, null while the server draws the page.
  const able = useSyncExternalStore(
    noChange,
    () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    () => null,
  );
  const [broken, setBroken] = useState(false);
  const supported = broken ? false : able;
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [denied, setBlocked] = useState(false);
  const blocked = denied || (able === true && Notification.permission === "denied");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, run] = useTransition();

  useEffect(() => {
    if (!able) return;
    registration()
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEndpoint(sub?.endpoint ?? null))
      .catch(() => setBroken(true));
  }, [able]);

  const mine = (storeId: string) => endpoint !== null && devices.some((d) => d.storeId === storeId && d.endpoint === endpoint);

  const turnOn = (store: PushStore) =>
    run(async () => {
      setProblem(null);
      try {
        if ((await Notification.requestPermission()) !== "granted") {
          setBlocked(true);
          return;
        }
        const reg = await registration();
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) }));
        const done = await actions.save(store.slug, { ...sub.toJSON(), device: deviceName(navigator.userAgent) });
        if (!done.ok) setProblem(w.failed);
        else setEndpoint(sub.endpoint);
      } catch {
        setProblem(w.failed);
      }
    });

  const turnOff = (store: PushStore) =>
    run(async () => {
      setProblem(null);
      if (endpoint && !(await actions.remove(store.slug, endpoint)).ok) setProblem(w.failed);
    });

  return (
    <Card title={w.title} description={w.description}>
      {!publicKey ? (
        <p className="text-sm text-muted">{w.off}</p>
      ) : supported === false ? (
        <p className="text-sm text-muted">{w.unsupported}</p>
      ) : (
        <div className="flex flex-col gap-4" aria-busy={pending}>
          {blocked && <p className="text-sm text-warning-text">{w.blocked}</p>}
          <ul className="flex flex-col gap-2">
            {stores.map((store) => (
              <li key={store.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ink">
                  {store.name}
                  {mine(store.id) && <span className="text-muted"> · {w.on}</span>}
                </span>
                {mine(store.id) ? (
                  <Button kind="quiet" size="dense" disabled={pending || supported !== true} onClick={() => turnOff(store)}>
                    {pending ? w.working : w.turnOff}
                  </Button>
                ) : (
                  <Button kind="secondary" size="dense" disabled={pending || supported !== true || blocked} onClick={() => turnOn(store)}>
                    {pending ? w.working : w.turnOn}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {problem && (
            <p role="alert" className="text-sm text-danger-text">
              {problem}
            </p>
          )}
          <div>
            <p className="mb-2 text-eyebrow text-muted">{w.devices}</p>
            {devices.length === 0 ? (
              <p className="text-sm text-muted">{w.none}</p>
            ) : (
              <List>
                {devices.map((d) => (
                  <ListRow key={d.id}>
                    <RowLead title={d.device || "—"} sub={[d.storeName, d.endpoint === endpoint ? w.thisDevice : null].filter(Boolean).join(" · ")} />
                    <Button kind="quiet" size="dense" disabled={pending} onClick={() => run(async () => void (await actions.removeDevice(d.id)))}>
                      {w.remove}
                    </Button>
                  </ListRow>
                ))}
              </List>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Registers the admin's service worker (D361) once the signed-in shell is drawn, so the admin can be installed and opens offline. */
export function AdminServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).catch(() => {});
  }, []);
  return null;
}
