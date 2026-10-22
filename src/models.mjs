// Separation models offered as tiles. `kind` decides which panel the workspace shows.
export const MODELS = [
  { id: 'mrx', short: 'MRX', name: 'MERL MRX · adapted loudness', detail: 'Dialogue, music and effects. MIT weights. Default.', kind: 'stems' },
  { id: 'bandit', short: 'BandIt', name: 'BandIt v2 · multilingual', detail: 'Dialogue, music and effects. CC BY-SA 4.0 weights.', kind: 'stems' },
  { id: 'sfc', short: 'SFC', name: 'SFC-Locoformer', detail: 'Dialogue, music and effects. CC BY-NC-SA 4.0, non-commercial.', kind: 'stems' },
  { id: 'music6', short: '6-Stem', name: 'HTDemucs · six music stems', detail: 'Vocals, drums, bass, guitar, piano and other from a music mix. MIT weights. Piano and guitar are the weaker stems.', kind: 'music' },
  { id: 'sam', short: 'SAM', name: 'SAM Audio', detail: 'Describe or box any sound and pull it from the whole source. Experimental.', kind: 'prompt' },
  { id: 'uss', short: 'USS', name: 'USS · sound by name', detail: 'Pick one of 527 AudioSet sounds, or All, and pull them from the whole source.', kind: 'uss' },
];
export const MODEL_IDS = MODELS.map(model => model.id);
export const modelName = id => MODELS.find(model => model.id === id)?.name;
