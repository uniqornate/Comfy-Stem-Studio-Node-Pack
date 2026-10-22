import { useEffect, useState } from 'react';
import type { Profile, Resources } from './types';

const gb = (bytes: number) => (bytes / 1073741824).toFixed(1);
export function ResourceMonitor({ profile }: { profile: Profile }) {
  const [value, setValue] = useState<Resources | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setValue(null);
    const poll = async () => {
      try {
        const result = await window.desktop?.resources(profile);
        if (alive) setValue(result || null);
      } catch { if (alive) setValue(null); }
      if (alive) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [profile.comfyUrl]);
  const memory = (name: 'vram' | 'ram') => {
    const item = value?.[name];
    const label = name === 'vram' ? 'VRAM' : 'RAM';
    return <div className={`tele-card ${item ? '' : 'off'}`} data-tip={item ? `${label}\n${gb(item.used)} of ${gb(item.total)} GiB in use on the selected ComfyUI.` : `${label}\nUnavailable. Check the ComfyUI connection.`}><small>{label}</small><strong>{item ? <>{gb(item.used)}<i> / {gb(item.total)} G</i></> : 'n/a'}</strong><b style={{ width: `${item ? Math.min(100, item.used / item.total * 100) : 0}%` }}/></div>;
  };
  const gpu = value?.gpuTemperature, cpu = value?.cpuTemperature, load = value?.cpuLoad;
  return <div className={`telemetry ${value?.online ? 'available' : ''}`} aria-label="Selected ComfyUI resources">
    {memory('vram')}{memory('ram')}
    <div className={`tele-card ${gpu == null ? 'off' : ''} ${gpu != null && gpu >= 85 ? 'hot' : ''}`} data-tip={gpu == null ? 'GPU temperature\nUnavailable. Needs NVIDIA NVML on the selected ComfyUI.' : 'GPU temperature\nReported by NVIDIA NVML on the selected ComfyUI.'}><small>GPU °C</small><strong>{gpu == null ? 'n/a' : `${Math.round(gpu)}°`}</strong></div>
    <div className={`tele-card ${load == null && cpu == null ? 'off' : ''} ${cpu != null && cpu >= 90 ? 'hot' : ''}`} data-tip={cpu == null ? 'CPU load\nShared processor load on the ComfyUI machine. Windows does not expose CPU temperature without a hardware monitor driver.' : 'CPU load and temperature\nOn the ComfyUI machine.'}><small>{cpu == null ? 'CPU %' : 'CPU %/°C'}</small><strong>{load == null ? (cpu == null ? 'n/a' : `${Math.round(cpu)}°`) : <>{Math.round(load)}<i>{cpu != null ? ` · ${Math.round(cpu)}°` : '%'}</i></>}</strong>{load != null && <b style={{ width: `${Math.min(100, load)}%` }}/>}</div>
  </div>;
}
