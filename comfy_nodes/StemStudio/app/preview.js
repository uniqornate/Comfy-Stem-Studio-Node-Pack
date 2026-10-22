// Second window of the Stem Studio page. The video is muted and only follows the main page, which stays the transport and
// plays the sound. Messages travel over a BroadcastChannel, so nothing leaves the browser.
const video = document.getElementById('picture');
const source = new URLSearchParams(location.search).get('src') || '';
// Only a path on this same server is accepted.
if (source.startsWith('/') && !source.startsWith('//')) video.src = source;
let latest = null;
function follow(state) {
  if (!state) return;
  latest = state; video.playbackRate = state.rate || 1;
  const drift = Math.abs(video.currentTime - state.position);
  if (!state.playing) { if (!video.paused) video.pause(); if (drift > 0.03) video.currentTime = state.position; return; }
  if (drift > 0.3 || video.paused) video.currentTime = state.position;
  if (video.paused) void video.play().catch(() => {});
}
video.addEventListener('loadedmetadata', () => follow(latest));
const channel = new BroadcastChannel('stemstudio-preview');
channel.onmessage = event => {
  const message = event.data || {};
  if (message.type === 'state') follow(message);
  else if (message.type === 'close') window.close();
  else if (message.type === 'ping') channel.postMessage({ type: 'pong' });
};
channel.postMessage({ type: 'ready' });
window.addEventListener('pagehide', () => channel.postMessage({ type: 'closed' }));
window.addEventListener('dblclick', () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); });
