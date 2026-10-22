export type History<T> = { past: T[]; future: T[] };
export function emptyHistory<T>(): History<T>;
export function record<T>(history: History<T>, snapshot: T, limit?: number): History<T>;
export function undo<T>(history: History<T>, current: T): { state: T; history: History<T> } | null;
export function redo<T>(history: History<T>, current: T): { state: T; history: History<T> } | null;
