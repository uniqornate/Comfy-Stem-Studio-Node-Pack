import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, ArrowLeft, CircleHelp, Lightbulb, Music4, ScanSearch, SlidersHorizontal, Sparkles, ArrowUpRight, Check, Clapperboard, FolderOpen, Link2, LoaderCircle, Plus, Save, Settings2, ShieldCheck, Play, Pause, ZoomIn, ZoomOut, X } from 'lucide-react';
import type { Connection, Profile, Source, ProxyState, Engine, StemJob, ExportState, Stem, SAMGuidance, ProjectInfo, ProjectSession, ProjectPayload, TimelineView, ReferenceAudio } from './types';
import './styles.css';
const comfyWordmark = new URL('./assets/comfy/comfy-wordmark.svg', import.meta.url).href;
const comfyIcon = comfyWordmark;
const stemLogo = new URL('./assets/comfy/stem-studio-logo-1.png', import.meta.url).href;
import { DetailPicker, type DetailRequest } from './DetailPicker';
import { StemTimeline } from './StemTimeline';
import { workspaceTop } from './timeline-geometry.mjs';
import { preferences } from './workspace-preferences.mjs';
import { ResourceMonitor } from './ResourceMonitor';
import { Grain } from './GrainLayer';
import { MediaTransport } from './media-transport.mjs';
import { TooltipLayer } from './Tooltip';
import { PreviewFooter } from './PreviewFooter';
import { useCoarsePlayback } from './usePlayback';
import { ModelPicker } from './ModelPicker';
import { ModelModal } from './ModelModal';
import { MODELS, modelName } from './models.mjs';
import { SAMPrepare, SAMVariantSwitch, useSAMStatus } from './SAMPrepare';
import { SAMGuidanceEditor } from './SAMGuidanceEditor';
import { MusicPanel } from './MusicPanel';
import { JobProgress } from './JobProgress';
import { TargetPicker } from './TargetPicker';
import { normalizeGuidance } from './sam-guidance.mjs';
import { installWebDesktop } from './web-desktop.mjs';
import { ModelPacks } from './ModelPacks';
import { ShortcutsPanel } from './ShortcutsPanel';
import { pageZoom } from './page-zoom.mjs';
import { startTracker, sampleTracker, finishTracker, readUsage, remember, type Tracker, type Usage } from './usage.mjs';
import { BatchPanel } from './BatchPanel';
import { BrushModal } from './BrushModal';
import { clampFloat, resizeFloat } from './float-geometry.mjs';
import { helpKeyApplies, playbackKeyApplies } from './keys.mjs';
import { removeChannels } from './channels.mjs';
import { analyzeSource, suggestModel } from './source-profile.mjs';
import type { BatchOptions, MixExportOptions } from './types';
const STEM_MODELS = ['mrx', 'bandit', 'sfc'];
const AUDIO_SOURCE = /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i;

const initial: Profile = { comfyUrl: 'http://127.0.0.1:8188', proxyUrl: 'http://127.0.0.1:8189', installation: '', managedProxy: false, setupComplete: false };
function App() {
  const nodePack = !!window.desktop?.nodePack;
  const [remembered] = useState(() => { try { return preferences(localStorage.getItem('workspacePreferences')); } catch { return preferences(null); } });
  const [profile, setProfile] = useState(initial);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [settings, setSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [proxyState, setProxyState] = useState<ProxyState | null>(null);
  const [preparingProxy, setPreparingProxy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  // A save notice is a passing message: it fades after a few seconds, or when clicked.
  useEffect(() => { if (!saveNotice) return; const timer = setTimeout(() => setSaveNotice(''), 6000); return () => clearTimeout(timer); }, [saveNotice]);
  const [error, setError] = useState('');
  const [source, setSource] = useState<Source | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [recent, setRecent] = useState<ProjectInfo[]>([]);
  const [projectName, setProjectName] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectStatus, setProjectStatus] = useState('Loading project…');
  const timelines = useRef<Record<string, TimelineView>>({});
  const session = useRef<ProjectPayload | null>(null);
  const switching = useRef(false);
  const pendingTransport = useRef<ProjectSession['view']['transport'] | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [job, setJob] = useState<StemJob>({ phase: 'idle', message: '', stems: [], canCancel: false });
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  // The preview can sit behind the timeline (arrange view only): fitted to the timeline's rectangle, faded by an opacity.
  const [previewBackdrop, setPreviewBackdrop] = useState(() => { try { return localStorage.getItem('previewBackdrop') === 'on'; } catch { return false; } });
  const [backdropOpacity, setBackdropOpacity] = useState(() => { try { const value = parseFloat(localStorage.getItem('backdropOpacity') || ''); return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.4; } catch { return 0.4; } });
  const [backdropRect, setBackdropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => { try { localStorage.setItem('previewBackdrop', previewBackdrop ? 'on' : 'off'); localStorage.setItem('backdropOpacity', String(backdropOpacity)); } catch {} }, [previewBackdrop, backdropOpacity]);
  const [workspaceShare, setWorkspaceShare] = useState(0.46);
  const [workspaceAvailable, setWorkspaceAvailable] = useState(Math.max(0, window.innerHeight - 80));
  const workspaceMain = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!workspaceMain.current) return;
    const observer = new ResizeObserver(entries => setWorkspaceAvailable(entries[0].contentRect.height));
    observer.observe(workspaceMain.current); return () => observer.disconnect();
  }, []);
  const topHeight = workspaceTop(workspaceAvailable, workspaceAvailable * workspaceShare);
  function resizeWorkspace(delta: number) { setWorkspaceShare(previous => workspaceAvailable ? workspaceTop(workspaceAvailable, workspaceTop(workspaceAvailable, workspaceAvailable * previous) + delta) / workspaceAvailable : previous); }
  const [layoutZoom, setLayoutZoom] = useState(() => { const value = Number(localStorage.getItem('layoutZoom')); return Number.isFinite(value) && value >= 0.6 && value <= 1.5 ? value : 1; });
  useEffect(() => { if (window.desktop) void window.desktop.setLayoutZoom(layoutZoom).then(() => localStorage.setItem('layoutZoom', String(layoutZoom))).catch(cause => setError(String(cause))); }, [layoutZoom]);
  const [exportOpen, setExportOpen] = useState(false);
  const [videoExporting, setVideoExporting] = useState(false);
  const [exportMode, setExportMode] = useState<'mix' | 'tracks'>('mix');
  const [exportState, setExportState] = useState<ExportState>({ phase: 'idle', progress: 0, message: '' });
  const exportMix = useRef<Record<string, { mute: boolean; solo: boolean; level: number }>>({});
  useEffect(() => {
    if (!videoExporting || !window.desktop) return;
    let active = true;
    const timer = setInterval(() => { void window.desktop!.exportStatus().then(value => { if (active) setExportState(value); }).catch(() => {}); }, 400);
    return () => { active = false; clearInterval(timer); };
  }, [videoExporting]);
  const [exporting, setExporting] = useState(false);
  const [activeOperation, setActiveOperation] = useState<'stems' | 'uss'>(remembered.activeOperation);
  const [model, setModel] = useState(remembered.model);
  const [runs, setRuns] = useState<StemJob[]>([]);
  const [selectedRun, setSelectedRun] = useState('');
  const [detailRequest, setDetailRequest] = useState<DetailRequest | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailShortcut = useRef(() => {});
  const [lastGuidance, setLastGuidance] = useState<SAMGuidance | undefined>(undefined);
  const [samVariant, setSAMVariant] = useState<'small-tv' | 'large-tv'>('small-tv');
  const [detailMode, setDetailMode] = useState<'uss' | 'sam'>('uss');
  const [modelModal, setModelModal] = useState<'sam' | 'uss' | 'music' | null>(null);
  const [sourceGuidance, setSourceGuidance] = useState<SAMGuidance>({});
  const [reference, setReference] = useState<ReferenceAudio | null>(null);
  const [referenceOffset, setReferenceOffset] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'single' | 'batch'>(() => { try { return localStorage.getItem('separatorTab') === 'batch' ? 'batch' : 'single'; } catch { return 'single'; } });
  useEffect(() => { try { localStorage.setItem('separatorTab', panelTab); } catch {} }, [panelTab]);
  const [brushRegion, setBrushRegion] = useState<{ start: number; end: number } | null>(null);
  const [previewMenu, setPreviewMenu] = useState<{ x: number; y: number } | null>(null);
  const [externalPreview, setExternalPreview] = useState(false);
  // Peak memory and CPU of every model, measured on this PC while its jobs run and shown on the Models page.
  const [usage, setUsage] = useState<Record<string, Usage>>(() => { try { return readUsage(localStorage.getItem('modelUsage')); } catch { return {}; } });
  const usageKey = useRef(''), jobPhase = useRef('idle');
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [suggestion, setSuggestion] = useState<{ model: string; text: string; detail: string } | null>(null);
  const [sam, setSAM] = useSAMStatus(profile, samVariant);
  const [floatPosition, setFloatPosition] = useState({ x: Math.max(8, window.innerWidth - 340), y: 90 });
  const [floatWidth, setFloatWidth] = useState(320);
  const [videoRatio, setVideoRatio] = useState(16 / 9);
  const floatSize = { width: floatWidth, height: floatWidth / videoRatio };
  const floatResize = useRef<{ edge: string; x: number; y: number; width: number; height: number; left: number; top: number } | null>(null);
  function resizeFloatBox(event: React.PointerEvent<HTMLDivElement>) {
    const d = floatResize.current; if (!d) return; event.preventDefault(); event.stopPropagation();
    const box = resizeFloat({ edge: d.edge, start: d, dx: (event.clientX - d.x) / pageZoom(), dy: (event.clientY - d.y) / pageZoom(), ratio: videoRatio, viewport: { width: window.innerWidth / pageZoom(), height: window.innerHeight / pageZoom() } });
    setFloatWidth(box.width); setFloatPosition({ x: box.left, y: box.top }); floatMoved.current = true;
  }
  const floatDrag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const floatMoved = useRef(false);
  const [target, setTarget] = useState(remembered.target);
  const [autoThreshold] = useState(remembered.autoThreshold);
  const [threshold] = useState(remembered.threshold);
  useEffect(() => { const available = engine?.models; if (STEM_MODELS.includes(model) && available?.length && !available.includes(model)) setModel(['mrx', 'bandit', 'sfc'].find(key => available.includes(key)) || available[0]); }, [engine?.models, model]);
  useEffect(() => { try { localStorage.setItem('workspacePreferences', JSON.stringify({ model, activeOperation, target, autoThreshold, threshold })); } catch {} }, [model, activeOperation, target, autoThreshold, threshold]);
  const currentRun = runs.find(run => run.runId === selectedRun) || runs.at(-1);
  const activeId = currentRun?.runId || '';
  const selectedRef = useRef(''); selectedRef.current = activeId;
  const pickRun = (id: string) => { setSelectedRun(id); setDetailRequest(null); setDetailOpen(false); };
  const shownStems = currentRun?.stems || job.stems;
  const modelNames: Record<string, string> = Object.fromEntries(MODELS.map(item => [item.id, item.name]));
  const modelKind = MODELS.find(item => item.id === model)?.kind || 'stems';
  const sourceIsAudio = !!source && AUDIO_SOURCE.test(source.name);
  const [transport] = useState(() => new MediaTransport());
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const playback = useCoarsePlayback(transport);
  useEffect(() => { transport.attachVideo(video); return () => transport.attachVideo(null); }, [transport, video]);
  const keyboardActions = useRef({ toggle: () => {}, extract: () => {} });
  keyboardActions.current = { toggle: () => { void transport.toggle(); }, extract: () => { if (panelTab === 'batch' || settings || exportOpen || projectsOpen || (document.querySelector('.modal-backdrop') && !modelModal && !detailOpen)) return; if (modelModal) { if (canSeparate && modelReady) { setModelModal(null); void separate(); } return; } if (detailOpen) { detailShortcut.current(); return; } if (activeOperation === 'uss' && detailRequest) void extractDetail(detailRequest, detailMode, target, lastGuidance); else void separate(); } };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const modalOpen = !!document.querySelector('.modal-backdrop');
      // Tab switches between the normal view and the arrange view and never walks through the controls, in dialogs and text
      // fields too. It only switches the view on the workspace itself.
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat && playbackKeyApplies({ target: event.target, modalOpen })) setTimelineExpanded(value => !value); return; }
      if (event.code === 'Space' && !playbackKeyApplies({ target: event.target, modalOpen })) return;
      if (event.key === '?' && !event.ctrlKey && !event.altKey && helpKeyApplies({ target: event.target, modalOpen, helpOpen: !!document.querySelector('.shortcuts-modal') })) { event.preventDefault(); setShortcutsOpen(open => !open); return; }
      if (event.ctrlKey && event.key === 'Enter' && event.target instanceof Element && event.target.closest('.brush-modal')) return;
      const action = event.code === 'Space' ? 'toggle' : event.ctrlKey && event.key === 'Enter' ? 'extract' : null;
      if (!action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat && !event.isComposing) keyboardActions.current[action]();
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, []);
  // The preview can move to a window on another display. This window stays the transport; the other one follows it, muted.
  useEffect(() => window.desktop?.onPreviewClosed(() => setExternalPreview(false)), []);
  // A reloaded page forgets the preview window that is still open; ask the main process.
  useEffect(() => { void window.desktop?.previewStatus().then(value => setExternalPreview(!!value.open)).catch(() => {}); }, []);
  useEffect(() => {
    if (!previewMenu) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element)?.closest('.preview-menu')) setPreviewMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewMenu(null); };
    window.addEventListener('pointerdown', dismiss, true); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', key); };
  }, [previewMenu]);
  useEffect(() => {
    if (!externalPreview || !window.desktop) return;
    let last = 0, playing: boolean | null = null, timer: ReturnType<typeof setTimeout> | null = null, latest = transport.snapshot();
    const send = () => { timer = null; last = performance.now(); void window.desktop!.syncPreview({ position: latest.position, playing: latest.playing, rate: video?.playbackRate || 1 }).catch(() => {}); };
    const off = transport.subscribe(state => {
      latest = state;
      const changed = state.playing !== playing; playing = state.playing;
      if (changed || performance.now() - last >= 300) { if (timer) clearTimeout(timer); send(); } else if (!timer) timer = setTimeout(send, 300);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [externalPreview, transport, video]);
  // The preview window follows the source it was sent with, so it closes when another source replaces it. The first source of a
  // page (after a reload, the source loads later than the preview status) must not close a preview that is still open.
  const previewSource = useRef<string | undefined>(undefined);
  useEffect(() => { const before = previewSource.current; previewSource.current = source?.url; if (before && before !== source?.url && externalPreview) { void window.desktop?.closePreview().catch(() => {}); setExternalPreview(false); } }, [source?.url]);
  const backdropOn = previewBackdrop && timelineExpanded && !!source && !sourceIsAudio;
  useEffect(() => {
    if (!backdropOn) { setBackdropRect(null); return; }
    const measure = () => {
      const element = document.querySelector('.multitrack'); if (!element) return;
      const zoom = pageZoom(), box = element.getBoundingClientRect(), next = { x: Math.round(box.left / zoom), y: Math.round(box.top / zoom), w: Math.round(box.width / zoom), h: Math.round(box.height / zoom) };
      setBackdropRect(previous => previous && previous.x === next.x && previous.y === next.y && previous.w === next.w && previous.h === next.h ? previous : next);
    };
    measure(); const timer = setInterval(measure, 150); window.addEventListener('resize', measure);
    return () => { clearInterval(timer); window.removeEventListener('resize', measure); };
  }, [backdropOn]);
  async function sendPreview() {
    setPreviewMenu(null);
    if (!window.desktop || !source) return;
    const snapshot = transport.snapshot();
    try { await window.desktop.openPreview(source.url, { position: snapshot.position, playing: snapshot.playing, rate: video?.playbackRate || 1 }); setExternalPreview(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function bringPreviewBack() { setPreviewMenu(null); try { await window.desktop?.closePreview(); } catch {} setExternalPreview(false); }
  const projectInitialized = useRef(false);
  function hydrateProject(value: ProjectSession) {
    transport.pause();
    timelines.current = value.view.timelines || {};
    pendingTransport.current = value.view.transport || { position: 0, duration: 0, selection: null, loopLocked: false };
    setProject(value.info); setProjectName(value.info.name); setSource(value.source); setRuns(value.runs); setJob(value.job);
    setSelectedRun(value.runs.find(run => run.runId === value.view.selectedRun)?.runId || value.runs.at(-1)?.runId || '');
    setMediaError(false); setDetailRequest(null); setDetailOpen(false);
    const prefs = preferences(JSON.stringify(value.view));
    setModel(prefs.model); setActiveOperation(prefs.activeOperation); setTarget(prefs.target);
    setSAMVariant(value.view.samVariant === 'large-tv' ? 'large-tv' : 'small-tv');
    setDetailMode(value.view.detailMode === 'sam' ? 'sam' : 'uss'); setLastGuidance(value.view.lastGuidance);
    const detail = value.view.detailRequest, restoredStem = value.runs.flatMap(run => run.stems).find(stem => stem.id === detail?.stem.id);
    if (detail && restoredStem && !restoredStem.missing) setDetailRequest({ ...detail, stem: restoredStem });
    const z = value.view.layoutZoom; if (typeof z === 'number' && z >= 0.6 && z <= 1.5) setLayoutZoom(z);
    const share = value.view.workspaceShare; setWorkspaceShare(typeof share === 'number' ? Math.max(.1, Math.min(.9, share)) : .46);
    setTimelineExpanded(value.view.timelineExpanded === true);
    const floating = value.view.floatPosition; if (floating && Number.isFinite(floating.x) && Number.isFinite(floating.y)) setFloatPosition({ x: Math.max(0, Math.min(window.innerWidth - 100, floating.x)), y: Math.max(0, Math.min(window.innerHeight - 60, floating.y)) });
    if (value.view.floatSize) setFloatWidth(Math.max(180, Math.min(window.innerWidth - 16, value.view.floatSize.width)));
    setExportMode(value.view.exportMode === 'tracks' ? 'tracks' : 'mix');
    setProjectStatus('Saved'); setError(value.warnings.join(' '));
  }
  useEffect(() => {
    if (!window.desktop || projectInitialized.current) return;
    projectInitialized.current = true; switching.current = true;
    void window.desktop.getProject().then(hydrateProject).catch(cause => setError(String(cause))).finally(() => { switching.current = false; });
  }, []);
  useEffect(() => {
    if (pendingTransport.current && (!source?.url || video?.getAttribute('src') === source.url)) { transport.restore(pendingTransport.current); pendingTransport.current = null; }
  }, [project?.id, video, source?.url, transport]);
  session.current = project ? { projectId: project.id, runs, view: { selectedRun, model, activeOperation, target, detailMode, samVariant, lastGuidance, detailRequest, layoutZoom, workspaceShare, timelineExpanded, floatPosition, floatSize, exportMode, transport: pendingTransport.current || transport.snapshot(), timelines: timelines.current } } : null;
  const rememberTimeline = useCallback((value: TimelineView) => { if (selectedRun) timelines.current[selectedRun] = value; }, [selectedRun]);
  const currentPayload = (): ProjectPayload | null => session.current ? { ...session.current, view: { ...session.current.view, transport: pendingTransport.current || transport.snapshot(), timelines: { ...timelines.current } } } : null;
  const savedTransport = useRef<ProjectPayload['view']['transport'] | null>(null);
  async function flushProject() {
    const payload = currentPayload();
    if (!window.desktop || !payload) return;
    // While playing, only the playhead moves; keep the last saved position so autosave stays a no-op.
    if (transport.snapshot().playing && savedTransport.current) payload.view.transport = savedTransport.current; else savedTransport.current = payload.view.transport;
    setProjectStatus('Saving…');
    try { await window.desktop.saveProject(payload); setProjectStatus('Saved'); }
    catch (cause) { setProjectStatus('Save failed'); throw cause; }
  }
  const flushRef = useRef(flushProject); flushRef.current = flushProject;
  useEffect(() => {
    if (!window.desktop) return;
    let saving = false;
    const timer = setInterval(() => { if (!session.current || switching.current || saving) return; saving = true; void flushRef.current().catch(cause => setError(String(cause))).finally(() => { saving = false; }); }, 2000);
    const off = window.desktop.onProjectClose(() => {
      transport.pause();
      const payload = currentPayload();
      if (!payload) { void window.desktop!.closeProject(null).catch(cause => setError(String(cause))); return; }
      void window.desktop!.closeProject(payload).catch(cause => { setProjectStatus('Save failed'); setError(String(cause)); });
    });
    return () => { clearInterval(timer); off(); };
  }, [transport]);
  async function projectAction(action: string, argument?: unknown) {
    if (!window.desktop || !session.current || switching.current) return;
    switching.current = true; setProjectBusy(true); setError(''); transport.pause();
    try {
      await flushProject();
      const value = await window.desktop.projectAction(action, currentPayload()!, argument);
      if (value && 'runs' in value) { hydrateProject(value); setProjectsOpen(false); }
      else if (value?.info) { setProject(value.info); setProjectName(value.info.name); }
      setRecent(await window.desktop.recentProjects());
    } catch (cause) { setError(String(cause)); }
    finally { switching.current = false; setProjectBusy(false); }
  }
  async function showProjects() { setProjectsOpen(true); if (window.desktop) setRecent(await window.desktop.recentProjects()); }
  const initialized = useRef(false);
  useEffect(() => {
    if (!window.desktop || initialized.current) return;
    initialized.current = true;
    (async () => {
      const saved = await window.desktop!.getProfile(); setProfile(saved);
      if (saved.setupComplete) setSettings(false);
      if (saved.managedProxy) {
        setPreparingProxy(true); setBusy(true);
        try {
          setProxyState(await window.desktop!.startProxy(saved));
          const result = await window.desktop!.checkConnection(saved); setConnection(result);
          const audio = await window.desktop!.checkEngine(saved); setEngine(audio);
          if (saved.setupComplete && (!result.comfy || !result.proxy || !audio.ready)) setSettings(true);
        } finally { setPreparingProxy(false); setBusy(false); }
      }
    })().catch(cause => { setError(cause instanceof Error ? cause.message : 'Saved connection could not be prepared.'); setSettings(true); });
  }, []);
  const proxyIdle = !preparingProxy && !['checking', 'downloading', 'installing', 'starting'].includes(proxyState?.phase || '');
  const jobIdle = ['idle', 'complete', 'failed', 'cancelled'].includes(job.phase);
  // Poll quickly only while something is running; unchanged answers never re-render the app.
  useEffect(() => {
    if (!window.desktop) return;
    let active = true;
    const read = () => window.desktop!.proxyStatus().then(value => {
      if (!active) return;
      setProxyState(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);
      if (value.phase === 'error') setConnection(current => current && current.proxy ? { ...current, proxy: false, proxyDetail: value.message } : current);
    }).catch(() => {});
    read(); const timer = setInterval(read, proxyIdle ? 4000 : 1000);
    return () => { active = false; clearInterval(timer); };
  }, [proxyIdle]);
  useEffect(() => {
    if (!window.desktop) return;
    let active = true;
    const read = () => window.desktop!.stemStatus().then(value => { if (active) setJob(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); }).catch(() => {});
    const timer = setInterval(read, jobIdle ? 3000 : 1000);
    return () => { active = false; clearInterval(timer); };
  }, [jobIdle]);
  // Channels a job just added slide in once; the set clears shortly after so revisiting a take does not replay it.
  useEffect(() => {
    if (job.phase !== 'complete' || !job.runId || !job.stems.length) return;
    setFresh(new Set(job.stems.map(stem => stem.id)));
    const timer = setTimeout(() => setFresh(new Set()), 6000);
    return () => clearTimeout(timer);
  }, [job.runId]);
  // A finished job becomes part of the project. Results that finished while the interface was not looking (a new job started
  // before the last answer was read, or the page was in a background tab) arrive once as `job.earlier` and are added the same way.
  const adoptRun = (done: StemJob) => {
    if (done.phase !== 'complete' || !done.runId) return;
    if (done.rootRunId) {
      setRuns(values => values.map(value => value.runId === done.rootRunId ? { ...value, stems: [...value.stems, ...done.stems.filter(stem => !value.stems.some(existing => existing.id === stem.id))] } : value));
    } else {
      setRuns(values => values.some(value => value.runId === done.runId) ? values : [...values, done].slice(-12));
      setSelectedRun(done.runId!);
    }
  };
  useEffect(() => { adoptRun(job); }, [job.runId]);
  useEffect(() => { if (job.earlier?.length) { for (const item of job.earlier) adoptRun(item); setFresh(new Set(job.earlier.flatMap(item => item.stems.map(stem => stem.id)))); } }, [job.earlier]);
  const connected = connection?.comfy && connection.proxy;
  const proxyWorking = preparingProxy || ['checking', 'downloading', 'installing', 'starting'].includes(proxyState?.phase || '');
  const jobBusy = !['idle', 'complete', 'failed', 'cancelled'].includes(job.phase);
  jobPhase.current = job.phase;
  useEffect(() => {
    if (!jobBusy || !window.desktop) return;
    let alive = true, timer: ReturnType<typeof setTimeout>, tracker: Tracker | null = null;
    const poll = async () => {
      try { const sample = await window.desktop!.resources(profile); if (sample?.online) tracker = tracker ? sampleTracker(tracker, sample) : startTracker(sample); } catch { /* telemetry is optional */ }
      if (alive) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      alive = false; clearTimeout(timer);
      const key = usageKey.current;
      if (tracker && key && jobPhase.current === 'complete') setUsage(previous => { const next = remember(previous, key, finishTracker(tracker!)); try { localStorage.setItem('modelUsage', JSON.stringify(next)); } catch { /* ignore */ } return next; });
    };
  }, [jobBusy]);
  const canSeparate = !!window.desktop && !!source && !source.missing && !!connected && !!engine?.ready && !jobBusy && !projectBusy;
  const wholeRange = { start: 0, end: playback.duration };
  let sourceGuidanceError = '';
  if (modelKind === 'prompt') { try { if (!sourceGuidance.visualOnly && !sourceGuidance.description?.trim()) throw Error('Describe the sound you want, or draw a visual target.'); normalizeGuidance(sourceGuidance, wholeRange); } catch (cause) { sourceGuidanceError = cause instanceof Error ? cause.message : String(cause); } }
  const samReady = !!engine?.sam && !!engine?.samPrompts && !!sam?.ready;
  const musicReady = !!engine?.music && !!engine?.musicModel;
  const ussReady = !!engine?.targets?.includes(target);
  const modelReady = modelKind === 'stems' || (modelKind === 'music' && musicReady) || (modelKind === 'uss' && ussReady) || (modelKind === 'prompt' && playback.duration > 0 && samReady && !sourceGuidanceError);
  const runLabel = modelKind === 'stems' ? 'Separate stems' : modelKind === 'music' ? 'Separate music' : modelKind === 'uss' && target === 'All' ? 'Extract all sounds' : 'Extract sound';
  const setupName = modelKind === 'prompt' ? 'SAM' : modelKind === 'music' ? '6-stem' : 'USS';
  const modalFor = (kind?: string) => kind === 'prompt' ? 'sam' : kind === 'uss' ? 'uss' : kind === 'music' ? 'music' : null;
  const separationHint = !source ? 'Choose a source first.' : !connected ? 'Check your ComfyUI and proxy connection first.' : !engine?.ready ? 'Audio engine is not ready. Check connection settings or retry setup.' : modelKind === 'prompt' ? (!samReady ? 'Prepare SAM Audio first.' : sourceGuidanceError || 'SAM Audio pulls the described sound from the whole source.') : modelKind === 'music' ? (!musicReady ? 'Download the music model first.' : 'Six stereo music stems. The original source stays untouched.') : modelKind === 'uss' ? (!ussReady ? 'USS models are not installed, or the integration is out of date.' : target === 'All' ? 'Every detected sound class becomes its own channel.' : `Pulls "${target}" out of the whole source.`) : 'Three mono stems. The original source stays untouched.';
  async function separate() {
    if (!window.desktop || !source || !canSeparate || !modelReady) return;
    usageKey.current = modelKind === 'stems' ? model : modelKind === 'music' ? 'music6' : modelKind === 'uss' ? 'uss' : 'sam';
    setError(''); setSaveNotice('');
    try {
      if (modelKind === 'prompt') {
        const label = sourceGuidance.visualOnly ? 'Visual target' : sourceGuidance.description!.trim();
        setJob(await window.desktop.separateStems(profile, source.url, { mode: 'sam', samModel: samVariant, target: label, threshold: 0.1, range: wholeRange, sam: sourceGuidance, videoUrl: source.url }));
      } else if (modelKind === 'uss') {
        setJob(await window.desktop.separateStems(profile, source.url, { mode: 'uss', target, threshold: 0.1, autoThreshold: !!engine?.autoThreshold }));
      } else if (modelKind === 'music') {
        setJob(await window.desktop.separateStems(profile, source.url, { mode: 'music' }));
      } else setJob(await window.desktop.separateStems(profile, source.url, { model, mode: 'stems' }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function extractDetail(request: DetailRequest, mode: 'uss' | 'sam' | 'guidesep' = 'uss', chosen = 'All', guidance?: SAMGuidance, referenceAudio?: ReferenceAudio) {
    if (!window.desktop || !canSeparate || !currentRun?.runId) return;
    if (!shownStems.some(stem => stem.id === request.stem.id)) return;
    setActiveOperation('uss'); setDetailRequest(request); setDetailMode(mode === 'sam' ? 'sam' : 'uss'); setTarget(chosen); setLastGuidance(guidance); setDetailOpen(false);
    usageKey.current = mode;
    setError(''); setSaveNotice('');
    const base = { range: { start: request.start, end: request.end }, parentId: request.stem.id, rootRunId: currentRun.runId, edits: timelines.current[currentRun.runId]?.edits?.[request.stem.id] };
    try {
      if (mode === 'guidesep') setJob(await window.desktop.separateStems(profile, request.stem.url, { ...base, mode: 'guidesep', target: chosen, referenceUrl: (referenceAudio || reference)?.url, referenceOffset }));
      else setJob(await window.desktop.separateStems(profile, request.stem.url, { ...base, mode, samModel: mode === 'sam' ? samVariant : undefined, target: chosen, threshold: 0.1, autoThreshold: mode === 'uss', ...(mode === 'sam' && guidance ? { sam: guidance, videoUrl: source?.url } : {}) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function details(stem: Stem, start: number, end: number, picker: boolean) {
    const request = { stem, start, end }; setDetailRequest(request); setActiveOperation('uss');
    if (picker) setDetailOpen(true); else void extractDetail(request);
  }
  async function exportVideo() {
    if (!window.desktop || !source || !shownStems.length || videoExporting) return;
    setVideoExporting(true); setError(''); setExportState({ phase: 'idle', progress: 0, message: 'Choose an export location…' });
    try {
      const path = await window.desktop.exportVideo(profile, { sourceUrl: source.url, stems: shownStems.map(stem => ({ id: stem.id, label: stem.label, edits: timelines.current[currentRun?.runId || ""]?.edits?.[stem.id], ...(exportMix.current[stem.id] || { mute: false, solo: false, level: 1 }) })), mode: exportMode, format: 'mp4', duration: playback.duration, sourceName: source.name });
      if (path) { setSaveNotice(`Video saved to ${path}`); setExportOpen(false); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setVideoExporting(false); }
  }
  async function saveStems(id?: string) {
    if (!window.desktop) return;
    setExporting(true); setError('');
    try { const path = id ? await window.desktop.saveStem(id, timelines.current[currentRun?.runId || ""]?.edits?.[id], profile) : await window.desktop.saveAllStems(shownStems.map(stem => stem.id), timelines.current[currentRun?.runId || ""]?.edits, profile); if (path) setSaveNotice(`Stems saved to ${path}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setExporting(false); }
  }
  // Closing only removes the take from this project's view; its audio files stay where ComfyUI wrote them.
  function closeTake(id: string, others = false) {
    if (jobBusy && job.rootRunId && (others || job.rootRunId === id)) return;
    const remaining = others ? runs.filter(run => run.runId === id) : runs.filter(run => run.runId !== id);
    if (remaining.length === runs.length) return;
    for (const run of runs) if (!remaining.includes(run) && run.runId) delete timelines.current[run.runId];
    const index = runs.findIndex(run => run.runId === id);
    setRuns(remaining);
    if (!remaining.some(run => run.runId === activeId)) setSelectedRun(others ? id : remaining[Math.min(index, remaining.length - 1)]?.runId || '');
    setDetailRequest(null); setDetailOpen(false);
  }
  async function runBrush(prompt: string, choice: { model: 'small' | 'medium' | 'mmaudio'; video: boolean }) {
    const region = brushRegion;
    if (!window.desktop || !source || !region || !canSeparate) return;
    setBrushRegion(null); transport.clearSelection(); usageKey.current = `brush-${choice.model}`; setError(''); setSaveNotice('');
    try { setJob(await window.desktop.separateStems(profile, source.url, { mode: 'brush', target: prompt, rootRunId: currentRun?.runId, videoUrl: choice.video ? source.url : undefined, brush: { prompt, seconds: region.end - region.start, start: region.start, seed: Math.floor(Math.random() * 2 ** 31), model: choice.model, video: choice.video } })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function refreshEngine() { if (window.desktop) setEngine(await window.desktop.checkEngine(profile)); }
  // The label is the only thing that changes; the audio file, edits and take stay as they are.
  function renameChannel(id: string, label: string) {
    const text = label.trim().slice(0, 160); if (!text) return;
    setRuns(values => values.map(run => run.stems.some(stem => stem.id === id) ? { ...run, stems: run.stems.map(stem => stem.id === id ? { ...stem, label: text } : stem) } : run));
  }
  function deleteChannels(ids: string[]) {
    const runId = currentRun?.runId;
    if (!runId || (jobBusy && job.rootRunId === runId)) return;
    const result = removeChannels(runs, runId, ids);
    setRuns(result.runs);
    if (result.takeRemoved) { delete timelines.current[runId]; setSelectedRun(result.runs.at(-1)?.runId || ''); }
    if (detailRequest && ids.includes(detailRequest.stem.id)) { setDetailRequest(null); setDetailOpen(false); }
  }
  function chooseModel(id: string) { setModel(id); setModelModal(modalFor(MODELS.find(item => item.id === id)?.kind)); }
  function makeReference(stem: Stem) { setReference({ name: stem.label, size: stem.size, url: stem.url }); setSaveNotice(`"${stem.label}" is now the GuideSep reference. Right-click a channel, choose Extract sound and pick GuideSep.`); }
  async function exportMixFile(options: MixExportOptions) {
    if (!window.desktop) return null;
    setError(''); setSaveNotice('');
    const path = await window.desktop.exportMix(profile, options);
    if (path) setSaveNotice(`Mix saved to ${path}`);
    return path;
  }
  const batchOptions: BatchOptions | null = modelKind === 'stems' ? { mode: 'stems', model } : modelKind === 'music' ? { mode: 'music' } : modelKind === 'uss' ? { mode: 'uss', target, autoThreshold: !!engine?.autoThreshold } : sourceGuidance.description?.trim() ? { mode: 'sam', samModel: samVariant, target: sourceGuidance.description.trim() } : null;
  const batchBlocked = !connected ? 'Check the ComfyUI connection first' : !engine?.ready ? 'The audio engine is not ready' : modelKind === 'stems' ? (engine.models?.includes(model) ? '' : 'This model is not installed') : modelKind === 'music' ? (musicReady ? '' : 'Download the music model first') : modelKind === 'uss' ? (ussReady ? '' : 'Choose an installed USS sound first') : (!samReady ? 'Prepare SAM Audio first' : !sourceGuidance.description?.trim() ? 'Describe the sound in the SAM options first' : '');
  const batchLabel = modelKind === 'stems' ? modelName(model) || model : modelKind === 'music' ? 'HTDemucs · six music stems' : modelKind === 'uss' ? `USS · ${target === 'All' ? 'all detected sounds' : target}` : `SAM Audio · ${sourceGuidance.description?.trim() || 'no description yet'}`;
  useEffect(() => {
    setSuggestion(null);
    if (!source || source.missing || !window.desktop || source.size > 80 * 1048576) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const bytes = await (await fetch(source.url)).arrayBuffer();
        const ctx = new AudioContext({ sampleRate: 16000 });
        try {
          const buffer = await ctx.decodeAudioData(bytes);
          if (cancelled) return;
          const mono = new Float32Array(buffer.length);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) { const data = buffer.getChannelData(channel); for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels; }
          setSuggestion(suggestModel(analyzeSource(mono, buffer.sampleRate)));
        } finally { void ctx.close(); }
      } catch { /* the suggestion is optional */ }
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [source?.url]);
  async function prepareProxy() {
    if (!window.desktop) return;
    setPreparingProxy(true); setBusy(true); setError(''); setConnection(null);
    try {
      const status = await window.desktop.startProxy(profile); setProxyState(status);
      setProfile(p => ({ ...p, managedProxy: status.owned }));
      setConnection(await window.desktop.checkConnection(profile));
      setEngine(await window.desktop.checkEngine(profile));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Automatic proxy setup failed.'); }
    finally { setPreparingProxy(false); setBusy(false); }
  }
  async function stopProxy() {
    try { const state = await window.desktop?.stopProxy(); if (state) setProxyState(state); setConnection(null); setProfile(p => ({ ...p, managedProxy: false })); }
    catch (cause) { setError(String(cause)); }
  }
  async function verify() {
    if (!window.desktop) { setError('Open the desktop application to check a local connection. Browser connection support is planned.'); return; }
    setBusy(true); setError(''); setConnection(null); setSaveNotice('');
    try { const result = await window.desktop.checkConnection(profile); setConnection(result); setEngine(await window.desktop.checkEngine(profile)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Connection check failed.'); }
    finally { setBusy(false); }
  }
  async function saveConnection() {
    if (!window.desktop) { setError('Open the desktop application to save a connection profile.'); return; }
    setSaving(true); setError(''); setSaveNotice('');
    try {
      const saved = await window.desktop.saveProfile(profile);
      setProfile(saved);
      setSaveNotice('Connection settings saved. You can use the workspace without a running ComfyUI.');
      setSettings(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be saved.'); }
    finally { setSaving(false); }
  }
  async function browse() {
    try { const path = await window.desktop?.chooseInstallation(); if (path) setProfile(p => ({ ...p, installation: path })); }
    catch (cause) { setError(String(cause)); }
  }
  async function openVideo() {
    setError('');
    try { const next = await window.desktop?.openVideo(); if (next) await projectAction('source', next); } catch (cause) { setError(String(cause)); }
  }
  return <div className="app-shell studio-workspace">
    <TooltipLayer/>
    <header className="topbar"><div className="brand"><img className="primary-comfy-logo" src={comfyWordmark} alt="Comfy"/><img className="stem-logo" src={stemLogo} alt="Stem Studio"/></div><button className="project-switch" onClick={() => void showProjects()} title={project?.path || "Projects"} disabled={!project || projectBusy}><FolderOpen size={14}/><span>{project?.name || "Project"}</span><small>{projectStatus}</small></button><ResourceMonitor profile={profile}/><div className="topbar-right"><button className={`connection-pill ${connected ? 'online' : ''}`} onClick={() => setSettings(true)} title="Connection settings" aria-label="Connection settings"><span className="status-dot"/><Settings2 size={16}/></button><div className="layout-zoom" aria-label="Layout scale"><button className="icon-button" aria-label="Zoom layout out" disabled={layoutZoom <= 0.6} onClick={() => setLayoutZoom(value => Math.max(0.6, Math.round((value - 0.1) * 10) / 10))}><ZoomOut size={15}/></button><button className="zoom-reset" title="Reset layout scale" onClick={() => setLayoutZoom(1)}>{Math.round(layoutZoom * 100)}%</button><button className="icon-button" aria-label="Zoom layout in" disabled={layoutZoom >= 1.5} onClick={() => setLayoutZoom(value => Math.min(1.5, Math.round((value + 0.1) * 10) / 10))}><ZoomIn size={15}/></button></div><button className="icon-button" aria-label="Shortcuts and models" data-tip={'Shortcuts and models\n?'} onClick={() => setShortcutsOpen(true)}><CircleHelp size={15}/></button></div></header>
    <main ref={workspaceMain} className={`workspace-main ${timelineExpanded ? 'timeline-expanded' : ''}`} style={{ '--workspace-height': `${topHeight}px` } as React.CSSProperties}>
      <div className="workspace-grid">
        <aside className="panel controls-panel">
          <div className="panel-heading"><h2>Separator</h2><div className="mode-tabs" role="tablist" aria-label="Separator mode"><button role="tab" aria-selected={panelTab === 'single'} className={panelTab === 'single' ? 'is-selected' : ''} onClick={() => setPanelTab('single')}>Single</button><button role="tab" aria-selected={panelTab === 'batch'} className={panelTab === 'batch' ? 'is-selected' : ''} disabled={!window.desktop} onClick={() => setPanelTab('batch')}>Batch</button></div><JobProgress job={job}/></div>
          <div className="control-content" tabIndex={0} aria-label="Separator controls">
            {panelTab === 'single' && <button className="source-card" onClick={openVideo} disabled={jobBusy || videoExporting || projectBusy || !project}><span className="source-icon"><Clapperboard size={17}/></span><span className="source-description"><strong>{source ? source.name : 'Add video or audio'}</strong><small>{source ? source.missing ? 'Missing video · relink in Projects' : `${(source.size / 1048576).toFixed(1)} MiB` : 'MP4, MOV, MKV, MP3, WAV, FLAC and more'}</small></span><Plus size={15}/></button>}
            <div className={`operation-section ${activeOperation === 'stems' ? 'is-selected' : ''}`} onFocusCapture={() => setActiveOperation('stems')} onPointerDownCapture={() => setActiveOperation('stems')}>
            <ModelPicker value={model} onChange={chooseModel} disabled={jobBusy} installed={{ mrx: engine?.models ? engine.models.includes('mrx') : undefined, bandit: engine?.models ? engine.models.includes('bandit') : undefined, sfc: engine?.models ? engine.models.includes('sfc') : undefined, sam: engine ? !!engine.sam : undefined, music6: engine ? musicReady : undefined, uss: engine ? !!engine.targets?.length : undefined }}/>
            {panelTab === 'single' ? <>
              <button className="model-summary" disabled={jobBusy || modelKind === 'stems'} onClick={() => setModelModal(modalFor(modelKind))} data-tip={modelKind === 'stems' ? MODELS.find(item => item.id === model)?.detail : 'Open options'}><span>{modelKind === 'prompt' ? `${modelName(model)} · ${samVariant === 'small-tv' ? 'Small' : 'Large'} · ${sourceGuidance.visualOnly ? 'Visual target' : sourceGuidance.description?.trim() || 'Describe the sound'}` : modelKind === 'uss' ? `${modelName(model)} · ${target === 'All' ? 'All detected sounds' : target}` : modelName(model)}</span>{modelKind !== 'stems' && <SlidersHorizontal size={13}/>}</button>
              {suggestion && suggestion.model !== model && modelKind === 'stems' && <button className="model-suggestion" onClick={() => chooseModel(suggestion.model)} data-tip={`${suggestion.text}\n${suggestion.detail}`}><Lightbulb size={12}/><span>{suggestion.text} · try {MODELS.find(item => item.id === suggestion.model)?.short}</span></button>}
              <button className="primary-button" disabled={modelKind !== 'stems' && !modelReady ? jobBusy : !canSeparate} onClick={() => { if (modelKind !== 'stems' && !modelReady) setModelModal(modalFor(modelKind)); else void separate(); }} title={separationHint}>{jobBusy ? <LoaderCircle size={17} className="spin"/> : <AudioLines size={17}/>} {jobBusy ? 'Working' : modelKind !== 'stems' && !modelReady ? `Set up ${setupName}` : runLabel}{activeOperation === 'stems' && !jobBusy && <kbd>Ctrl ↵</kbd>}<ArrowUpRight size={16}/></button>
              {!jobBusy && (job.phase === 'failed' || job.phase === 'cancelled') && <p className="helper" role="status">{job.message}</p>}
              {job.canCancel && <button className="quiet-button" onClick={() => window.desktop?.cancelSeparation().then(setJob).catch(cause => setError(String(cause)))}>Cancel</button>}
            </> : <BatchPanel profile={profile} options={batchOptions} label={batchLabel} blocked={batchBlocked}/>}
            </div>
          </div>
        </aside>
        <section className={`panel preview-panel ${timelineExpanded && source ? 'floating-preview' : ''} ${externalPreview ? 'is-external' : ''} ${backdropOn ? 'is-backdrop' : ''}`} onContextMenu={event => { if (!timelineExpanded || !source || !window.desktop) return; event.preventDefault(); setPreviewMenu({ x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 70) }); }} style={backdropOn && backdropRect ? { left: backdropRect.x, top: backdropRect.y, width: backdropRect.w, height: backdropRect.h, maxWidth: "none", aspectRatio: "auto", ...(externalPreview ? {} : { opacity: backdropOpacity }) } : timelineExpanded ? { left: floatPosition.x, top: floatPosition.y, width: floatSize.width, height: floatSize.height, maxWidth: "none", aspectRatio: "auto" } : undefined} onClick={() => { if (timelineExpanded && !floatMoved.current) void transport.toggle(); floatMoved.current = false; }}
          onPointerDown={event => { if (!timelineExpanded || !source || event.button !== 0) return; floatMoved.current = false; floatDrag.current = { x: event.clientX, y: event.clientY, left: floatPosition.x, top: floatPosition.y, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { const drag = floatDrag.current; if (!drag) return; const zoom = pageZoom(), dx = (event.clientX - drag.x) / zoom, dy = (event.clientY - drag.y) / zoom; if (Math.abs(dx) + Math.abs(dy) > 3 / zoom) drag.moved = true; if (drag.moved) { const box = clampFloat({ ...floatSize, left: drag.left + dx, top: drag.top + dy }, { width: window.innerWidth / zoom, height: window.innerHeight / zoom }); setFloatPosition({ x: box.left, y: box.top }); } }}
          onPointerUp={event => { floatMoved.current = !!floatDrag.current?.moved; floatDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { floatDrag.current = null; }} onLostPointerCapture={() => { floatDrag.current = null; }}>{timelineExpanded && ['n','s','e','w','nw','ne','sw','se'].map(edge => <div key={edge} className={`floating-edge floating-edge-${edge}`} onClick={event => event.stopPropagation()} onPointerDown={event => { event.preventDefault();event.stopPropagation();floatResize.current={edge,x:event.clientX,y:event.clientY,...floatSize,left:floatPosition.x,top:floatPosition.y};event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={resizeFloatBox} onPointerUp={event => {event.stopPropagation();floatResize.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={() => {floatResize.current=null;}} onLostPointerCapture={() => {floatResize.current=null;}}/>)}<div className="panel-heading"><h2>Preview</h2></div><div className={`preview-stage ${source ? 'has-source' : ''}`}>{source && !source.missing ? <><video ref={setVideo} key={source.url} src={source.url} onLoadedMetadata={event => setVideoRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight || 16 / 9)} onClick={() => { if (!timelineExpanded) void transport.toggle(); }} onError={() => setMediaError(true)}/>{sourceIsAudio && <div className="audio-badge"><AudioLines size={34}/><span>{source.name}</span></div>}{mediaError && <p className="video-error">Unsupported preview codec. Try an H.264 MP4 or a common audio format.</p>}</> : <div className="empty-preview"><button className="secondary-button" onClick={openVideo}><Plus size={16}/> Open video or audio</button></div>}</div><PreviewFooter transport={transport} playback={playback}/></section>
      </div>
      <StemTimeline backdrop={timelineExpanded && source && !sourceIsAudio ? { on: previewBackdrop, toggle: () => setPreviewBackdrop(value => !value), opacity: backdropOpacity, preview: value => { (document.querySelector('.preview-panel.is-backdrop') as HTMLElement | null)?.style.setProperty('opacity', String(value)); }, change: setBackdropOpacity } : null} pending={jobBusy ? { message: job.message, progress: typeof job.progress === 'number' ? job.progress : null, eta: typeof job.eta === 'number' ? job.eta : null } : null} renameChannel={renameChannel} deleteChannels={deleteChannels} brushAvailable={!!source && !!connected && !!engine?.ready && !jobBusy && !projectBusy} onBrush={region => setBrushRegion(region)} closeTake={closeTake} key={`${project?.id || "scratch"}:${currentRun?.runId || "empty"}`} initialView={timelines.current[currentRun?.runId || ""]} onViewChange={rememberTimeline} details={details} detailBusy={jobBusy || !canSeparate} detailAvailable={!!engine?.detailRange} expanded={timelineExpanded} toggleExpanded={() => setTimelineExpanded(value => !value)} resize={resizeWorkspace} resetSize={() => setWorkspaceShare(0.46)} workspaceHeight={topHeight} resizeBounds={{ min: workspaceTop(workspaceAvailable, 0), max: workspaceTop(workspaceAvailable, Infinity) }} stems={shownStems} save={saveStems} takes={runs.map(run => ({ id: run.runId!, label: modelNames[run.model || ''] || run.model || 'Take' }))} selectedTake={currentRun?.runId || ''} selectTake={pickRun} freshIds={fresh} externalPreview={externalPreview} bringPreviewBack={() => void bringPreviewBack()} useAsReference={makeReference} exportMixFile={exportMixFile} sourceName={source?.name.replace(/\.[^.]+$/, '') || 'mix'} canExportVideo={!!source && !sourceIsAudio} exporting={exporting || videoExporting} exportVideo={mix => { exportMix.current = mix; setExportState({ phase: 'idle', progress: 0, message: '' }); setError(''); setExportOpen(true); }} independent={(currentRun?.model || job.model) === 'USS · All'} transport={transport} playback={playback}/>
      {playback.error && <p className="error-banner" role="alert">{playback.error}</p>}
      {saveNotice && !settings && <p className="save-notice" role="status" onClick={() => setSaveNotice('')} data-tip="Click to dismiss"><Check size={14}/>{saveNotice}</p>}
      {error && !settings && <p className="error-banner" role="alert">{error}</p>}
    </main>
    {detailOpen && detailRequest && <DetailPicker reference={reference} setReference={setReference} referenceOffset={referenceOffset} setReferenceOffset={setReferenceOffset} variant={samVariant} setVariant={setSAMVariant} sourceUrl={source?.url || ''} submitShortcut={detailShortcut} request={detailRequest} profile={profile} engine={engine} busy={jobBusy} close={() => setDetailOpen(false)} extract={(mode, target, guidance, referenceAudio) => void extractDetail(detailRequest, mode, target, guidance, referenceAudio)}/>}
    {modelModal === 'sam' && <ModelModal icon={<Sparkles size={15}/>} title="SAM Audio" close={() => setModelModal(null)} note={!source ? 'Open a source first' : sourceGuidanceError || (samReady ? 'Pulls the sound from the whole source' : 'Prepare SAM Audio first')} runLabel="Extract sound" runDisabled={!canSeparate || !modelReady} run={() => { setModelModal(null); void separate(); }}>
      <SAMVariantSwitch variant={samVariant} setVariant={setSAMVariant} disabled={jobBusy} largeAvailable={!!engine?.samModels} reset={() => setSAM(null)}/>
      {playback.duration > 0 ? <SAMGuidanceEditor key={`${source?.url}:${playback.duration}`} range={wholeRange} sourceUrl={source?.url || ''} value={sourceGuidance} change={setSourceGuidance} supported={!!engine?.samPrompts} visualSupported={!!engine?.samVisual && !sourceIsAudio}/> : <p className="helper">Open a source to describe the sound you want.</p>}
      <SAMPrepare sam={sam} setSAM={setSAM} profile={profile} variant={samVariant} busy={jobBusy}/>
    </ModelModal>}
    {modelModal === 'uss' && <ModelModal icon={<ScanSearch size={15}/>} title="USS · sound by name" close={() => setModelModal(null)} note={!source ? 'Open a source first' : !engine?.targets?.length ? 'USS is not installed' : ussReady ? (target === 'All' ? 'Every detected sound becomes a channel' : `Pulls "${target}" from the whole source`) : 'Choose a sound'} runLabel={target === 'All' ? 'Extract all' : 'Extract'} runDisabled={!canSeparate || !modelReady} run={() => { setModelModal(null); void separate(); }}>
      {engine?.targets?.length ? <TargetPicker target={target} setTarget={setTarget} withAll installed={engine.targets}/> : <p className="helper">USS and PANNs are not installed in your ComfyUI, or the integration is out of date. Run the setup again with USS selected and restart ComfyUI.</p>}
    </ModelModal>}
    {modelModal === 'music' && <ModelModal icon={<Music4 size={15}/>} title="HTDemucs · six music stems" close={() => setModelModal(null)} note={!source ? 'Open a source first' : musicReady ? 'Splits the whole source into six channels' : 'Download the music model first'} runLabel="Separate music" runDisabled={!canSeparate || !modelReady} run={() => { setModelModal(null); void separate(); }}>
      <MusicPanel engine={engine} profile={profile} refreshEngine={refreshEngine}/>
    </ModelModal>}
    {brushRegion && <BrushModal region={brushRegion} engine={engine} profile={profile} busy={jobBusy || !canSeparate} close={() => { setBrushRegion(null); transport.clearSelection(); }} hasVideo={!!source && !sourceIsAudio} refreshEngine={refreshEngine} run={(prompt, choice) => void runBrush(prompt, choice)}/>}
    {previewMenu && <div className="timeline-context-menu preview-menu" role="menu" aria-label="Preview actions" style={{ left: previewMenu.x / pageZoom(), top: previewMenu.y / pageZoom() }}>{externalPreview ? <button role="menuitem" onClick={() => void bringPreviewBack()}><Clapperboard size={14}/> Bring the preview back</button> : <button role="menuitem" onClick={() => void sendPreview()}><Clapperboard size={14}/> Send preview to another display</button>}</div>}
    <Grain/>
    {shortcutsOpen && <ShortcutsPanel close={() => setShortcutsOpen(false)} usage={usage}/>}
    {projectsOpen && <div className="modal-backdrop"><section className="connection-modal projects-modal" role="dialog" aria-modal="true" aria-labelledby="projects-title">
      <div className="modal-top"><span className="eyebrow"><FolderOpen size={14}/> PROJECTS</span><button className="icon-button" disabled={projectBusy} onClick={() => setProjectsOpen(false)} aria-label="Close projects"><X size={17}/></button></div>
      <h2 id="projects-title">Your workspace.</h2>
      <div className="project-current"><input className="project-name-input" aria-label="Project name" maxLength={100} value={projectName} onChange={event => setProjectName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.ctrlKey) void projectAction('rename', projectName); }}/><button className="secondary-button" disabled={projectBusy || !projectName.trim()} onClick={() => void projectAction('rename', projectName)}>Rename</button></div>
      <p className="project-path" title={project?.path}>{project?.path}</p>
      <div className="project-actions"><button disabled={projectBusy || jobBusy || videoExporting} onClick={() => void projectAction('new', 'Untitled project')}><Plus size={14}/> New</button><button disabled={projectBusy || jobBusy || videoExporting} onClick={() => void projectAction('open')}><FolderOpen size={14}/> Open</button><button disabled={projectBusy || jobBusy || videoExporting} onClick={() => void projectAction('copy')}><Save size={14}/> Save as</button><button disabled={projectBusy} onClick={() => void projectAction('folder')}>Show folder</button>{source && <button disabled={projectBusy || jobBusy || videoExporting} onClick={() => void projectAction('relink')}>Relink video</button>}</div>
      <div className="project-recent">{recent.map(item => <button key={item.path} disabled={projectBusy || jobBusy || videoExporting || item.path === project?.path} onClick={() => void projectAction('recent', item.path)}><span><strong>{item.name}</strong><small>{item.path}</small></span><time>{new Date(item.updatedAt).toLocaleDateString()}</time></button>)}</div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="modal-actions"><span className="subtle">{projectBusy ? 'Preparing project…' : 'Autosave on · resume last project'}</span><button className="primary-button" disabled={projectBusy} onClick={() => { void flushProject().then(() => setProjectsOpen(false)).catch(cause => setError(String(cause))); }}><Save size={14}/> Save</button></div>
    </section></div>}
    {exportOpen && <div className="modal-backdrop"><section className="connection-modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title"><div className="modal-top"><span className="eyebrow"><img className="comfy-modal-icon" src={comfyIcon} alt="Comfy"/> VIDEO EXPORT</span><button className="icon-button" disabled={videoExporting} onClick={() => setExportOpen(false)} aria-label="Close export"><X size={18}/></button></div><h2 id="export-title">Keep the picture.</h2><p className="modal-description">Saved by ComfyUI. Original video + lossless FLAC audio.</p><label>Audio<select value={exportMode} disabled={videoExporting} onChange={event => setExportMode(event.target.value as 'mix' | 'tracks')}><option value="mix">Current mix · mute, solo and levels</option><option value="tracks">Separate stem tracks · original levels</option></select></label><p className="helper">{exportMode === 'tracks' ? 'Embeds every stem as a separate selectable audio track. Mixer controls are ignored.' : 'Replaces the source audio with the current stem mix.'} MP4 · native ComfyUI SaveVideo.</p>{videoExporting && <div role="status"><progress max="1" value={exportState.progress}/><p className="helper">{exportState.message}</p></div>}{error && <p className="error-banner" role="alert">{error}</p>}<div className="modal-actions">{videoExporting ? <button className="secondary-button" onClick={() => void window.desktop?.cancelExport().catch(cause => setError(String(cause)))}>Cancel export</button> : <button className="secondary-button" onClick={() => setExportOpen(false)}>Cancel</button>}<button className="primary-button" disabled={videoExporting || !playback.duration} onClick={() => void exportVideo()}>{videoExporting ? 'Exporting…' : 'Export video'}</button></div></section></div>}
    {settings && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy && !saving && !proxyWorking) setSettings(false); }}>
      <section className="connection-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title">
        <header><span className="mini-title"><img className="comfy-modal-icon" src={comfyIcon} alt="Comfy"/><strong id="connection-title">Connection</strong></span><button className="icon-button" aria-label="Close connection settings" disabled={busy || saving || proxyWorking} onClick={() => setSettings(false)}><X size={15}/></button></header>
        {nodePack ? <><p className="settings-note">Running inside ComfyUI. Stem Studio uses this ComfyUI directly: no API proxy, address or folder is needed.</p><ModelPacks onChange={() => { void verify(); }}/></> : <>
        <div className="settings-grid">
          <label>ComfyUI<input value={profile.comfyUrl} disabled={busy || saving || proxyWorking} spellCheck={false} onChange={e => { setProfile({ ...profile, comfyUrl: e.target.value }); setConnection(null); setError(''); }}/></label>
          <label>API Proxy<input value={profile.proxyUrl} disabled={busy || saving || proxyWorking} spellCheck={false} onChange={e => { setProfile({ ...profile, proxyUrl: e.target.value }); setConnection(null); setError(''); }}/></label>
        </div>
        <div className="settings-folder"><span className="field-label">Folder</span><p title={profile.installation}>{profile.installation || 'No ComfyUI folder selected'}</p><button className="secondary-button" onClick={browse} disabled={!window.desktop || busy || saving}><FolderOpen size={13}/> Browse</button></div>
        </>}
        <div className="settings-status" role="status" aria-live="polite" aria-busy={busy}>
          <span data-tip={connection?.comfyDetail || 'Not checked yet'}><i className={`status-dot ${connection ? connection.comfy ? 'green' : 'unavailable' : ''}`}/>ComfyUI <em>{busy ? 'Checking…' : connection ? connection.comfy ? 'Reachable' : 'Unavailable' : 'Not checked'}</em></span>
          {!nodePack && <span data-tip={connection?.proxyDetail || 'Not checked yet'}><i className={`status-dot ${connection ? connection.proxy ? 'green' : 'unavailable' : ''}`}/>Proxy <em>{busy ? 'Checking…' : connection ? connection.proxy ? 'Reachable' : 'Unavailable' : 'Not checked'}</em></span>}
        </div>
        {(error || (connection && !(connection.comfy && connection.proxy))) && <p className="settings-note error-text" role="alert">{error || connection?.message}</p>}
        {!nodePack && <>
        <div className="settings-proxy">
          <div className="settings-proxy-row">
            <button className="secondary-button" onClick={prepareProxy} disabled={!window.desktop || busy || saving || proxyWorking || (proxyState?.phase === 'running' && proxyState.owned)} data-tip="Prepare and start the official proxy. First use downloads a private Python runtime.">{proxyWorking ? <LoaderCircle size={13} className="spin"/> : <Link2 size={13}/>} {proxyWorking ? 'Preparing' : 'Set up & start proxy'}</button>
            {(proxyState?.owned || proxyWorking) && <button className="quiet-button" onClick={stopProxy}>{proxyWorking ? 'Cancel' : 'Stop'}</button>}
            {(proxyState?.owned || profile.managedProxy) && <label className="proxy-auto"><input type="checkbox" checked={profile.managedProxy} disabled={busy || saving || proxyWorking} onChange={event => setProfile(p => ({ ...p, managedProxy: event.target.checked }))}/> Start with app</label>}
          </div>
          {proxyState?.message && <p className="settings-note" role="status">{proxyWorking && <LoaderCircle size={11} className="spin"/>} {proxyState.message}</p>}
          {proxyState?.detail && <details className="proxy-guide"><summary>Details</summary><pre>{proxyState.detail}</pre></details>}
        </div>
        </>}
        {nodePack ? <footer><span/><span><button className="secondary-button" onClick={verify} disabled={busy}>{busy ? <LoaderCircle size={13} className="spin"/> : <Link2 size={13}/>} Check</button><button className="primary-button" onClick={() => setSettings(false)}>Done</button></span></footer> : <footer>
          <button className="quiet-button" onClick={() => setSettings(false)} disabled={busy || saving || proxyWorking}><ArrowLeft size={12}/> Continue without saving</button>
          <span><button className="secondary-button" onClick={verify} disabled={busy || saving || proxyWorking}>{busy ? <LoaderCircle size={13} className="spin"/> : <Link2 size={13}/>} Check</button><button className="primary-button" onClick={saveConnection} disabled={busy || saving || proxyWorking}>{saving ? <LoaderCircle size={13} className="spin"/> : <Save size={13}/>} Save</button></span>
        </footer>}
      </section>
    </div>}
  </div>;
}
installWebDesktop(); // Node pack mode: ComfyUI serves this page, so a browser Desktop replaces Electron's preload.
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);







