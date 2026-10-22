export type Tracker = { started: number; base: { vram: number | null; ram: number | null }; peak: { vram: number; ram: number; cpu: number | null }; seen: { vram: boolean; ram: boolean } };
export type Usage = { vram: number | null; ram: number | null; cpu: number | null; seconds: number; at: number };
export function startTracker(sample: unknown, now?: number): Tracker;
export function sampleTracker(tracker: Tracker, sample: unknown): Tracker;
export function finishTracker(tracker: Tracker, now?: number): Usage;
export function readUsage(raw: string | null): Record<string, Usage>;
export function remember(usage: Record<string, Usage>, key: string, entry: Usage): Record<string, Usage>;
