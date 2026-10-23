import type { ChannelEdit } from './clip-edits.mjs';
export type MixPlanItem = { id: string; level: number; pan: number; segments: { start: number; end: number; gain: number; source?: number }[] };
export function mixPlan(options: { tracks: { id: string; duration: number }[]; mix: Record<string, { mute: boolean; level: number; pan?: number }>; edits?: Record<string, ChannelEdit>; duration: number; selected?: string[] }): MixPlanItem[];
export function encodeWav(samples: Float32Array | Float32Array[], rate: number, bits?: 16 | 24 | 32): Uint8Array;
