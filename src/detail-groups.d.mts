import type { Stem } from './types';
export function descendants(stems: Stem[], parentId: string): Set<string>;
export function groupedTracks(stems: Stem[], collapsed?: Set<string>): { stem: Stem; depth: number; color: number }[];
export function initialMix(stems: Stem[], previous?: Record<string, { mute: boolean; solo: boolean; level: number; pan?: number }>, independent?: boolean): Record<string, { mute: boolean; solo: boolean; level: number; pan?: number }>;
