export const GRAIN_TILE: number;
export const BLENDS: string[];
export type GrainParams = { on: boolean; opacity: number; size: number; amount: number; mono: boolean; blend: string; animate: boolean; fps: number; seed: number };
export const GRAIN_DEFAULTS: GrainParams;
export function cleanGrain(value: unknown): GrainParams;
export function rng(seed: number): () => number;
export function noiseTile(params: Partial<GrainParams>, size?: number): Uint8ClampedArray<ArrayBuffer>;
