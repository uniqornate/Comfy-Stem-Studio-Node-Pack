"""aiohttp routes for node pack mode: serves the Stem Studio web app and runs explicit, local-only preparation.

Preparation (model packs, private SAM Audio / GuideSep runtimes) only starts from a POST made by the user in the UI.
Handlers refuse requests that do not come from the same machine or that carry a foreign Origin header.
"""
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web

from . import prepare

HERE = Path(__file__).resolve().parent
CONTENT_TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.map': 'application/json'}


class Paths:
    """Where things live. Overridable for tests; resolved lazily from ComfyUI's folder_paths."""

    def __init__(self, model_root=None, private_root=None, setup_dir=None, app_dir=None, node_dir=None, models_dir=None, custom_nodes=None):
        self._model_root, self._private_root, self._setup_dir = model_root, private_root, setup_dir
        self._models_dir, self._custom_nodes = models_dir, custom_nodes
        self.app_dir = Path(app_dir) if app_dir else HERE / 'app'
        self.node_dir = Path(node_dir) if node_dir else HERE

    @property
    def model_root(self):
        if self._model_root:
            return Path(self._model_root)
        try:
            from .extra_nodes import model_root
            return model_root()
        except Exception:  # noqa: BLE001 - runtime.json may not exist before the first model download
            import folder_paths
            return Path(folder_paths.models_dir) / 'audio_separation'

    @property
    def models_dir(self):
        if self._models_dir:
            return Path(self._models_dir)
        import folder_paths
        return Path(folder_paths.models_dir)

    @property
    def custom_nodes_dir(self):
        if self._custom_nodes:
            return Path(self._custom_nodes)
        import folder_paths
        return Path(folder_paths.get_folder_paths('custom_nodes')[0])

    @property
    def private_root(self):
        if self._private_root:
            return Path(self._private_root)
        import folder_paths
        getter = getattr(folder_paths, 'get_user_directory', None)
        return (Path(getter()) if getter else Path(folder_paths.base_path) / 'user') / 'stemstudio' / 'runtime'

    @property
    def setup_dir(self):
        for candidate in ([Path(self._setup_dir)] if self._setup_dir else [HERE.parent.parent / 'setup', HERE / 'setup']):
            if (candidate / 'models.json').is_file():
                return candidate
        return None


def error(message, status=400):
    return web.json_response({'error': {'message': message}}, status=status)


def guard(request, write=False):
    """Local-only access and same-origin writes. Returns an error response or None."""
    if not prepare.is_local(request.remote or ''):
        return error('Stem Studio preparation is only available from the machine that runs ComfyUI.', 403)
    if write:
        origin = request.headers.get('Origin')
        if origin and urlsplit(origin).netloc != request.host:
            return error('Cross-origin requests are not allowed.', 403)
    return None


def build_routes(paths, jobs=None):
    """Return a RouteTableDef-compatible list of (method, path, handler) so tests and ComfyUI share one definition."""
    jobs = jobs or {name: prepare.Job() for name in ('models', 'sam', 'guidesep', 'brush-small', 'brush-medium', 'music', 'mmaudio')}
    entries = []

    def route(method, path):
        def decorate(handler):
            entries.append((method, path, handler))
            return handler
        return decorate

    def busy():
        return any(job.active for job in jobs.values())

    def need_setup():
        setup = paths.setup_dir
        if setup is None:
            raise RuntimeError('Model manifests are not part of this install. Install Stem Studio from its repository or use the desktop app.')
        return setup

    async def body(request):
        try:
            data = await request.json()
        except Exception:  # noqa: BLE001
            return None
        return data if isinstance(data, dict) else None

    # -- model packs
    @route('GET', '/stemstudio/models/status')
    async def models_status(request):
        denied = guard(request)
        if denied:
            return denied
        try:
            manifest = prepare.load_manifest(need_setup())
            packs = prepare.pack_status(manifest, paths.model_root)
        except Exception as problem:  # noqa: BLE001
            return error(str(problem), 500)
        return web.json_response({**jobs['models'].snapshot(), 'packs': packs})

    @route('POST', '/stemstudio/models/prepare')
    async def models_prepare(request):
        denied = guard(request, True)
        if denied:
            return denied
        data = await body(request)
        wanted = data.get('packs') if data else None
        if not isinstance(wanted, list) or not all(isinstance(item, str) for item in wanted):
            return error('Choose model packs to download.')
        if busy():
            return error('Another preparation is already running.', 409)
        try:
            manifest = prepare.load_manifest(need_setup())
            if not wanted or any(item not in {pack['id'] for pack in manifest['packs']} for item in wanted):
                return error('Choose valid model packs.')
            root, node = paths.model_root, paths.node_dir
            jobs['models'].start(lambda: prepare.prepare_models(jobs['models'], manifest, root, wanted, node), 'model pack')
        except Exception as problem:  # noqa: BLE001
            return error(str(problem))
        return web.json_response(jobs['models'].snapshot())

    @route('POST', '/stemstudio/models/cancel')
    async def models_cancel(request):
        denied = guard(request, True)
        if denied:
            return denied
        jobs['models'].cancel()
        return web.json_response(jobs['models'].snapshot())

    # -- SAM Audio
    def sam_dir(variant):
        if variant not in prepare.SAM_VARIANTS:
            raise ValueError('Choose SAM Small or Large.')
        return paths.model_root / ('sam-audio-' + variant)

    @route('GET', '/stemstudio/sam/status')
    async def sam_status(request):
        denied = guard(request)
        if denied:
            return denied
        try:
            ready = prepare.runtime_ready(sam_dir(request.query.get('variant', 'small-tv')), 'checkpoint.pt')
        except ValueError as problem:
            return error(str(problem))
        return web.json_response({**jobs['sam'].snapshot(), 'ready': ready})

    @route('POST', '/stemstudio/sam/prepare')
    async def sam_prepare(request):
        denied = guard(request, True)
        if denied:
            return denied
        data = await body(request) or {}
        variant, token = data.get('variant', 'small-tv'), data.get('token')
        if busy():
            return error('Another preparation is already running.', 409)
        try:
            model = sam_dir(variant)
            setup = need_setup()
            previous = model.parent / 'sam-audio-small-tv' / 'cache'
            cache = previous if previous.is_dir() else model.parent / 'sam-shared-cache'
            private = paths.private_root
            prepare.check_sam_request(setup, variant, token)
            jobs['sam'].start(lambda: prepare.prepare_sam(jobs['sam'], setup, model, private, variant, token, cache), 'SAM Audio')
        except Exception as problem:  # noqa: BLE001
            return error(prepare.redact(str(problem)))
        return web.json_response(jobs['sam'].snapshot())

    @route('POST', '/stemstudio/sam/cancel')
    async def sam_cancel(request):
        denied = guard(request, True)
        if denied:
            return denied
        jobs['sam'].cancel()
        return web.json_response(jobs['sam'].snapshot())

    # -- GuideSep
    @route('GET', '/stemstudio/guidesep/status')
    async def guidesep_status(request):
        denied = guard(request)
        if denied:
            return denied
        ready = prepare.runtime_ready(paths.model_root / 'guidesep-v1', 'guidesep.pt')
        return web.json_response({**jobs['guidesep'].snapshot(), 'ready': ready})

    @route('POST', '/stemstudio/guidesep/prepare')
    async def guidesep_prepare(request):
        denied = guard(request, True)
        if denied:
            return denied
        if busy():
            return error('Another preparation is already running.', 409)
        try:
            model, setup, private = paths.model_root / 'guidesep-v1', need_setup(), paths.private_root
            prepare.check_guidesep_request(setup)
            jobs['guidesep'].start(lambda: prepare.prepare_guidesep(jobs['guidesep'], setup, model, private), 'GuideSep')
        except Exception as problem:  # noqa: BLE001
            return error(str(problem))
        return web.json_response(jobs['guidesep'].snapshot())

    @route('POST', '/stemstudio/guidesep/cancel')
    async def guidesep_cancel(request):
        denied = guard(request, True)
        if denied:
            return denied
        jobs['guidesep'].cancel()
        return web.json_response(jobs['guidesep'].snapshot())

    # -- brush sound models (Stable Audio 3), six-stem music (HTDemucs) and MMAudio
    def extra():
        return prepare.load_extra(need_setup())

    def shown(job):
        snapshot = job.snapshot()
        snapshot.setdefault('percent', -1)
        return snapshot

    def brush_model(value):
        if value not in ('small', 'medium'):
            raise ValueError('Choose the Small-SFX or Medium sound model.')
        return value

    @route('GET', '/stemstudio/brush/status')
    async def brush_status(request):
        denied = guard(request)
        if denied:
            return denied
        try:
            model = brush_model(request.query.get('model', 'small'))
            spec = extra()['brush']
            ready = prepare.files_ready(spec['models'][model]['files'], paths.model_root / spec['folder'])
        except ValueError as problem:
            return error(str(problem))
        except Exception as problem:  # noqa: BLE001
            return error(str(problem), 500)
        return web.json_response({**shown(jobs['brush-' + model]), 'ready': ready})

    @route('POST', '/stemstudio/brush/prepare')
    async def brush_prepare(request):
        denied = guard(request, True)
        if denied:
            return denied
        data = await body(request) or {}
        if busy():
            return error('Another preparation is already running.', 409)
        try:
            model = brush_model(data.get('model', 'small'))
            spec, root, job = extra()['brush'], paths.model_root, jobs['brush-' + model]
            job.start(lambda: prepare.prepare_files(job, spec['models'][model]['files'], root / spec['folder'], 'Sound model ready. Restart ComfyUI once so it lists the new files.'), 'sound model')
        except Exception as problem:  # noqa: BLE001
            return error(str(problem))
        return web.json_response(shown(jobs['brush-' + model]))

    @route('POST', '/stemstudio/brush/cancel')
    async def brush_cancel(request):
        denied = guard(request, True)
        if denied:
            return denied
        data = await body(request) or {}
        jobs['brush-' + (data.get('model') if data.get('model') in ('small', 'medium') else 'small')].cancel()
        return web.json_response({'ok': True})

    @route('GET', '/stemstudio/music/status')
    async def music_status(request):
        denied = guard(request)
        if denied:
            return denied
        try:
            spec = extra()['music']
            ready = prepare.files_ready(spec['files'], paths.model_root / spec['folder'])
        except Exception as problem:  # noqa: BLE001
            return error(str(problem), 500)
        return web.json_response({**shown(jobs['music']), 'ready': ready})

    @route('POST', '/stemstudio/music/prepare')
    async def music_prepare(request):
        denied = guard(request, True)
        if denied:
            return denied
        if busy():
            return error('Another preparation is already running.', 409)
        try:
            spec, root = extra()['music'], paths.model_root
            jobs['music'].start(lambda: prepare.prepare_files(jobs['music'], spec['files'], root / spec['folder'], 'Music model ready. Check the engine again.'), 'music model')
        except Exception as problem:  # noqa: BLE001
            return error(str(problem))
        return web.json_response(shown(jobs['music']))

    @route('POST', '/stemstudio/music/cancel')
    async def music_cancel(request):
        denied = guard(request, True)
        if denied:
            return denied
        jobs['music'].cancel()
        return web.json_response({'ok': True})

    @route('GET', '/stemstudio/mmaudio/status')
    async def mmaudio_status(request):
        denied = guard(request)
        if denied:
            return denied
        try:
            spec = extra()['mmaudio']
            node = prepare.mmaudio_node_installed(paths.custom_nodes_dir, spec['node'])
            weights = prepare.files_ready(spec['files'], paths.models_dir / spec['folder'])
            deps = False if jobs['mmaudio'].active else prepare.python_imports_ready(spec['imports'])
        except Exception as problem:  # noqa: BLE001
            return error(str(problem), 500)
        return web.json_response({**shown(jobs['mmaudio']), 'node': node, 'weights': weights, 'deps': deps, 'python': True, 'ready': node and weights and deps})

    @route('POST', '/stemstudio/mmaudio/prepare')
    async def mmaudio_prepare(request):
        denied = guard(request, True)
        if denied:
            return denied
        if busy():
            return error('Another preparation is already running.', 409)
        try:
            spec, models_dir, custom = extra()['mmaudio'], paths.models_dir, paths.custom_nodes_dir
            jobs['mmaudio'].start(lambda: prepare.prepare_mmaudio(jobs['mmaudio'], spec, models_dir, custom), 'MMAudio')
        except Exception as problem:  # noqa: BLE001
            return error(str(problem))
        return web.json_response(shown(jobs['mmaudio']))

    @route('POST', '/stemstudio/mmaudio/cancel')
    async def mmaudio_cancel(request):
        denied = guard(request, True)
        if denied:
            return denied
        jobs['mmaudio'].cancel()
        return web.json_response({'ok': True})

    # -- the web app itself (kept out of WEB_DIRECTORY: ComfyUI would import every .js file there as a frontend extension)
    @route('GET', '/stemstudio/app')
    async def app_redirect(request):
        raise web.HTTPFound(str(request.rel_url.path).rstrip('/') + '/')

    @route('GET', '/stemstudio/app/{tail:.*}')
    async def app_file(request):
        root = paths.app_dir.resolve()
        tail = request.match_info.get('tail') or 'index.html'
        target = (root / tail).resolve()
        if not str(target).startswith(str(root)):
            return web.Response(status=404, text='Not found')
        if not target.is_file():
            if tail != 'index.html' and (tail.startswith('assets/') or '.' in Path(tail).name):
                return web.Response(status=404, text='Not found')
            target = root / 'index.html'
            if not target.is_file():
                return web.Response(status=404, text='The Stem Studio web app is not built. Run "npm run build:nodepack" in the repository.')
        kind = CONTENT_TYPES.get(target.suffix.lower()) or mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        return web.FileResponse(target, headers={'Content-Type': kind, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'})

    return entries, jobs


def register(prompt_server=None, paths=None):
    """Attach the routes to ComfyUI's PromptServer. Silently does nothing outside ComfyUI."""
    if prompt_server is None:
        try:
            from server import PromptServer
            prompt_server = PromptServer.instance
        except ImportError:
            return None
    if getattr(prompt_server, '_stemstudio_routes', None) is not None:
        return prompt_server._stemstudio_routes  # A second copy of the pack (for example the desktop-app install) must not re-register.
    entries, jobs = build_routes(paths or Paths())
    prompt_server._stemstudio_routes = jobs
    for method, path, handler in entries:
        prompt_server.routes.route(method, path)(handler)
    return jobs


def make_app(paths, jobs=None):
    """A standalone aiohttp app with the same routes (used by tests)."""
    entries, jobs = build_routes(paths, jobs)
    app = web.Application()
    app.add_routes([web.route(method, path, handler) for method, path, handler in entries])
    return app, jobs


__all__ = ['Paths', 'build_routes', 'register', 'make_app', 'guard']
