import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, Monitor, Layers, Mic, Paintbrush, Trash2, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Minimize2, Repeat2, LockKeyhole, X, ChevronDown, ChevronRight, Crosshair, ScanSearch, Film, Scissors } from 'lucide-react';
import { fitEdit as channelEdit, splitEdit, trimEdit, moveEdit, placedStart, gainEdit, gainAt, placeCopy, clipAt, removeClip, type ChannelEdit } from './clip-edits.mjs';
import { pointerTime } from './timeline-geometry.mjs';
import { groupedTracks, initialMix } from './detail-groups.mjs';
import { WaveformKnob } from './WaveformKnob';
import { LevelKnob } from './LevelKnob';
import type { Stem, TimelineView } from './types';
import { MediaTransport, type TransportState } from './media-transport.mjs';
import { usePosition } from './usePlayback';
import { clampRow, knobFromRow, ROW_DEFAULT, rowFromKnob } from './row-height.mjs';
import { channelFamily } from './channels.mjs';
import { MixExportModal } from './MixExportModal';
import { pageZoom } from './page-zoom.mjs';
import type { MixExportOptions } from './types';
import { emptyHistory, record, undo, redo, type History } from './history.mjs';
import { toggleMute, toggleSolo, normalizeSolo } from './solo.mjs';

type Mix = { mute: boolean; solo: boolean; level: number; restoreMute?: boolean };
type Snapshot = { mix: Record<string, Mix>; edits: Record<string, ChannelEdit> };
type Take = { id: string; label: string };
// `buffer` is null for a channel that is not audible and would not fit in the preview memory budget; it is decoded again when needed.
type Track = { stem: Stem; buffer: AudioBuffer | null; duration: number; channels: number; rate: number; peaks: number[]; path: string; peak: number };
type Props = { renameChannel: (id: string, label: string) => void; deleteChannels: (ids: string[]) => void; brushAvailable: boolean; onBrush: (region: { start: number; end: number }) => void; closeTake: (id: string, others?: boolean) => void; freshIds?: ReadonlySet<string>; externalPreview?: boolean; bringPreviewBack?: () => void; useAsReference: (stem: Stem) => void; exportMixFile: (options: MixExportOptions) => Promise<string | null>; sourceName: string; takes: Take[]; selectedTake: string; selectTake: (id: string) => void; canExportVideo: boolean; initialView?: TimelineView; onViewChange: (view: TimelineView) => void; stems: Stem[]; save: (id?: string) => void; exporting: boolean; independent?: boolean; transport: MediaTransport; playback: TransportState; exportVideo: (mix: Record<string, Mix>) => void; expanded: boolean; toggleExpanded: () => void; resize: (delta: number) => void; resetSize: () => void; workspaceHeight: number; resizeBounds: { min: number; max: number }; details: (stem: Stem, start: number, end: number, picker: boolean) => void; detailBusy: boolean; detailAvailable: boolean };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
function peaks(buffer: AudioBuffer) {
  const count = Math.min(2200, buffer.length), result = new Array(count).fill(0);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const pcm = buffer.getChannelData(ch);
    for (let i = 0; i < pcm.length; i++) { const index = Math.min(count - 1, Math.floor(i * count / pcm.length)); result[index] = Math.max(result[index], Math.abs(pcm[i])); }
  }
  return result;
}
const PREVIEW_BUDGET = 768 * 1024 * 1024;
const audibleIn = (mix: Record<string, Mix>, id: string) => { const value = mix[id]; return !!value && !value.mute && (!Object.values(mix).some(item => item.solo) || value.solo); };
async function decodeStem(ctx: AudioContext, stem: Stem, signal?: AbortSignal) {
  const response = await fetch(stem.url, { signal });
  if (!response.ok) throw Error(`Could not load ${stem.label} waveform.`);
  return ctx.decodeAudioData(await response.arrayBuffer());
}
type Gain = { start: number; end: number; db: number };
const NO_GAINS: Gain[] = [];
// While a range is dragged its overlay follows these CSS variables, so the lanes are not re-rendered on every move.
const dragStyle = { left: 'var(--sel-left, 0%)', width: 'var(--sel-width, 0%)' };
// Draws a clip's waveform. Regions with a gain change are drawn at their new size, on top of the global height knob,
// so the picture always shows what the volume line is doing.
const ClipWave = memo(function ClipWave({ label, data, peak, path, duration, clip, gains }: { label: string; data: number[]; peak: number; path: string; duration: number; clip: { start: number; end: number; offset?: number }; gains: Gain[] }) {
  const shift = clip.offset || 0;
  const total = Math.max(duration, .001), first = Math.floor(clip.start / total * data.length), last = Math.min(data.length, Math.ceil(clip.end / total * data.length));
  const active = gains.filter(region => region.db !== 0 && region.end > clip.start + shift && region.start < clip.end + shift);
  const d = useMemo(() => {
    if (!active.length) return path;
    const parts: string[] = [];
    // The whole source is drawn, not only the clip's window, so trimming a clip back out finds the picture already there.
    for (let i = 0; i < data.length; i++) {
      const time = (i + .5) / data.length * total + shift, region = active.find(item => time >= item.start && time < item.end);
      const level = Math.min(16, data[i] / peak * (region ? 10 ** (region.db / 20) : 1));
      parts.push(`M${i},${40 - level * 40}v${level * 80}`);
    }
    return parts.join(' ');
  }, [active.map(region => `${region.start}:${region.end}:${region.db}`).join('|'), path, data, peak, first, last, total, shift]);
  const view = `${clip.start / total * data.length} 0 ${(clip.end - clip.start) / total * data.length} 80`;
  return <svg viewBox={view} data-view={view} preserveAspectRatio="none" aria-label={`${label} audio waveform`}><path style={{ transform: 'scaleY(var(--wave-height, .7))', transformOrigin: 'center', transformBox: 'view-box' }} d={d} fill="none" stroke="currentColor" strokeWidth="1"/></svg>;
});
function TimelineScrub({ transport, duration }: { transport: MediaTransport; duration: number }) {
  const position = usePosition(transport);
  return <input className="timeline-scrub" type="range" min="0" max={duration || 1} step="0.01" value={position} onChange={event => transport.scrub(Number(event.target.value))} aria-label="Timeline playhead"/>;
}
export function StemTimeline({ renameChannel, deleteChannels, brushAvailable, onBrush, closeTake, freshIds, externalPreview, bringPreviewBack, useAsReference, exportMixFile, sourceName, takes, selectedTake, selectTake, canExportVideo, initialView, onViewChange, stems, save, exporting, independent = false, transport, playback, exportVideo, expanded, toggleExpanded, resize, resetSize, workspaceHeight, resizeBounds, details, detailBusy, detailAvailable }: Props) {
  const [tracks, setTracks] = useState<Track[]>([]), [mix, setMix] = useState<Record<string, Mix>>(() => normalizeSolo(initialView?.mix || {}));
  const mixRef = useRef(mix); mixRef.current = mix;
  const cache = useRef(new Map<string, Track>()), ctxRef = useRef<AudioContext | null>(null);
  const [edits, setEdits] = useState<Record<string, ChannelEdit>>(initialView?.edits || {});
  const editsRef = useRef(edits); editsRef.current = edits;
  const history = useRef<History<Snapshot>>(emptyHistory());
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const syncHistory = () => setHistoryState({ undo: history.current.past.length > 0, redo: history.current.future.length > 0 });
  const remember = () => { history.current = record(history.current, { mix: mixRef.current, edits: editsRef.current }); syncHistory(); };
  const travel = (direction: 'undo' | 'redo') => {
    const result = (direction === 'undo' ? undo : redo)(history.current, { mix: mixRef.current, edits: editsRef.current });
    if (!result) return;
    history.current = result.history; syncHistory(); setMix(result.state.mix); setEdits(result.state.edits);
  };
  const travelRef = useRef(travel); travelRef.current = travel;
  const [mixOpen, setMixOpen] = useState(false);
  const [brushMode, setBrushMode] = useState(false);
  const brushRef = useRef({ brushMode, onBrush, available: brushAvailable }); brushRef.current = { brushMode, onBrush, available: brushAvailable };
  useEffect(() => { if (!brushAvailable) setBrushMode(false); }, [brushAvailable]);
  useEffect(() => {
    if (!brushMode) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) setBrushMode(false); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [brushMode]);
  // In brush mode, holding Alt lights up the whole timeline; one click then brushes all of it.
  useEffect(() => {
    const root = section.current; if (!root || !brushMode) return;
    const mark = (event: KeyboardEvent) => root.classList.toggle('is-brush-all', event.altKey), clear = () => root.classList.remove('is-brush-all');
    window.addEventListener('keydown', mark); window.addEventListener('keyup', mark); window.addEventListener('blur', clear);
    return () => { clear(); window.removeEventListener('keydown', mark); window.removeEventListener('keyup', mark); window.removeEventListener('blur', clear); };
  }, [brushMode]);
  const [takeMenu, setTakeMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!takeMenu) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element)?.closest('.take-menu')) setTakeMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setTakeMenu(null); };
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key); };
  }, [takeMenu]);
  const tabs = useRef<HTMLDivElement>(null);
  const tabPan = useRef<{ x: number; left: number } | null>(null);
  const [tabFade, setTabFade] = useState({ left: false, right: false });
  const measureTabs = () => { const el = tabs.current; if (el) setTabFade({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 }); };
  useEffect(() => {
    const el = tabs.current; if (!el) return;
    const observer = new ResizeObserver(measureTabs); observer.observe(el); measureTabs();
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey) return; event.preventDefault(); el.scrollLeft += event.deltaY || event.deltaX; };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); el.removeEventListener('wheel', wheel); };
  }, []);
  useEffect(() => { measureTabs(); tabs.current?.querySelector('.is-selected')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }, [takes.length, selectedTake]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(initialView?.collapsed || []));
  const [menu, setMenu] = useState<{ stem: Stem; at: number; x: number; y: number } | null>(null);
  const [waveHeight, setWaveHeight] = useState(Math.max(.1, Math.min(1, initialView?.waveHeight ?? .7))), [zoom, setZoom] = useState(Math.max(1, Math.min(8, initialView?.zoom || 1)));
  const [rowHeight, setRowHeight] = useState(clampRow(initialView?.rowHeight ?? ROW_DEFAULT)), [rowHeights, setRowHeights] = useState<Record<string, number>>(() => Object.fromEntries(Object.entries(initialView?.rowHeights || {}).map(([id, px]) => [id, clampRow(px)])));
  const [picked, setPicked] = useState<Set<string>>(new Set()), pickAnchor = useRef('');
  const [pickedClip, setPickedClip] = useState<{ stem: string; id: string } | null>(null);
  function deleteClip(stemId: string, id: string) { remember(); setEdits(previous => ({ ...previous, [stemId]: removeClip(previous[stemId], id, duration) })); setPickedClip(null); }
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [deleteAsk, setDeleteAsk] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [dragRange, setDragRange] = useState(false);
  const dragEnds = useRef({ anchor: 0, at: 0 });
  const rowGrip = useRef<{ y: number; height: number; id: string; track: HTMLElement } | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [panning, setPanning] = useState(false);
  const { duration, playing, selection, loopLocked } = playback;
  const section = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const viewRef = useRef<TimelineView>({ mix, collapsed: [...collapsed], zoom, waveHeight, rowHeight, rowHeights, scrollLeft: initialView?.scrollLeft || 0, scrollTop: initialView?.scrollTop || 0 });
  viewRef.current = { ...viewRef.current, mix, edits, collapsed: [...collapsed], zoom, waveHeight, rowHeight, rowHeights };
  useEffect(() => { onViewChange(viewRef.current); }, [mix, edits, collapsed, zoom, waveHeight, rowHeight, rowHeights, onViewChange]);
  useEffect(() => { setPicked(previous => { const keep = new Set([...previous].filter(id => stems.some(stem => stem.id === id))); return keep.size === previous.size ? previous : keep; }); }, [stems.map(stem => stem.id).join(',')]);
  const deleteFamily = (ids: string[]) => [...new Set(ids.flatMap(id => channelFamily(stems, id)))];
  const askDelete = (ids: string[], x: number, y: number) => { if (ids.length) setDeleteAsk({ x: Math.max(4, Math.min(x, window.innerWidth - 240)), y: Math.max(4, Math.min(y, window.innerHeight - 170)), ids }); };
  const pickedRef = useRef({ picked, ask: false, askDelete, clip: pickedClip, deleteClip }); pickedRef.current = { picked, ask: !!deleteAsk, askDelete, clip: pickedClip, deleteClip };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const state = pickedRef.current;
      if ((!state.picked.size && !state.clip) || event.ctrlKey || event.altKey || document.querySelector('.modal-backdrop') || (event.target as HTMLElement)?.matches('input:not([type=range]),textarea,select,[contenteditable=true]')) return;
      // A selected clip is deleted first; otherwise the selected channels are.
      if (event.key === 'Delete' && !event.repeat && !state.ask) {
        event.preventDefault();
        if (state.clip) { state.deleteClip(state.clip.stem, state.clip.id); return; }
        const box = section.current?.getBoundingClientRect(); state.askDelete([...state.picked], (box?.left || 0) + 260, (box?.top || 0) + 120);
      }
      else if (event.key === 'Escape' && !state.ask) { setPicked(new Set()); setPickedClip(null); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!deleteAsk) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element)?.closest('.delete-confirm')) setDeleteAsk(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setDeleteAsk(null); };
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key); };
  }, [deleteAsk]);
  useEffect(() => { setEdits(previous => { const keep = Object.fromEntries(Object.entries(previous).filter(([id]) => stems.some(stem => stem.id === id))); return Object.keys(keep).length === Object.keys(previous).length ? previous : keep; }); }, [stems.map(stem => stem.id).join(',')]);
  // The playhead moves through a CSS variable, so playback never re-renders the track rows.
  useEffect(() => transport.subscribe(state => section.current?.style.setProperty('--playhead', String(state.duration ? Math.min(100, state.position / state.duration * 100) : 0))), [transport]);
  // Level meters are optional (a toolbar toggle) and light: about 20 reads per second, only for rows in view, one
  // transform per bar. The transport creates analysers only while metering is on.
  const [metering, setMetering] = useState(() => { try { return localStorage.getItem('channelMeters') !== 'off'; } catch { return true; } });
  useEffect(() => { transport.setMetering(metering); try { localStorage.setItem('channelMeters', metering ? 'on' : 'off'); } catch {} }, [metering, transport]);
  useEffect(() => {
    const root = section.current; if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>('.channel-meter')].map(el => ({ el, id: el.dataset.meter!, bar: el.firstElementChild as HTMLElement, text: root.querySelector<HTMLElement>(`[data-db="${CSS.escape(el.dataset.meter!)}"]`), shown: 0, label: '\u0000', visible: true, hot: false }));
    const draw = (item: (typeof items)[number], fraction: number) => {
      item.bar.style.transform = `scaleX(${fraction.toFixed(3)})`;
      const hot = fraction > 0.9; if (hot !== item.hot) { item.hot = hot; item.bar.style.background = hot ? '#ff5d5d' : ''; }
      const label = fraction > 0.01 ? String(Math.round(fraction * 60 - 60)) : ''; if (item.text && item.label !== label) { item.text.textContent = label; item.label = label; }
    };
    if (!playing || !metering) { items.forEach(item => draw(item, 0)); return; }
    const observer = new IntersectionObserver(entries => { for (const entry of entries) { const item = items.find(candidate => candidate.el === entry.target); if (item) item.visible = entry.isIntersecting; } }, { root: scroll.current });
    items.forEach(item => observer.observe(item.el));
    let frame = 0, last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 50) return;
      const elapsed = Math.min(0.2, (now - last) / 1000); last = now;
      for (const item of items) {
        if (!item.visible) continue;
        const level = transport.level(item.id), db = level > 0.00001 ? 20 * Math.log10(level) : -120;
        item.shown = Math.max(Math.max(0, Math.min(1, (db + 60) / 60)), item.shown - elapsed * 0.9); draw(item, item.shown);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [playing, metering, tracks, collapsed, transport]);
  useEffect(() => { if (scroll.current && !loading) { scroll.current.scrollLeft = viewRef.current.scrollLeft; scroll.current.scrollTop = viewRef.current.scrollTop; } }, [loading]);
  const editDrag = useRef<{ kind: 'gain' | 'start' | 'end' | 'move' | 'copy'; stem: Stem; id?: string; y: number; db: number; grab: number; initial: ChannelEdit; rect: DOMRect; element?: HTMLElement | null; wave?: { pxPerSecond: number }; latest?: ChannelEdit; copyId?: string } | null>(null);
  const editFrame = useRef<number | null>(null);
  const [gainDragging, setGainDragging] = useState(false);
  const dragSnapshot = useRef<Snapshot | null>(null);
  const gesture = useRef<{ kind: 'seek' | 'select'; anchor: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const resizeY = useRef<number | null>(null);
  const rangeStyle = { left: `${duration && selection ? selection.start / duration * 100 : 0}%`, width: `${duration && selection ? (selection.end - selection.start) / duration * 100 : 0}%` };
  const signature = stems.map(stem => stem.id).join(',');
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element)?.closest('.timeline-context-menu')) setMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key); };
  }, [menu]);
  useEffect(() => {
    transport.pause(); transport.setAudio(null, [], {}); setTracks([]); setError(''); setMenu(null);
    for (const id of cache.current.keys()) if (!stems.some(stem => stem.id === id)) cache.current.delete(id);
    const previousMix = mixRef.current;
    if (!stems.length) { setLoading(false); setMix({}); return; }
    let disposed = false; const controller = new AbortController(), ctx = new AudioContext(); setLoading(true); ctxRef.current = ctx;
    (async () => {
      const decoded: Track[] = []; let memory = 0;
      const planned = normalizeSolo(initialMix(stems, previousMix, independent));
      for (const stem of stems) {
        if (stem.missing) continue;
        const cached = cache.current.get(stem.id), want = audibleIn(planned, stem.id);
        let track = cached;
        if (!track || (want && !track.buffer)) {
          const buffer = await decodeStem(ctx, stem, controller.signal);
          if (disposed) return;
          const data = peaks(buffer), peak = Math.max(0.000001, ...data);
          const path = data.map((value, i) => `M${i},${40 - Math.min(1, value / peak) * 40}v${Math.min(1, value / peak) * 80}`).join(' ');
          track = { stem, buffer, duration: buffer.duration, channels: buffer.numberOfChannels, rate: buffer.sampleRate, peaks: data, path, peak };
        }
        if (track.buffer) {
          const bytes = track.buffer.length * track.buffer.numberOfChannels * 4;
          if (want && memory + bytes > PREVIEW_BUDGET) throw Error('Preview memory limit reached by the audible channels. Mute some channels or download them instead.');
          if (want) memory += bytes; else track = { ...track, buffer: null };
        }
        cache.current.set(stem.id, track); decoded.push(track);
      }
      if (!disposed) { setTracks(decoded); setMix(planned); transport.setAudio(ctx, decoded, planned); }
    })().catch(cause => { if (!disposed) setError(cause.message); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; controller.abort(); transport.pause(); transport.setAudio(null, [], {}); void ctx.close(); };
  }, [signature, independent, transport]);
  // A channel that was left out of memory is decoded when it becomes audible; muted ones are dropped again when memory runs short.
  const loadingCold = useRef(false);
  useEffect(() => {
    const ctx = ctxRef.current; if (!ctx || loading || loadingCold.current) return;
    const need = tracks.filter(track => !track.buffer && audibleIn(mix, track.stem.id));
    if (!need.length) return;
    let cancelled = false; loadingCold.current = true;
    (async () => {
      const loaded = new Map<string, AudioBuffer>();
      for (const track of need) { const buffer = await decodeStem(ctx, track.stem); if (cancelled) return; loaded.set(track.stem.id, buffer); }
      let list = tracks.map(track => loaded.has(track.stem.id) ? { ...track, buffer: loaded.get(track.stem.id)! } : track);
      const bytes = (track: Track) => track.buffer ? track.buffer.length * track.buffer.numberOfChannels * 4 : 0;
      let total = list.reduce((sum, track) => sum + bytes(track), 0);
      list = list.map(track => { if (total > PREVIEW_BUDGET && track.buffer && !audibleIn(mix, track.stem.id)) { total -= bytes(track); return { ...track, buffer: null }; } return track; });
      if (total > PREVIEW_BUDGET) throw Error('Preview memory limit reached by the audible channels. Mute some channels or download them instead.');
      for (const track of list) cache.current.set(track.stem.id, track);
      setTracks(list); transport.setTracks(list);
    })().catch(cause => { if (!cancelled) setError(cause.message); }).finally(() => { loadingCold.current = false; });
    return () => { cancelled = true; loadingCold.current = false; };
  }, [mix, tracks, loading, transport]);
  useEffect(() => { transport.setMix(mix); }, [mix, transport]);
  useEffect(() => { transport.setEdits(edits); }, [edits, transport]);
  // Rename a channel in place: double-click its name or press Ctrl+R over it (or with it selected).
  const startRename = useRef((_id: string) => {});
  startRename.current = id => { const stem = stems.find(item => item.id === id); if (stem) setRenaming({ id, value: stem.label }); };
  const finishRename = (commit: boolean) => { if (renaming && commit && renaming.value.trim()) renameChannel(renaming.id, renaming.value); setRenaming(null); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'r' || document.querySelector('.modal-backdrop') || (event.target as HTMLElement)?.matches('input,textarea,select,[contenteditable=true]')) return;
      const picks = [...pickedRef.current.picked], target = picks.length === 1 ? picks[0] : hoverStem.current;
      if (!target) return;
      event.preventDefault(); if (!event.repeat) startRename.current(target);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const hoverStem = useRef(''), clipboard = useRef<{ stemId: string; clip: { id: string; start: number; end: number; offset?: number } } | null>(null);
  const notice = (text: string) => { setError(text); setTimeout(() => setError(previous => previous === text ? '' : previous), 3500); };
  const copyKeys = useRef((_kind: 'copy' | 'paste') => {});
  copyKeys.current = kind => {
    const picks = [...pickedRef.current.picked], target = picks.length === 1 ? picks[0] : hoverStem.current || clipboard.current?.stemId || '', position = transport.snapshot().position, total = transport.snapshot().duration;
    if (!target || !total) return;
    if (kind === 'copy') {
      const clip = clipAt(editsRef.current[target], position, total);
      if (!clip) { notice('Put the playhead over a clip, or hover the channel, then press Ctrl+C.'); return; }
      clipboard.current = { stemId: target, clip }; notice(`Copied a clip from ${stems.find(stem => stem.id === target)?.label || 'the channel'}. Ctrl+V pastes it at the playhead.`);
    } else {
      if (!clipboard.current) return;
      const result = placeCopy(editsRef.current[target], clipboard.current.clip, position, total);
      if (!result) { notice('There is no free space for that clip in this channel.'); return; }
      remember(); setEdits(previous => ({ ...previous, [target]: result.edit })); setPickedClip({ stem: target, id: result.id });
    }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || document.querySelector('.modal-backdrop') || (event.target as HTMLElement)?.matches('input:not([type=range]),textarea,select,[contenteditable=true]')) return;
      const k = event.key.toLowerCase();
      if (k !== 'c' && k !== 'v') return;
      if (k === 'c' && window.getSelection()?.toString()) return;
      event.preventDefault(); if (!event.repeat) copyKeys.current(k === 'c' ? 'copy' : 'paste');
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const splitAll = useRef(() => {});
  splitAll.current = () => { remember(); setEdits(previous => Object.fromEntries(stems.map(stem => [stem.id, splitEdit(previous[stem.id], transport.snapshot().position, duration)]))); };
  useEffect(() => { const key = (event: KeyboardEvent) => { if (!event.ctrlKey || event.altKey || document.querySelector('.modal-backdrop') || (event.target as HTMLElement)?.matches('input:not([type=range]),textarea,[contenteditable=true]')) return; const k = event.key.toLowerCase(); if (k === 'z' || k === 'y') { event.preventDefault(); if (!event.repeat) travelRef.current(k === 'y' || event.shiftKey ? 'redo' : 'undo'); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || document.querySelector('.modal-backdrop') || (event.target as HTMLElement)?.matches('input:not([type=range]),textarea,select,[contenteditable=true]')) return;
      if (event.altKey || event.repeat) return;
      if (event.code === 'KeyB' && brushRef.current.available) { event.preventDefault(); setBrushMode(value => !value); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [transport]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (!event.ctrlKey || event.key.toLowerCase() !== 'b' || event.repeat || document.querySelector('.modal-backdrop')) return; if ((event.target as HTMLElement)?.matches('input,textarea,[contenteditable=true]')) return; event.preventDefault(); splitAll.current(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [transport]);
  // Drag-time overrides on waveform pictures are removed once React has drawn the new clip, so there is no frame in between.
  const clearDirect = () => section.current?.querySelectorAll('svg[data-direct]').forEach(element => { element.removeAttribute('data-direct'); element.removeAttribute('style'); const view = (element as SVGElement).dataset.view; if (view) element.setAttribute('viewBox', view); });
  useLayoutEffect(clearDirect, [edits]);
  // Menus start where the pointer was, then are measured and moved back inside the window (and given a scrollbar if the window
  // is shorter than the menu). Measuring beats a fixed allowance: the menu grows with its entries and the page may be zoomed.
  useLayoutEffect(() => {
    const scale = pageZoom();
    section.current?.querySelectorAll<HTMLElement>('.timeline-context-menu').forEach(element => {
      element.style.maxHeight = `${(window.innerHeight - 8) / scale}px`;
      const box = element.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (box.bottom > window.innerHeight - 4) dy = window.innerHeight - 4 - box.bottom;
      if (box.top + dy < 4) dy = 4 - box.top;
      if (box.right > window.innerWidth - 4) dx = window.innerWidth - 4 - box.right;
      if (box.left + dx < 4) dx = 4 - box.left;
      if (dy) element.style.top = `${parseFloat(element.style.top || '0') + dy / scale}px`;
      if (dx) element.style.left = `${parseFloat(element.style.left || '0') + dx / scale}px`;
    });
  }, [menu, deleteAsk, takeMenu]);
  // Menus are placed where the pointer was, then measured and moved back inside the window (and shortened with a scrollbar
  // if the window is too small). Measuring beats a fixed allowance: the menu grows with its entries and the page may be zoomed.
  useLayoutEffect(() => {
    const zoom = parseFloat(document.documentElement.style.zoom) || 1;
    section.current?.querySelectorAll<HTMLElement>('.timeline-context-menu').forEach(element => {
      element.style.maxHeight = `${(window.innerHeight - 8) / zoom}px`;
      const box = element.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (box.bottom > window.innerHeight - 4) dy = window.innerHeight - 4 - box.bottom;
      if (box.top + dy < 4) dy = 4 - box.top;
      if (box.right > window.innerWidth - 4) dx = window.innerWidth - 4 - box.right;
      if (box.left + dx < 4) dx = 4 - box.left;
      if (dy) element.style.top = `${parseFloat(element.style.top || '0') + dy / zoom}px`;
      if (dx) element.style.left = `${parseFloat(element.style.left || '0') + dx / zoom}px`;
    });
  }, [menu, deleteAsk, takeMenu]);
  function editStart(event: React.PointerEvent<HTMLElement>, stem: Stem, requested: 'gain' | 'start' | 'end' | 'move', id?: string) {
    if (event.button !== 0 || !duration) return;
    const kind = requested === 'move' && event.altKey && !event.shiftKey && !brushRef.current.brushMode ? 'copy' : requested;
    if (kind === 'move' && (event.shiftKey || brushRef.current.brushMode)) return; // range picking keeps working over clips
    event.preventDefault(); event.stopPropagation();
    if ((kind === 'move' || kind === 'copy') && id) setPickedClip({ stem: stem.id, id });
    const lane = event.currentTarget.closest('.waveform-lane') as HTMLElement;
    dragSnapshot.current = { mix: mixRef.current, edits: editsRef.current };
    const initial = channelEdit(editsRef.current[stem.id], duration);
    const moving = kind === 'move' || kind === 'copy' ? initial.clips.find(clip => clip.id === id) : undefined;
    const grab = moving ? pointerTime(event.clientX, lane.getBoundingClientRect().left, lane.getBoundingClientRect().width, duration) - placedStart(moving) : 0;
    const clip = event.currentTarget.closest('.waveform-clip') as HTMLElement | null, base = initial.clips.find(item => item.id === id), track = tracks.find(item => item.stem.id === stem.id);
    // Trimming and moving a clip repaint only that clip's box while the pointer moves; the timeline state, the other rows and the
    // audio are updated once on release.
    const direct = kind === 'start' || kind === 'end' || kind === 'move';
    // While a clip is trimmed or moved, its waveform picture is the whole source audio on its own layer, drawn once and left
    // alone. The clip box masks it, so material that is trimmed away is already there when the edge is dragged back out. A
    // dense waveform is expensive to rasterise, which is why the picture is never redrawn during the drag.
    const picture = direct ? clip?.querySelector('svg') as SVGElement | null : null, pxPerSecond = lane.getBoundingClientRect().width / duration;
    if (picture && base && track) { picture.dataset.direct = '1'; picture.setAttribute('viewBox', `0 0 ${track.peaks.length} 80`); picture.style.width = `${track.duration * pxPerSecond}px`; picture.style.maxWidth = 'none'; picture.style.willChange = 'transform'; picture.style.transform = `translateX(${-base.start * pxPerSecond}px)`; }
    editDrag.current = { kind, stem, id, grab, y: event.clientY, db: gainAt(initial, selection ? (selection.start + selection.end) / 2 : transport.snapshot().position), initial, rect: lane.getBoundingClientRect(), ...(direct && clip && base && track ? { element: clip, wave: { pxPerSecond } } : {}) };
    event.currentTarget.setPointerCapture(event.pointerId); setGainDragging(kind === 'gain');
  }
  function editMove(event: React.PointerEvent<HTMLElement>) {
    const drag = editDrag.current; if (!drag) return; event.stopPropagation();
    if (dragSnapshot.current) { history.current = record(history.current, dragSnapshot.current); dragSnapshot.current = null; syncHistory(); }
    const at = pointerTime(event.clientX, drag.rect.left, drag.rect.width, duration);
    const placed = drag.kind === 'copy' ? placeCopy(drag.initial, drag.initial.clips.find(clip => clip.id === drag.id)!, at - drag.grab, duration) : null;
    if (drag.kind === 'copy') drag.copyId = placed?.id;
    const next = drag.kind === 'copy' ? (placed?.edit ?? drag.initial) : drag.kind === 'gain' && selection ? gainEdit(drag.initial, selection.start, selection.end, drag.db + (drag.y - event.clientY) / 2, duration) : drag.kind === 'move' ? moveEdit(drag.initial, drag.id!, at - drag.grab, duration) : trimEdit(drag.initial, drag.id!, drag.kind, at, duration);
    drag.latest = next;
    if (drag.element && drag.wave && drag.id) {
      const clip = next.clips.find(item => item.id === drag.id);
      if (clip) {
        drag.element.style.left = `${placedStart(clip) / duration * 100}%`; drag.element.style.width = `${(clip.end - clip.start) / duration * 100}%`;
        const picture = drag.element.querySelector('svg') as SVGElement | null;
        if (picture) picture.style.transform = `translateX(${-clip.start * drag.wave.pxPerSecond}px)`;
      }
      return;
    }
    // Gain and copy change several parts of the row, so they go through state, at most once per frame.
    if (editFrame.current === null) editFrame.current = requestAnimationFrame(() => { editFrame.current = null; const current = editDrag.current; if (current?.latest) { const edit = current.latest; setEdits(previous => ({ ...previous, [current.stem.id]: edit })); } });
  }
  function editEnd(event: React.PointerEvent<HTMLElement>) { if (!editDrag.current) return; event.stopPropagation(); const finished = editDrag.current; if (editFrame.current !== null) { cancelAnimationFrame(editFrame.current); editFrame.current = null; } if (finished.latest) { const edit = finished.latest; setEdits(previous => ({ ...previous, [finished.stem.id]: edit })); } else clearDirect(); if (finished.copyId) setPickedClip({ stem: finished.stem.id, id: finished.copyId }); editDrag.current = null; dragSnapshot.current = null; setGainDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  const seek = (at: number) => transport.seek(at);
  function point(event: React.PointerEvent<HTMLElement>) { const rect = event.currentTarget.getBoundingClientRect(); return pointerTime(event.clientX, rect.left, rect.width, duration); }
  function seekPointer(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || gesture.current || pan.current || editDrag.current) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    setPickedClip(null);
    if (brushRef.current.brushMode && event.altKey && duration > 0) { event.preventDefault(); brushRef.current.onBrush({ start: 0, end: duration }); return; }
    const at = point(event); const selecting = event.shiftKey || brushRef.current.brushMode;
    gesture.current = { kind: selecting ? 'select' : 'seek', anchor: at };
    if (!selecting) { seek(at); return; }
    // Choosing a range while playing leaves the video and audio alone: seeking on every move would restart every channel.
    if (!transport.snapshot().playing) { transport.setSelection(at, at); transport.scrub(at); }
    paintDrag(at, at); setDragRange(true);
  }
  // The range being picked is drawn through CSS variables and handed to the transport once, on release. While playing it
  // is not scrubbed at all; while paused the preview video follows the pointer.
  function paintDrag(anchor: number, at: number) {
    dragEnds.current = { anchor, at };
    const from = Math.min(anchor, at), to = Math.max(anchor, at), total = Math.max(duration, 0.001);
    section.current?.style.setProperty('--sel-left', `${from / total * 100}%`); section.current?.style.setProperty('--sel-width', `${(to - from) / total * 100}%`);
  }
  function cancelGesture() { gesture.current = null; setDragRange(false); }
  function dragSeek(event: React.PointerEvent<HTMLElement>, final = false) {
    if (!gesture.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const at = point(event);
    if (gesture.current.kind !== 'select') { transport.scrub(at); return; }
    paintDrag(gesture.current.anchor, at);
    if (!transport.snapshot().playing) transport.scrub(at);
    if (final) transport.setSelection(gesture.current.anchor, at);
  }
  function endSeek(event: React.PointerEvent<HTMLElement>) {
    if (!gesture.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const selecting = gesture.current.kind === 'select'; dragSeek(event, true); gesture.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
    if (!selecting) return;
    setDragRange(false);
    if (brushRef.current.brushMode && !event.shiftKey) {
      const region = transport.snapshot().selection;
      if (region && region.end - region.start >= 0.5) brushRef.current.onBrush(region); else transport.clearSelection();
    } else void transport.commitSelection();
  }
  function panStart(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 1 || gesture.current || pan.current) return;
    event.preventDefault(); event.stopPropagation(); pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); setPanning(true);
  }
  function panMove(event: React.PointerEvent<HTMLDivElement>) { if (!pan.current) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX; event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY; }
  function panEnd(event: React.PointerEvent<HTMLDivElement>) { if (!pan.current) return; event.preventDefault(); event.stopPropagation(); pan.current = null; setPanning(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  function lockLoop() { transport.setLoopLocked(!loopLocked); if (!loopLocked && !playing) void transport.play(); }
  // Every channel muted is easy to miss (the rows just look dim and nothing plays), so it is called out with a one-click way back.
  const allMuted = stems.length > 0 && stems.every(stem => mix[stem.id]?.mute) && !Object.values(mix).some(entry => entry.solo);
  function unmuteAll() { remember(); setMix(values => Object.fromEntries(Object.entries(values).map(([id, entry]) => { const { restoreMute, ...rest } = entry; return [id, { ...rest, mute: false, solo: false }]; }))); }
  function muteChannel(id: string) { remember(); setMix(values => toggleMute(values, id)); }
  function soloChannel(event: React.MouseEvent, id: string) { remember(); const additive = event.ctrlKey || event.metaKey; setMix(values => toggleSolo(values, id, additive)); }
  function context(event: React.MouseEvent<HTMLElement>, stem: Stem) { event.preventDefault(); setPicked(previous => previous.has(stem.id) ? previous : new Set([stem.id])); const lane = event.currentTarget.closest('.timeline-track')?.querySelector('.waveform-lane'); const rect = lane?.getBoundingClientRect(); const at = rect && event.currentTarget.classList.contains('waveform-lane') ? pointerTime(event.clientX, rect.left, rect.width, duration) : transport.snapshot().position; setMenu({ stem, at, x: Math.max(4, Math.min(event.clientX, window.innerWidth - 235)), y: Math.max(4, Math.min(event.clientY, window.innerHeight - 265)) }); }
  const popupZoom = pageZoom();
  const rows = groupedTracks(stems, collapsed).map(row => ({ ...row, track: tracks.find(track => track.stem.id === row.stem.id) })).filter(row => !!row.track);
  function pick(event: React.MouseEvent, id: string) {
    if ((event.target as Element).closest('button,input,.row-grip,.level-knob')) return;
    setPickedClip(null);
    const order = rows.map(row => row.stem.id);
    setPicked(previous => {
      if (event.shiftKey && pickAnchor.current && order.includes(pickAnchor.current) && order.includes(id)) { const a = order.indexOf(pickAnchor.current), b = order.indexOf(id); return new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)); }
      if (event.ctrlKey || event.metaKey) { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }
      return previous.size === 1 && previous.has(id) ? new Set() : new Set([id]);
    });
    pickAnchor.current = id;
  }
  const ticks = Array.from({ length: 11 }, (_, i) => duration * i / 10);
  return <section ref={section} style={{ '--wave-height': waveHeight, '--row-height': `${rowHeight}px` } as React.CSSProperties} className={`panel multitrack ${panning ? 'is-panning' : ''} ${brushMode ? 'is-brush' : ''}`} aria-label="Stem timeline">
    {!expanded && <div className="timeline-resize-handle" role="separator" aria-orientation="horizontal" aria-label="Resize timeline" aria-valuemin={Math.round(resizeBounds.min)} aria-valuemax={Math.round(resizeBounds.max)} aria-valuenow={Math.round(workspaceHeight)} tabIndex={0} title="Drag to resize. Double-click to reset."
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); resizeY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (resizeY.current === null) return; const delta = event.clientY - resizeY.current; resizeY.current = event.clientY; resize(delta); }}
      onPointerUp={event => { resizeY.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { resizeY.current = null; }} onLostPointerCapture={() => { resizeY.current = null; }} onDoubleClick={resetSize}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); resize(event.key === 'Home' ? -100000 : event.key === 'End' ? 100000 : event.key === 'ArrowUp' ? -24 : 24); } }}/>} 
    <div className="timeline-toolbar">
      <div className={`take-tabs-wrap ${tabFade.left ? 'fade-left' : ''} ${tabFade.right ? 'fade-right' : ''}`}>
        <div ref={tabs} className="take-tabs" role="tablist" aria-label="Compare model takes" onScroll={measureTabs}
          onPointerDown={event => { if (event.button !== 1 || !tabs.current) return; event.preventDefault(); tabPan.current = { x: event.clientX, left: tabs.current.scrollLeft }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (tabPan.current && tabs.current) tabs.current.scrollLeft = tabPan.current.left + tabPan.current.x - event.clientX; }}
          onPointerUp={event => { tabPan.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { tabPan.current = null; }} onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}>
          {takes.map((take, index) => <button key={take.id} role="tab" aria-selected={take.id === selectedTake} className={`take-tab ${take.id === selectedTake ? 'is-selected' : ''}`} onClick={() => selectTake(take.id)} onContextMenu={event => { event.preventDefault(); setTakeMenu({ id: take.id, x: Math.min(event.clientX, window.innerWidth - 170), y: Math.min(event.clientY, window.innerHeight - 90) }); }} data-tip={take.label}><small>{String(index + 1).padStart(2, '0')}</small><span>{take.label}</span><span className="take-close" role="button" aria-label={`Close ${take.label}`} data-tip="Close take" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); closeTake(take.id); }}><X size={11}/></span></button>)}
          {!takes.length && <span className="take-empty">Results appear here as you run models</span>}
        </div>
      </div>
      <div className="toolbar-bank view-bank">{externalPreview && <button className="icon-button is-active" aria-label="Bring the preview back" data-tip={'Preview is on another display\nClick to bring it back here.'} onClick={bringPreviewBack}><Monitor size={14}/></button>}<button className="icon-button timeline-expand" aria-label={expanded ? 'Restore workspace layout' : 'Expand timeline'} aria-pressed={expanded} data-tip={expanded ? 'Restore layout' : 'Expand timeline'} onClick={toggleExpanded}>{expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}</button></div>
      <div className="toolbar-bank brush-bank"><button className={`icon-button ${brushMode ? 'is-active' : ''}`} disabled={!brushAvailable} aria-pressed={brushMode} aria-label="Brush" data-tip={brushAvailable ? 'Brush (B)\nDrag over a region, then describe the sound to paint into a new channel. Hold Alt and click to brush the whole timeline. B toggles, Esc leaves.' : 'Brush\nOpen a source and connect to ComfyUI first.'} onClick={() => setBrushMode(value => !value)}><Paintbrush size={14}/></button></div>
      {picked.size > 0 && <div className="toolbar-bank pick-bank"><output>{picked.size} selected</output><button className="icon-button" aria-label={`Delete ${picked.size} selected channels`} data-tip={'Delete selected\nDelete key. The audio stays on disk.'} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); askDelete([...picked], box.left - 100, box.bottom + 6); }}><Trash2 size={14}/></button><button className="icon-button" aria-label="Clear channel selection" data-tip="Clear selection" onClick={() => setPicked(new Set())}><X size={12}/></button></div>}
      <div className="toolbar-bank meter-bank"><button className={`icon-button ${metering ? 'is-active' : ''}`} aria-pressed={metering} aria-label="Channel level meters" data-tip={'Level meters\nShow a thin level bar on each channel while playing. Turn off if playback stutters.'} onClick={() => setMetering(value => !value)}><Activity size={14}/></button></div>
      <div className="toolbar-bank history-bank"><button className="icon-button" disabled={!historyState.undo} aria-label="Undo" data-tip={'Undo\nCtrl+Z'} onClick={() => travel('undo')}><Undo2 size={14}/></button><button className="icon-button" disabled={!historyState.redo} aria-label="Redo" data-tip={'Redo\nCtrl+Shift+Z or Ctrl+Y'} onClick={() => travel('redo')}><Redo2 size={14}/></button></div>
      <div className="toolbar-bank range-bank">{selection ? <><output>{clock(selection.start)} → {clock(selection.end)}</output><button className={`icon-button loop-lock ${loopLocked ? 'is-active' : ''}`} aria-label="Loop-lock selection" aria-pressed={loopLocked} data-tip={loopLocked ? 'Unlock loop' : 'Loop selected range'} onClick={lockLoop}><Repeat2 size={14}/>{loopLocked && <LockKeyhole size={9}/>}</button><button className="icon-button" aria-label="Clear selection" data-tip="Clear selection" onClick={() => transport.clearSelection()}><X size={12}/></button></> : <span className="range-hint" data-tip={'Select a range\nShift + drag on the timeline to select and loop a range.'}><Repeat2 size={13}/></span>}</div>
      <div className="toolbar-bank zoom-bank"><WaveformKnob value={waveHeight} onChange={setWaveHeight} onPreview={value => section.current?.style.setProperty("--wave-height", String(value))} rowValue={knobFromRow(rowHeight)} onRowChange={value => { setRowHeight(rowFromKnob(value)); setRowHeights({}); }} onRowPreview={value => section.current?.style.setProperty("--row-height", `${rowFromKnob(value)}px`)} onSizing={active => { section.current?.classList.toggle('is-sizing', active); if (active) section.current?.querySelectorAll<HTMLElement>('.timeline-track').forEach(el => el.style.removeProperty('--row')); }}/><span className="tool-divider"/><button className="icon-button" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value / 2))} aria-label="Zoom out" data-tip="Zoom out"><ZoomOut size={15}/></button><output>{zoom}×</output><button className="icon-button" disabled={zoom >= 8} onClick={() => setZoom(value => Math.min(8, value * 2))} aria-label="Zoom in" data-tip="Zoom in"><ZoomIn size={15}/></button></div>
      <div className="toolbar-bank export-bank"><button disabled={exporting || !stems.length || !canExportVideo} onClick={() => exportVideo(mix)} data-tip={canExportVideo ? 'Export video with the current mix' : 'Video export needs a video source'}><Film size={14}/><span>Video</span></button><button disabled={exporting || !tracks.length} onClick={() => setMixOpen(true)} data-tip={'Export mix\nRender the current mix to WAV or FLAC.'}><Layers size={14}/><span>Mix</span></button><button disabled={exporting || !stems.length} onClick={() => save()} data-tip="Download all channels"><ArrowDownToLine size={14}/><span>Stems</span></button></div>
    </div>
    <div className="timeline-status"><span>CHANNELS / {stems.length}{picked.size > 0 ? ` · ${picked.size} SELECTED` : ''}</span>{allMuted && <button className="all-muted" onClick={unmuteAll} data-tip={'Every channel is muted, so nothing plays. Click to unmute all.'}>All channels are muted · Unmute all</button>}{loading && <span role="status">Reading waveforms…</span>}</div>
    {stems.some(stem => stem.missing) && <p className="helper" role="status">Missing channels: {stems.filter(stem => stem.missing).map(stem => stem.label).join(", ")}. Project references are retained.</p>}{error && <p className="error-banner" role="alert">{error}</p>}
    {error && !tracks.length && <div className="timeline-export-fallback">{stems.map(stem => <button className="quiet-button" key={stem.id} disabled={exporting} onClick={() => save(stem.id)}><ArrowDownToLine size={13}/>{stem.label}</button>)}</div>}
    <TimelineScrub transport={transport} duration={duration}/>
    <div ref={scroll} className="timeline-scroll" onScroll={event => { setMenu(null); viewRef.current = { ...viewRef.current, scrollLeft: event.currentTarget.scrollLeft, scrollTop: event.currentTarget.scrollTop }; onViewChange(viewRef.current); }} onPointerDownCapture={panStart} onPointerMoveCapture={panMove} onPointerUpCapture={panEnd} onPointerCancelCapture={panEnd} onLostPointerCapture={event => { if (event.target === scroll.current) { pan.current = null; setPanning(false); } }} onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}><div className="timeline-grid" style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
      <div className="track-ruler-label">CHANNEL / MIX</div><div className="track-ruler" onPointerDown={seekPointer} onPointerMove={dragSeek} onPointerUp={endSeek} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture}>{(selection || dragRange) && <div className="timeline-selection" style={dragRange ? dragStyle : rangeStyle}/>} {ticks.map((value, index) => <span key={index} style={{ left: `${index * 10}%` }}>{clock(value)}</span>)}</div>
      {rows.map(({ stem, track, depth, color }, index) => { const { peaks: data, path } = track!; const hasChildren = stems.some(child => child.parentId === stem.id); return <div className={`timeline-track track-color-${color} ${depth ? 'is-child' : ''} ${mix[stem.id]?.mute ? 'is-muted' : ''} ${freshIds?.has(stem.id) ? 'is-entering' : ''}`} key={stem.id} style={{ ...(rowHeights[stem.id] ? { '--row': `${rowHeights[stem.id]}px` } : {}), ...(freshIds?.has(stem.id) ? { '--enter-delay': `${Math.min(index, 14) * 38}ms` } : {}) } as React.CSSProperties}>
        <div className={`track-controls ${picked.has(stem.id) ? 'is-picked' : ''}`} style={{ paddingLeft: 10 + Math.min(depth, 4) * 12 }} onClick={event => pick(event, stem.id)} onContextMenu={event => context(event, stem)}><div className="row-grip" role="separator" aria-orientation="horizontal" aria-label={`Resize ${stem.label}`} data-tip={'Channel height\nDrag to size this channel. Double-click to match the others.'}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); const track = event.currentTarget.closest('.timeline-track') as HTMLElement, lane = track.querySelector('.waveform-lane') as HTMLElement; rowGrip.current = { y: event.clientY, height: lane.getBoundingClientRect().height, id: stem.id, track }; section.current?.classList.add('is-sizing'); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { const grip = rowGrip.current; if (grip) grip.track.style.setProperty('--row', `${clampRow(grip.height + event.clientY - grip.y)}px`); }}
          onPointerUp={event => { const grip = rowGrip.current; rowGrip.current = null; section.current?.classList.remove('is-sizing'); if (!grip) return; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setRowHeights(previous => ({ ...previous, [grip.id]: clampRow(grip.height + event.clientY - grip.y) })); }}
          onPointerCancel={() => { rowGrip.current = null; section.current?.classList.remove('is-sizing'); }}
          onDoubleClick={event => { event.stopPropagation(); (event.currentTarget.closest('.timeline-track') as HTMLElement).style.removeProperty('--row'); setRowHeights(previous => { const next = { ...previous }; delete next[stem.id]; return next; }); }}/><div className="track-head"><div className="track-name">{hasChildren && <button className="group-fold" aria-label={`${collapsed.has(stem.id) ? 'Expand' : 'Collapse'} ${stem.label} details`} aria-expanded={!collapsed.has(stem.id)} onClick={() => setCollapsed(previous => { const next = new Set(previous); next.has(stem.id) ? next.delete(stem.id) : next.add(stem.id); return next; })}>{collapsed.has(stem.id) ? <ChevronRight size={12}/> : <ChevronDown size={12}/>}</button>}<span className="track-number">{String(index + 1).padStart(2, '0')}</span>{renaming?.id === stem.id
            ? <input className="track-rename" autoFocus maxLength={160} aria-label={`Rename ${stem.label}`} value={renaming.value} onFocus={event => event.currentTarget.select()} onChange={event => setRenaming({ id: stem.id, value: event.target.value })} onBlur={() => finishRename(true)} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); finishRename(true); } else if (event.key === 'Escape') { event.preventDefault(); finishRename(false); } }}/>
            : <>{stem.kind === 'brush' && <Paintbrush className="track-kind" size={11} data-tip={'Painted with the brush'}/>}<strong title={stem.label} onDoubleClick={event => { event.stopPropagation(); setRenaming({ id: stem.id, value: stem.label }); }}>{stem.label}</strong></>}<button className="icon-button" disabled={exporting} onClick={() => save(stem.id)} aria-label={`Download ${stem.label}`}><ArrowDownToLine size={14}/></button></div><div className="track-mix"><button className={mix[stem.id]?.mute ? 'is-active' : ''} aria-pressed={!!mix[stem.id]?.mute} onClick={() => muteChannel(stem.id)} aria-label={`Mute ${stem.label}`} data-tip="Mute">M</button><button className={mix[stem.id]?.solo ? 'is-active' : ''} aria-pressed={!!mix[stem.id]?.solo} onClick={event => soloChannel(event, stem.id)} aria-label={`Solo ${stem.label}`} data-tip={'Solo\nMutes every other channel. Hold Ctrl to solo several.'}>S</button><LevelKnob value={mix[stem.id]?.level ?? 1} label={`${stem.label} level`} onBegin={remember} onPreview={level => transport.setMix({ ...mixRef.current, [stem.id]: { ...mixRef.current[stem.id], level } })} onChange={level => setMix(values => ({ ...values, [stem.id]: { ...values[stem.id], level } }))}/><small>{track!.channels === 1 ? 'MONO' : `${track!.channels}CH`} · {(track!.rate / 1000).toFixed(1)}k</small><em className="meter-db" data-db={stem.id} aria-hidden="true"/></div></div><div className="channel-meter" data-meter={stem.id} aria-hidden="true"><i/></div></div>
        <div className={`waveform-lane ${picked.has(stem.id) ? 'is-picked' : ''}`} onPointerEnter={() => { hoverStem.current = stem.id; }} onContextMenu={event => context(event, stem)} onPointerDown={seekPointer} onPointerMove={event => { dragSeek(event); const at=point(event); event.currentTarget.classList.toggle('over-selected',!!selection && at>=selection.start && at<=selection.end); }} onPointerLeave={event => event.currentTarget.classList.remove('over-selected')} onPointerUp={endSeek} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture}>
          {channelEdit(edits[stem.id], duration).clips.map(clip => <div key={clip.id} className={`waveform-clip editable-clip ${pickedClip?.id === clip.id && pickedClip.stem === stem.id ? 'is-clip-picked' : ''}`} style={{ left: `${placedStart(clip) / duration * 100}%`, width: `${(clip.end - clip.start) / duration * 100}%` }}><div className="clip-grip" role="button" aria-label={`Move ${stem.label}`} data-tip={'Move clip\nDrag sideways to place it elsewhere in this channel. Hold Alt while dragging to copy it instead.'} onPointerDown={event => editStart(event, stem, 'move', clip.id)} onPointerMove={editMove} onPointerUp={editEnd} onPointerCancel={editEnd} onLostPointerCapture={editEnd}><span>{stem.label} · FLAC</span></div><ClipWave label={stem.label} data={data} peak={track!.peak} path={path} duration={track!.duration} clip={clip} gains={edits[stem.id]?.gains ?? NO_GAINS}/>{(['start','end'] as const).map(edge => <div key={edge} className={`clip-edge clip-edge-${edge}`} role="separator" aria-label={`Trim ${stem.label} ${edge}`} onPointerDown={event => editStart(event,stem,edge,clip.id)} onPointerMove={editMove} onPointerUp={editEnd} onPointerCancel={editEnd} onLostPointerCapture={editEnd}/>)}</div>)}
          {dragRange && <div className="timeline-selection" style={dragStyle}/>}{selection && !dragRange && <><div className="timeline-selection" style={rangeStyle}/><div className={`range-gain ${gainDragging ? 'is-dragging' : ''}`} style={{ ...rangeStyle, top: `${Math.max(14, Math.min(85, 50 - gainAt(edits[stem.id],(selection.start+selection.end)/2))) }%` }} title="Drag vertically to adjust selected range gain. Double-click to reset." onPointerDown={event => editStart(event,stem,'gain')} onPointerMove={editMove} onPointerUp={editEnd} onPointerCancel={editEnd} onLostPointerCapture={editEnd} onDoubleClick={event => { event.stopPropagation(); remember(); setEdits(previous => ({ ...previous, [stem.id]: gainEdit(previous[stem.id],selection.start,selection.end,0,duration) })); }}><span>{gainAt(edits[stem.id],(selection.start+selection.end)/2).toFixed(1)} dB</span></div></>}<div className="timeline-playhead" style={{ left: 'clamp(0px, calc(var(--playhead, 0) * 1%), calc(100% - 1px))' }}/>
        </div>
      </div>; })}
      {!tracks.length && <p className="timeline-loading">{loading ? 'Preparing waveform lanes…' : 'Separate stems to see waveform lanes.'}</p>}
    </div></div>
    {menu && <div className="timeline-context-menu" role="menu" aria-label={`${menu.stem.label} actions`} style={{ left: menu.x / popupZoom, top: menu.y / popupZoom }}><small>{menu.stem.label}{selection ? ` · ${clock(selection.start)} → ${clock(selection.end)}` : ' · whole channel'}</small><button role="menuitem" disabled={!duration || detailBusy || !detailAvailable} onClick={() => { details(menu.stem, selection?.start || 0, selection?.end || duration, false); setMenu(null); }}><ScanSearch size={14}/> Extract details <span>USS Auto</span></button><button role="menuitem" disabled={!duration || detailBusy || !detailAvailable} onClick={() => { details(menu.stem, selection?.start || 0, selection?.end || duration, true); setMenu(null); }}><Crosshair size={14}/> Extract sound…</button><button role="menuitem" disabled={!duration} onClick={() => { remember(); setEdits(previous => ({ ...previous, [menu.stem.id]: splitEdit(previous[menu.stem.id], menu.at, duration) })); setMenu(null); }}><Scissors size={14}/> Split channel <span>{clock(menu.at)}</span></button><button role="menuitem" onClick={() => { remember(); setEdits(previous => { const next = { ...previous }; delete next[menu.stem.id]; return next; }); setMenu(null); }}>Reset channel edits</button><button role="menuitem" onClick={() => { useAsReference(menu.stem); setMenu(null); }}><Mic size={14}/> Use as GuideSep reference</button><button role="menuitem" disabled={exporting} onClick={() => { save(menu.stem.id); setMenu(null); }}><ArrowDownToLine size={14}/> Download channel</button>{(() => { const found = clipAt(edits[menu.stem.id], menu.at, duration); return found ? <button role="menuitem" onClick={() => { deleteClip(menu.stem.id, found.id); setMenu(null); }}><Scissors size={14}/> Delete clip <span>Del</span></button> : null; })()}<button role="menuitem" onClick={() => { const many = picked.has(menu.stem.id) && picked.size > 1; askDelete(many ? [...picked] : [menu.stem.id], menu.x, menu.y); setMenu(null); }}><Trash2 size={14}/> {picked.has(menu.stem.id) && picked.size > 1 ? `Delete ${picked.size} channels…` : 'Delete channel…'}</button></div>}
    {mixOpen && <MixExportModal items={tracks.filter(track => track.buffer).map(track => ({ id: track.stem.id, label: track.stem.label, buffer: track.buffer! }))} mix={mix} edits={edits} duration={duration} name={sourceName} close={() => setMixOpen(false)} exportFile={exportMixFile}/>}
    {takeMenu && <div className="timeline-context-menu take-menu" role="menu" aria-label="Take actions" style={{ left: takeMenu.x / popupZoom, top: takeMenu.y / popupZoom }}><button role="menuitem" onClick={() => { closeTake(takeMenu.id); setTakeMenu(null); }}><X size={14}/> Close take</button><button role="menuitem" disabled={takes.length < 2} onClick={() => { closeTake(takeMenu.id, true); setTakeMenu(null); }}>Close other takes</button></div>}
    {deleteAsk && <div className="timeline-context-menu delete-confirm" role="alertdialog" aria-label="Delete channels" style={{ left: deleteAsk.x / popupZoom, top: deleteAsk.y / popupZoom }}>{(() => { const all = deleteFamily(deleteAsk.ids), extra = all.length - deleteAsk.ids.length, first = stems.find(stem => stem.id === deleteAsk.ids[0]); return <><small>{deleteAsk.ids.length === 1 ? `Delete "${first?.label}"` : `Delete ${deleteAsk.ids.length} channels`}{extra > 0 ? ` and ${extra} detail channel${extra > 1 ? 's' : ''}` : ''}?</small><p>The audio stays on disk. {all.length > 1 ? 'These channels leave' : 'The channel leaves'} this take and cannot be restored here.</p><div><button className="secondary-button" onClick={() => setDeleteAsk(null)}>Cancel</button><button className="primary-button" onClick={() => { deleteChannels(all); setPicked(new Set()); setDeleteAsk(null); }}>Delete</button></div></>; })()}</div>}
  </section>;
}
