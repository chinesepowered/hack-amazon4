// Events streamed from the server to the companion app (NDJSON for the simulator, SSE for live webhooks).

export type Category = "visitor" | "expected_visitor" | "package";

export type DoorEvent =
  | {
      kind: "webhook";
      mode: "live" | "simulator";
      verified: boolean;
      requestId: string;
      eventType: string;
      subType?: string;
      deviceId: string;
      deviceName: string;
      localTime: string;
      signature: string;
    }
  | { kind: "tool"; id: string; name: string; status: "running" | "done" | "error"; detail?: string }
  | { kind: "hook"; rule: string; verdict: "allowed" | "blocked"; detail: string }
  | { kind: "snapshot"; dataUrl: string }
  | { kind: "privacy"; removed: string[] }
  | {
      kind: "announcement";
      eventId: string;
      text: string;
      category: Category;
      localTime: string;
      chime: { slot: string; audioName: string; status: string };
      match?: { label: string; window: string; clues: string[] };
    }
  | { kind: "done"; ms: number; steps: number }
  | { kind: "error"; message: string };
