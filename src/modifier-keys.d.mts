export type Modifiers = Readonly<{ alt: boolean; ctrl: boolean }>;
export function createModifierStore(getTarget: () => EventTarget, getDocument: () => EventTarget & { hidden?: boolean }): { getSnapshot(): Modifiers; getServerSnapshot(): Modifiers; subscribe(listener: () => void): () => void };
export const knobModifiers: ReturnType<typeof createModifierStore>;
export function waveformMode(held: Modifiers, hasVideo: boolean): 'wave' | 'row' | 'video';
