import { Pause, Play } from 'lucide-react';
import type { MediaTransport, TransportState } from './media-transport.mjs';
import { usePosition } from './usePlayback';

export function PreviewFooter({ transport, playback }: { transport: MediaTransport; playback: TransportState }) {
  const position = usePosition(transport);
  return <div className="preview-footer"><button className="icon-button" disabled={!playback.duration} onClick={() => void transport.toggle()} aria-label={playback.playing ? 'Pause video' : 'Play video'} data-tip={'Play or pause\nSpace'}>{playback.playing ? <Pause size={16}/> : <Play size={16}/>}</button><input type="range" min="0" max={playback.duration || 1} step="0.01" value={position} onChange={event => transport.scrub(Number(event.target.value))} aria-label="Video playhead"/><output>{position.toFixed(1)} / {playback.duration.toFixed(1)}</output></div>;
}
