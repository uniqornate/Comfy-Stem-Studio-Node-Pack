export function normalizeEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid server address.');
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS address without credentials, query parameters or fragments.');
  }
  return url.href.replace(/\/+$/, '');
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}.`);
  try { return await response.json(); } catch { throw new Error('The address responded, but did not return JSON. Check the service and port.'); }
}

function explainFailure(outcome, service) {
  if (outcome.status === 'fulfilled') return `${service} returned an unexpected response. Check that this address belongs to the expected service.`;
  const error = outcome.reason;
  if (error?.name === 'TimeoutError') return 'No response within 5 seconds. Check the address and service.';
  if (error?.cause?.code === 'ECONNREFUSED') return 'Connection refused. Start this service or correct its port.';
  if (error?.cause?.code === 'ENOTFOUND') return 'Server name could not be resolved. Check the address.';
  if (error?.message?.includes('HTTP 404')) return 'Required API route was not found. Check the service, address and version.';
  if (/HTTP (401|403)/.test(error?.message || '')) return 'Authentication is required. Authenticated connections are not supported in this preview.';
  return error?.message === 'fetch failed' ? 'Could not connect. Check that this separate service is running and reachable.' : error?.message || 'Connection could not be verified.';
}

export async function checkConnection(profile) {
  const comfyUrl = normalizeEndpoint(profile.comfyUrl);
  const proxyUrl = normalizeEndpoint(profile.proxyUrl);
  const [comfy, proxy] = await Promise.allSettled([
    readJson(`${comfyUrl}/system_stats`), readJson(`${proxyUrl}/api/v2/health`),
  ]);
  const result = { comfy: false, proxy: false, device: '', message: '', nodeCount: 0, comfyDetail: '', proxyDetail: '' };
  if (comfy.status === 'fulfilled' && Array.isArray(comfy.value?.devices)) {
    result.comfy = true;
    result.device = comfy.value.devices[0]?.name || 'No GPU reported';
    // Reachability needs no global extension inventory or asset scan.
  }
  if (proxy.status === 'fulfilled' && proxy.value && typeof proxy.value === 'object') {
    result.proxy = proxy.value.status === 'healthy' || proxy.value.status === 'ok' || proxy.value.ok === true;
    if (result.proxy && typeof proxy.value.upstream === 'string') {
      try {
        if (normalizeEndpoint(proxy.value.upstream) !== comfyUrl) {
          result.proxy = false;
          result.proxyDetail = `Proxy is running, but points to ${proxy.value.upstream}. Restart it with the configured ComfyUI address. Host aliases may refer to the same server; align the addresses before checking again.`;
        }
      } catch { result.proxy = false; }
    }
  }
  result.comfyDetail = result.comfy ? 'ComfyUI system API responded.' : explainFailure(comfy, 'ComfyUI');
  result.proxyDetail ||= result.proxy ? 'API v2 health responded. This does not verify an audio workflow.' : explainFailure(proxy, 'API Proxy');
  result.message = result.comfy && result.proxy
    ? 'ComfyUI and API Proxy are reachable. Audio workflow support has not been checked yet.'
    : result.comfy ? 'ComfyUI is reachable, but API Proxy is unavailable or returned an unexpected response. Start the proxy and check its address. You can still save these settings and explore the workspace.'
    : result.proxy ? 'API Proxy is reachable, but ComfyUI is unavailable or returned an unexpected response. Start ComfyUI and check its address. You can still save these settings and explore the workspace.'
    : 'Neither service could be verified. They may be stopped, unreachable, or using different addresses. Save connection to keep these settings and continue without connecting.';
  return result;
}
