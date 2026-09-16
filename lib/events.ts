// Events streamed from the server to the companion app (NDJSON for the simulator, SSE for live webhooks).

export type Category = "visitor" | "expected_visitor" | "package";

/** Where a given piece of the run came from, so the UI can label each element honestly. */
export type Source = "ring" | "simulated";

export type DoorEvent =
  | {
      kind: "webhook";
      mode: "live" | "hybrid" | "simulator";
      verified: boolean;
      requestId: string;
      eventType: string;
      subType?: string;
      deviceId: string;
      deviceName: string;
      localTime: string;
      signature: string;
      /** Ring never delivers Playground events to a webhook URL, so in hybrid this stays "simulated". */
      source: Source;
    }
  | { kind: "tool"; id: string; name: string; status: "running" | "done" | "error"; detail?: string; source?: Source }
  | { kind: "hook"; rule: string; verdict: "allowed" | "blocked"; detail: string }
  | { kind: "snapshot"; dataUrl: string; source: Source; note?: string }
  | { kind: "privacy"; removed: string[] }
  | {
      kind: "announcement";
      eventId: string;
      text: string;
      category: Category;
      localTime: string;
      chime: { slot: string; audioName: string; status: string; source: Source; note?: string };
      match?: { label: string; window: string; clues: string[] };
    }
  | { kind: "done"; ms: number; steps: number }
  | { kind: "error"; message: string };
