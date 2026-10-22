export type MixEntry = { mute: boolean; solo: boolean; level: number; restoreMute?: boolean };
export type Mix = Record<string, MixEntry>;
export function toggleSolo(mix: Mix, id: string, additive?: boolean): Mix;
export function toggleMute(mix: Mix, id: string): Mix;
export function normalizeSolo(mix: Mix): Mix;
