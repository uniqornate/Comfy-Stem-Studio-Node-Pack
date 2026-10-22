export type TransportState = { position: number; duration: number; playing: boolean; buffering: boolean; mode: string; error: string; selection: { start: number; end: number } | null; loopLocked: boolean };
export class MediaTransport {
  constructor(options?: { requestFrame?: (callback: () => void) => number; cancelFrame?: (id: number) => void });
  snapshot(): TransportState;
  restore(state?: { position?: number; duration?: number; selection?: { start: number; end: number } | null; loopLocked?: boolean }): void;
  subscribe(callback: (state: TransportState) => void): () => void;
  attachVideo(video: HTMLVideoElement | null): void;
  setAudio(context: AudioContext | null, tracks: { stem: { id: string }; buffer: AudioBuffer | null }[], mix: Record<string, { mute: boolean; solo: boolean; level: number }>): void;
  setMix(mix: Record<string, { mute: boolean; solo: boolean; level: number }>): void;
  setEdits(edits: Record<string, import('./clip-edits.mjs').ChannelEdit>): void;
  level(id: string): number;
  setMetering(on: boolean): void;
  setTracks(tracks: { stem: { id: string }; buffer: AudioBuffer | null }[]): void;
  setMode(mode: 'original' | 'stems'): void;
  setSelection(from: number, to: number): void; commitSelection(): void | Promise<void>; clearSelection(): void; setLoopLocked(locked: boolean): void;
  play(): Promise<void>; pause(): void; toggle(): void | Promise<void>; seek(value: number): void; scrub(value: number): void;
  dispose(): void;
}
