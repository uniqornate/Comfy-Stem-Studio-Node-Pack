import type { SAMGuidance } from './types';
export type Box = { x: number; y: number; width: number; height: number };
export function normalizeGuidance(value: SAMGuidance, range: { start: number; end: number }): { description?: string; visualOnly: boolean; anchors: [string, number, number][]; keyframes: { time: number; box: Box }[]; predictSpans: boolean };
export function interpolatedBox(keyframes: { time: number; box: Box }[], time: number): Box | null;
