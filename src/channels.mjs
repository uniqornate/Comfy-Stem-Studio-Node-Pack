import { descendants } from './detail-groups.mjs';
// A channel together with every detail channel extracted from it.
export const channelFamily = (stems, id) => [id, ...descendants(stems, id)];
// Removes channels from one take; a take left empty disappears. Files on disk are never touched.
export function removeChannels(runs, runId, ids) {
  const remove = new Set(ids);
  const next = runs.map(run => run.runId === runId ? { ...run, stems: run.stems.filter(stem => !remove.has(stem.id)) } : run).filter(run => run.stems.length);
  return { runs: next, takeRemoved: !next.some(run => run.runId === runId) };
}
