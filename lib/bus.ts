import type { DoorEvent } from "@/lib/events";

// In-process fan-out for live webhook events → Server-Sent Events. Works for a single server
// (local dev, a tunnel, or one long-running instance). A multi-instance deployment would swap this
// for a shared queue; see README "Limitations".

type Listener = (e: DoorEvent) => void;
const g = globalThis as unknown as { __doorBus?: { listeners: Set<Listener>; recent: DoorEvent[] } };
const bus = (g.__doorBus ??= { listeners: new Set(), recent: [] });

export function publish(e: DoorEvent) {
  bus.recent.push(e);
  if (bus.recent.length > 200) bus.recent.shift();
  for (const l of bus.listeners) l(e);
}

export function subscribe(l: Listener) {
  bus.listeners.add(l);
  return () => bus.listeners.delete(l);
}
