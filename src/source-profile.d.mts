export type SourceProfile = { kind: 'dialogue' | 'music' | 'effects' | 'mixed' | 'silent'; confidence: number; features: Record<string, number> };
export function analyzeSource(samples: Float32Array, rate: number, seconds?: number): SourceProfile | null;
export function suggestModel(profile: SourceProfile | null): { model: string; text: string; detail: string } | null;
