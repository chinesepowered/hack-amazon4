"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DoorEvent, Source } from "@/lib/events";
import { SCENARIOS } from "@/lib/sim/scenarios";
import { DEFAULT_EXPECTED, type ExpectedVisitor } from "@/lib/expected";

type Announcement = Extract<DoorEvent, { kind: "announcement" }>;
type Activity = Exclude<DoorEvent, { kind: "snapshot" } | { kind: "announcement" }> & { key: number };
type Mode = "simulator" | "hybrid" | "live";
type Status = { mode: Mode; devices?: { id: string; name: string; device_type: string }[]; sources?: Record<string, Source>; hasToken?: boolean };

const CATEGORY_TEXT: Record<Announcement["category"], string> = {
  visitor: "Visitor",
  expected_visitor: "Expected visitor",
  package: "Package",
};

const MODE_BADGE: Record<Mode, { text: string; color: string; title: string }> = {
  live: { text: "● Live Ring API", color: "var(--green)", title: "Every call goes to the Ring Partner API" },
  hybrid: {
    text: "◐ Live Ring device · simulated events",
    color: "var(--blue)",
    title: "Devices, capabilities and status come from the Ring API. Events, snapshots and the chime are simulated: the Developer Playground serves no recorded footage and has no chime.",
  },
  simulator: { text: "◆ Simulated Ring events", color: "var(--amber)", title: "Events and snapshots come from the built-in Ring simulator" },
};

const load = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export default function DoorApp() {
  const [status, setStatus] = useState<Status | null>(null);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [snapshot, setSnapshot] = useState<{ url: string; source: Source; note?: string } | null>(null);
  const [latest, setLatest] = useState<Announcement | null>(null);
  const [history, setHistory] = useState<Announcement[]>([]);
  const [expected, setExpected] = useState<ExpectedVisitor[]>(DEFAULT_EXPECTED);
  const [speak, setSpeak] = useState(true);
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(0);
  const activityEnd = useRef<HTMLDivElement>(null);
  const latestRef = useRef<HTMLHeadingElement>(null);
  const mode = status?.mode ?? null;

  useEffect(() => {
    setExpected(load("dmd.expected", DEFAULT_EXPECTED));
    setHistory(load("dmd.history", []));
    setSpeak(load("dmd.speak", true));
    fetch("/api/ring/status")
      .then((r) => r.json())
      .then((j) => setStatus({ mode: j.mode, devices: j.devices, sources: j.sources, hasToken: j.hasToken }))
      .catch(() => setStatus({ mode: "simulator" }));
  }, []);

  const say = useCallback(
    (text: string) => {
      setLive("");
      setTimeout(() => setLive(text), 50); // re-announce even if the text repeats
      if (!speak || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    },
    [speak],
  );

  const handle = useCallback(
    (e: DoorEvent) => {
      if (e.kind === "snapshot") return setSnapshot({ url: e.dataUrl, source: e.source, note: e.note });
      if (e.kind === "announcement") {
        setLatest(e);
        setHistory((h) => {
          const next = [e, ...h.filter((x) => x.eventId !== e.eventId)].slice(0, 12);
          save("dmd.history", next);
          return next;
        });
        say(e.text);
        try {
          navigator.vibrate?.(e.category === "package" ? [120, 80, 120] : [300, 120, 300]);
        } catch {}
        return;
      }
      if (e.kind === "webhook") {
        setSnapshot(null);
        setActivity([{ ...e, key: keyRef.current++ }]);
        return;
      }
      if (e.kind === "error") setError(e.message);
      setActivity((a) => {
        // Tool rows update in place: running → done.
        if (e.kind === "tool") {
          const i = a.findIndex((x) => x.kind === "tool" && x.id === e.id && x.status === "running");
          if (i >= 0 && e.status !== "running") {
            const copy = a.slice();
            copy[i] = { ...e, key: a[i].key };
            return copy;
          }
        }
        return [...a, { ...e, key: keyRef.current++ }];
      });
    },
    [say],
  );

  // Live mode: Ring webhooks arrive server-side and stream here.
  useEffect(() => {
    if (mode !== "live") return;
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as DoorEvent;
      if (e.kind === "webhook") setRunning(true);
      if (e.kind === "done" || e.kind === "error") setRunning(false);
      handle(e);
    };
    return () => es.close();
  }, [mode, handle]);

  useEffect(() => {
    activityEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [activity]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.tagName === "INPUT") return;
      if (ev.key.toLowerCase() === "r" && latest) say(latest.text);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [latest, say]);

  const trigger = async (scenario: string) => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/sim/doorbell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, expected }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) handle(JSON.parse(line) as DoorEvent);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const updateExpected = (list: ExpectedVisitor[]) => {
    setExpected(list);
    save("dmd.expected", list);
    fetch("/api/expected", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(list) }).catch(() => {});
  };

  const counts = {
    visitors: history.filter((h) => h.category !== "package").length,
    expected: history.filter((h) => h.category === "expected_visitor").length,
    packages: history.filter((h) => h.category === "package").length,
  };

  const ringDevice = status?.sources?.devices === "ring" ? status.devices?.[0] : undefined;

  return (
    <div style={{ minHeight: "100vh", padding: "18px 22px 20px" }}>
      <a className="skip" href="#latest">
        Skip to latest announcement
      </a>
      <div aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="live-region">
        {live}
      </div>

      <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <Logo />
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.05, letterSpacing: "-0.01em", fontWeight: 700 }}>Describe My Door</h1>
          <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: 16 }}>Hear who is at your Ring doorbell. Built for blind and low-vision residents.</p>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={speak}
            onChange={(e) => {
              setSpeak(e.target.checked);
              save("dmd.speak", e.target.checked);
            }}
            style={{ width: 20, height: 20, accentColor: "var(--amber)" }}
          />
          Speak aloud
        </label>
        {mode &&
          (() => {
            // Hybrid only earns the "live device" badge when the Ring API actually answered.
            const badge = mode === "hybrid" && status?.sources?.devices !== "ring" ? MODE_BADGE.simulator : MODE_BADGE[mode];
            return (
              <span className="chip" data-testid="mode" style={{ color: badge.color, fontSize: 14, padding: "6px 14px" }} title={badge.title}>
                {badge.text}
                {mode === "hybrid" && status?.sources?.devices === "ring" && ringDevice ? ` · ${ringDevice.name}` : ""}
              </span>
            );
          })()}
      </header>

      <main style={{ display: "grid", gridTemplateColumns: "minmax(0,1.25fr) minmax(0,1fr) minmax(0,0.95fr)", gap: 16, height: "calc(100vh - 110px)", minHeight: 700 }}>
        {/* Column 1: what the resident hears */}
        <section aria-labelledby="latest" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          <div className={`panel ${latest ? "pulse" : ""}`} key={latest?.eventId ?? "none"} style={{ padding: "22px 24px", borderColor: latest ? "var(--amber)" : "var(--line)", borderWidth: latest ? 2 : 1 }} data-testid="latest">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span className="label">At your door {latest ? `· ${latest.localTime}` : ""}</span>
              {latest && (
                <span className="chip" style={{ color: latest.category === "package" ? "var(--blue)" : latest.category === "expected_visitor" ? "var(--green)" : "var(--amber)" }}>
                  {CATEGORY_TEXT[latest.category]}
                </span>
              )}
            </div>
            <h2 id="latest" ref={latestRef} tabIndex={-1} style={{ margin: "14px 0 16px", fontSize: latest ? 36 : 28, lineHeight: 1.18, fontWeight: 700, minHeight: 128 }} data-testid="announcement">
              {latest ? latest.text : running ? "Checking the door camera…" : "Nobody at the door right now."}
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <button className="btn btn-primary" onClick={() => latest && say(latest.text)} disabled={!latest} aria-keyshortcuts="R">
                <SpeakerIcon /> Repeat aloud <span style={{ opacity: 0.6, fontWeight: 400 }}>(R)</span>
              </button>
              {latest && (
                <span style={{ color: "var(--muted)", fontSize: 15 }} data-testid="chime-status">
                  Hallway Chime: {latest.chime.audioName || latest.chime.slot} · <b style={{ color: latest.chime.status === "completed" ? "var(--green)" : "var(--red)" }}>{latest.chime.status}</b>
                  {latest.chime.source === "simulated" && (
                    <span title={latest.chime.note ?? "Chime playback simulated"} style={{ color: "var(--amber)" }}>
                      {" "}
                      · simulated
                    </span>
                  )}
                </span>
              )}
            </div>
            {latest?.match && (
              <p style={{ margin: "14px 0 0", fontSize: 15, color: "var(--green)" }}>
                Matched your list: {latest.match.label} ({latest.match.window}) · saw {latest.match.clues.join(", ")}
              </p>
            )}
          </div>

          <div className="panel" style={{ padding: "16px 20px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 className="label" style={{ margin: 0 }}>
                Today
              </h3>
              <button className="btn" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => (setHistory([]), save("dmd.history", []))} disabled={!history.length}>
                Clear
              </button>
            </div>
            <p style={{ margin: "8px 0 10px", fontSize: 20, fontWeight: 700 }} data-testid="today">
              {counts.visitors} {counts.visitors === 1 ? "visitor" : "visitors"} ({counts.expected} expected) · {counts.packages} {counts.packages === 1 ? "package" : "packages"}
            </p>
            <ol className="scroll" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
              {history.map((h) => (
                <li key={h.eventId} className="rise" style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 10, fontSize: 16, lineHeight: 1.35, paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
                  <span className="mono" style={{ color: "var(--muted)", fontSize: 14, paddingTop: 2 }}>
                    {h.localTime}
                  </span>
                  <span>{h.text}</span>
                </li>
              ))}
              {!history.length && <li style={{ color: "var(--muted)" }}>Announcements will collect here.</li>}
            </ol>
          </div>
        </section>

        {/* Column 2: camera, simulator, caregiver list */}
        <section aria-label="Door camera and settings" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          <div className="panel" style={{ overflow: "hidden", position: "relative", aspectRatio: "16 / 10", flex: "none" }} data-testid="camera">
            {snapshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={snapshot.url} alt={latest?.text ?? "Doorbell camera snapshot"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} className="rise" />
            ) : (
              <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 16 }}>{running ? "Downloading snapshot…" : "Front Door camera"}</div>
            )}
            <span
              className="mono"
              data-testid="camera-source"
              title={snapshot?.note ?? undefined}
              style={{ position: "absolute", left: 12, top: 10, fontSize: 12, background: "rgba(0,0,0,.65)", padding: "3px 8px", borderRadius: 6 }}
            >
              FRONT DOOR{snapshot ? (snapshot.source === "ring" ? " · RING SNAPSHOT" : " · SAMPLE IMAGE") : ""}
            </span>
          </div>

          {mode !== "live" && (
            <div className="panel" style={{ padding: "14px 16px" }} data-testid="simulator">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <h3 className="label" style={{ margin: "0 0 4px" }}>
                  Ring simulator
                </h3>
                {ringDevice && (
                  <span className="mono" data-testid="ring-device" style={{ fontSize: 11, color: "var(--green)" }} title={`Live from GET /v1/devices · ${ringDevice.id}`}>
                    ● Ring API: {ringDevice.name}
                  </span>
                )}
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--muted)" }}>
                Sends a signed Ring webhook v1.1 event to the agent.
                {mode === "hybrid" ? " Ring can't deliver Playground events to an app, so the trigger is simulated." : ""}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {SCENARIOS.map((s) => (
                  <button key={s.id} className="btn" onClick={() => trigger(s.id)} disabled={running} data-testid={`sim-${s.id}`} style={{ fontSize: 14, padding: "8px 10px", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                    <span>{s.label}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>
                      {s.eventType}
                      {s.subType ? `:${s.subType}` : ""} · {s.localTime}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <ExpectedPanel expected={expected} onChange={updateExpected} />
        </section>

        {/* Column 3: the Strands agent at work */}
        <section aria-label="How this was decided" className="panel" style={{ padding: "16px 16px 10px", display: "flex", flexDirection: "column", minHeight: 0 }} data-testid="agent-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="label" style={{ margin: 0 }}>
              Strands agent
            </h3>
            <span style={{ fontSize: 13, color: running ? "var(--amber)" : "var(--muted)", display: "flex", gap: 8, alignItems: "center" }} data-testid="agent-status">
              {running && <span className="spinner" />}
              {running ? "agent is working" : "idle"}
            </span>
          </div>
          <p style={{ margin: "4px 0 10px", fontSize: 13, color: "var(--muted)" }}>Tools and guardrail hooks, as they run.</p>
          <div className="scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {activity.map((a) => (
              <ActivityRow key={a.key} a={a} />
            ))}
            {!activity.length && <p style={{ color: "var(--muted)", fontSize: 15 }}>Waiting for a Ring event.</p>}
            {error && (
              <p role="alert" style={{ color: "var(--red)", fontSize: 14 }}>
                {error}
              </p>
            )}
            <div ref={activityEnd} />
          </div>
        </section>
      </main>
    </div>
  );
}

function SourceTag({ source }: { source?: Source }) {
  if (!source) return null;
  return (
    <span className="mono" style={{ fontSize: 11, color: source === "ring" ? "var(--green)" : "var(--amber)", marginLeft: 6 }}>
      {source === "ring" ? "Ring API" : "simulated"}
    </span>
  );
}

function ActivityRow({ a }: { a: Activity }) {
  const base: React.CSSProperties = { borderRadius: 10, padding: "7px 10px", fontSize: 13, lineHeight: 1.35, background: "var(--panel-2)", border: "1px solid var(--line)" };
  if (a.kind === "webhook")
    return (
      <div className="rise" style={{ ...base, borderColor: "var(--amber)" }} data-testid="row-webhook">
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          Ring webhook <span className="mono">{a.eventType}{a.subType ? `:${a.subType}` : ""}</span>
          <SourceTag source={a.source} />
        </div>
        <div className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>
          {a.deviceName} · {a.localTime} · X-Signature {a.signature}
        </div>
        <div style={{ color: "var(--green)", fontWeight: 700 }}>✓ HMAC-SHA256 verified · v1.1 payload valid</div>
      </div>
    );
  if (a.kind === "tool")
    return (
      <div className="rise" style={base} data-testid={`row-tool-${a.id}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {a.status === "running" ? <span className="spinner" /> : <span style={{ color: a.status === "done" ? "var(--green)" : "var(--red)" }}>{a.status === "done" ? "✓" : "✕"}</span>}
          <span className="mono" style={{ fontWeight: 600 }}>
            {a.name}()
          </span>
          <SourceTag source={a.source} />
        </div>
        {a.detail && <div style={{ color: "var(--muted)", marginLeft: 22 }}>{a.detail}</div>}
      </div>
    );
  if (a.kind === "hook")
    return (
      <div className="rise" style={{ ...base, borderColor: a.verdict === "blocked" ? "var(--red)" : "var(--line)" }} data-testid={`row-hook-${a.verdict}`}>
        <span style={{ color: a.verdict === "blocked" ? "var(--red)" : "var(--green)", fontWeight: 700 }}>
          {a.verdict === "blocked" ? "⛔ Hook blocked" : "🛡 Hook allowed"}
        </span>{" "}
        <span className="mono">{a.rule}</span>
        <div style={{ color: "var(--muted)" }}>{a.detail}</div>
      </div>
    );
  if (a.kind === "privacy")
    return (
      <div className="rise" style={base}>
        <span style={{ color: "var(--blue)", fontWeight: 700 }}>Privacy filter</span> removed: {a.removed.join(", ")}
      </div>
    );
  if (a.kind === "done")
    return (
      <div className="rise" style={{ ...base, background: "transparent" }} data-testid="row-done">
        Done in {(a.ms / 1000).toFixed(1)} s · {a.steps} model calls
      </div>
    );
  if (a.kind === "error")
    return (
      <div style={{ ...base, borderColor: "var(--red)", color: "var(--red)" }} role="alert">
        {a.message}
      </div>
    );
  return null;
}

function ExpectedPanel({ expected, onChange }: { expected: ExpectedVisitor[]; onChange: (l: ExpectedVisitor[]) => void }) {
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("11:00");
  const [clues, setClues] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    onChange([
      ...expected,
      { id: `v${Date.now()}`, label: label.trim().slice(0, 60), from, to, clues: clues.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean).slice(0, 8) },
    ].slice(0, 10));
    setLabel("");
    setClues("");
  };
  return (
    <div className="panel" style={{ padding: "14px 16px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} data-testid="expected">
      <h3 className="label" style={{ margin: "0 0 2px" }}>
        Expected visitors · set by a caregiver
      </h3>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--muted)" }}>Matched by time and what the camera sees. Never by face.</p>
      <ul className="scroll" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
        {expected.map((v) => (
          <li key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--muted)", width: 86, flex: "none" }}>
              {v.from}–{v.to}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{v.label}</b> <span style={{ color: "var(--muted)", fontSize: 13 }}>· {v.clues.join(", ")}</span>
            </span>
            <button className="btn" style={{ padding: "2px 8px", fontSize: 13 }} aria-label={`Remove ${v.label}`} onClick={() => onChange(expected.filter((x) => x.id !== v.id))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} style={{ display: "grid", gridTemplateColumns: "1.4fr 70px 70px 1fr auto", gap: 6, marginTop: 10 }}>
        <input className="field" aria-label="Who" placeholder="Who (e.g. Plumber)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="field" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} pattern="\d{2}:\d{2}" />
        <input className="field" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} pattern="\d{2}:\d{2}" />
        <input className="field" aria-label="Clues, comma separated" placeholder="clues: toolbox, van" value={clues} onChange={(e) => setClues(e.target.value)} />
        <button className="btn" type="submit" style={{ padding: "6px 10px" }}>
          Add
        </button>
      </form>
    </div>
  );
}

function Logo() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="14" fill="var(--amber)" />
      <rect x="15" y="8" width="18" height="32" rx="9" fill="none" stroke="#1a1300" strokeWidth="3" />
      <circle cx="24" cy="29" r="4.5" fill="#1a1300" />
      <path d="M36 17c2 2 3 4.5 3 7s-1 5-3 7M40 13c3 3 4.5 7 4.5 11s-1.5 8-4.5 11" stroke="#1a1300" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      <path d="M16 8.5c1.2 1 2 2.2 2 3.5s-.8 2.5-2 3.5M18.5 5.5C20.7 7.3 22 9.6 22 12s-1.3 4.7-3.5 6.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
