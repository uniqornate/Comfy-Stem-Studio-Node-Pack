export function channelFamily(stems: { id: string; parentId?: string }[], id: string): string[];
export function removeChannels<T extends { runId?: string; stems: { id: string }[] }>(runs: T[], runId: string, ids: string[]): { runs: T[]; takeRemoved: boolean };
