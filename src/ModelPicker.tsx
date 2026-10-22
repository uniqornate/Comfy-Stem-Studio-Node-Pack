import type { ReactElement } from 'react';
import { AudioWaveform, Film, Layers, Music4, ScanSearch, Sparkles } from 'lucide-react';
import { MODELS } from './models.mjs';

const icons: Record<string, ReactElement> = { mrx: <Film size={20}/>, bandit: <Music4 size={20}/>, sfc: <AudioWaveform size={20}/>, music6: <Layers size={20}/>, sam: <Sparkles size={20}/>, uss: <ScanSearch size={20}/> };
export function ModelPicker({ value, onChange, disabled, installed }: { value: string; onChange: (id: string) => void; disabled: boolean; installed: Record<string, boolean | undefined> }) {
  return <div className="model-picker" role="radiogroup" aria-label="Separation model">
    {MODELS.map(model => {
      const missing = installed[model.id] === false;
      return <button key={model.id} type="button" role="radio" aria-checked={value === model.id} className={`model-tile ${value === model.id ? 'is-selected' : ''} ${missing ? 'is-missing' : ''}`} disabled={disabled} onClick={() => onChange(model.id)} data-tip={`${model.name}\n${missing ? 'Not available yet. Open it to see what is missing. ' : ''}${model.detail}`} aria-label={model.name}>
        {icons[model.id]}<span>{model.short}</span>
      </button>;
    })}
  </div>;
}
