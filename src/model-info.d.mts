export type ModelInfoRow = { key: string; name: string; role: string; disk: number | null; diskNote?: string; runs: string; work: string; license: string };
export const MODEL_INFO: ModelInfoRow[];
export function formatBytes(bytes: number | null): string;
