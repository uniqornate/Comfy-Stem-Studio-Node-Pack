export function channelFamily(stems: { id: string; parentId?: string }[], id: string): string[];
export function removeChannels<T extends { runId?: string; stems: { id: string }[] }>(runs: T[], runId: string, ids: string[]): { runs: T[]; takeRemoved: boolean };
export function ungroupDetails<T extends { runId?: string; stems: { parentId?: string }[] }>(runs: T[], runId: string, parentId: string): T[];
