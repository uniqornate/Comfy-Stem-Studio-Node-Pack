export type FloatBox = { width: number; height: number; left: number; top: number };
export const FLOAT_MIN_WIDTH: number;
export const FLOAT_VISIBLE: number;
export function clampFloat(box: FloatBox, viewport: { width: number; height: number }, visible?: number): FloatBox;
export function resizeFloat(options: { edge: string; start: FloatBox; dx: number; dy: number; ratio: number; viewport: { width: number; height: number }; minWidth?: number }): FloatBox;
