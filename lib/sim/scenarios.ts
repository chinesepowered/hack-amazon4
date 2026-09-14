// Simulated Ring events for demos without hardware. Each scenario produces a correctly shaped,
// HMAC-signed Ring webhook v1.1 payload and a snapshot the simulated image-download endpoint returns.
// Photos: Pexels License (see docs/CREDITS.md). People in them are models, not residents.

export interface Scenario {
  id: string;
  label: string;
  eventType: "button_press" | "motion_detected";
  subType?: "motion" | "human" | "vehicle" | "other_motion";
  localTime: string; // simulated wall clock, HH:MM
  image: string; // under /public
  previousPackages: number; // packages already on the porch before this event
}

export const SCENARIOS: Scenario[] = [
  { id: "delivery", label: "Doorbell: someone with a box", eventType: "button_press", localTime: "12:18", image: "/sim/delivery.jpg", previousPackages: 0 },
  { id: "neighbors", label: "Doorbell: two visitors knock", eventType: "button_press", localTime: "14:32", image: "/sim/visitors.jpg", previousPackages: 0 },
  { id: "package", label: "Motion: parcels left on the porch", eventType: "motion_detected", subType: "human", localTime: "16:47", image: "/sim/package.jpg", previousPackages: 0 },
  { id: "late-delivery", label: "Doorbell at 19:05 (nobody expected)", eventType: "button_press", localTime: "19:05", image: "/sim/delivery.jpg", previousPackages: 0 },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);
