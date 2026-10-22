export type ModelKind = 'stems' | 'prompt' | 'uss' | 'music';
export type ModelInfo = { id: string; short: string; name: string; detail: string; kind: ModelKind };
export const MODELS: ModelInfo[];
export const MODEL_IDS: string[];
export function modelName(id: string): string | undefined;
