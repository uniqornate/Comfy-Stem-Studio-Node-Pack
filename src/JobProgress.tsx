import type { StemJob } from './types';

// A hairline on the header divider. It fills with ComfyUI's own progress when it reports one and otherwise only moves,
// so it never shows a percentage that was not measured.
export function JobProgress({ job }: { job: StemJob }) {
  if (['idle', 'complete', 'failed', 'cancelled'].includes(job.phase)) return null;
  const known = typeof job.progress === 'number';
  return <div className="heading-progress" role="progressbar" aria-label="Job progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? Math.round(job.progress! * 100) : undefined}>
    <i className={known ? '' : 'is-indeterminate'} style={known ? { transform: `scaleX(${Math.max(0.02, job.progress!)})` } : undefined}/>
  </div>;
}
