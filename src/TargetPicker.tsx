import { useState } from 'react';
import catalog from './sound-targets.json';

export const presets: Record<string, string[]> = {
  Actions: ['Walk, footsteps', 'Door', 'Knock', 'Tap', 'Clapping', 'Typing', 'Writing', 'Glass', 'Keys jangling'],
  People: ['Speech', 'Whispering', 'Breathing', 'Cough', 'Laughter', 'Crying, sobbing', 'Sigh'],
  Nature: ['Rain', 'Wind', 'Water', 'Fire', 'Bird', 'Dog', 'Insect', 'Thunder'],
  Machines: ['Car', 'Engine', 'Motorcycle', 'Train', 'Airplane', 'Telephone', 'Alarm', 'Clock', 'Gunshot, gunfire'],
  Music: ['Music', 'Piano', 'Guitar', 'Drum', 'Violin, fiddle', 'Singing'],
};
// Category tabs, a filter and the grid of AudioSet sound names. `withAll` adds the "every detected sound" choice.
export function TargetPicker({ target, setTarget, withAll = false, installed }: { target: string; setTarget: (value: string) => void; withAll?: boolean; installed?: string[] }) {
  const [category, setCategory] = useState('Actions'), [filter, setFilter] = useState('');
  const known = (name: string) => catalog.includes(name) && (!installed || installed.includes(name));
  const choices = filter ? catalog.filter(name => known(name) && name.toLowerCase().includes(filter.toLowerCase())) : category === 'All sounds' ? catalog.filter(known) : presets[category].filter(known);
  return <>
    <div className="target-categories" role="group" aria-label="Sound categories">{[...Object.keys(presets), 'All sounds'].map(name => <button key={name} aria-pressed={category === name} onClick={() => { setCategory(name); setFilter(''); }}>{name}</button>)}</div>
    <input className="target-search" placeholder="Filter sounds (optional)" aria-label="Filter sound choices" value={filter} onChange={event => setFilter(event.target.value)}/>
    <div className="target-grid" role="group" aria-label="Target sound">{withAll && (!installed || installed.includes('All')) && <button aria-pressed={target === 'All'} onClick={() => setTarget('All')}>All detected sounds</button>}{choices.map(name => <button key={name} aria-pressed={target === name} onClick={() => setTarget(name)}>{name}</button>)}{!choices.length && <p>No matching sounds.</p>}</div>
  </>;
}
