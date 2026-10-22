"""Node pack routes and preparation, with mocks only: no network, no uv, no Torch, no ComfyUI, no real downloads."""
import hashlib
import importlib.util
import io
import json
import sys
import tarfile
import tempfile
import time
import types
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / 'comfy_nodes' / 'StemStudio'


def load_package():
    """Import prepare.py and web_routes.py as a package without running the node pack's __init__ (which needs ComfyUI)."""
    if 'ssp' in sys.modules:
        return sys.modules['ssp']
    package = types.ModuleType('ssp')
    package.__path__ = [str(PACKAGE)]
    sys.modules['ssp'] = package
    for name in ('prepare', 'web_routes'):
        spec = importlib.util.spec_from_file_location(f'ssp.{name}', PACKAGE / f'{name}.py')
        module = importlib.util.module_from_spec(spec)
        sys.modules[f'ssp.{name}'] = module
        spec.loader.exec_module(module)
        setattr(package, name, module)
    return package


try:
    import aiohttp  # noqa: F401
    from aiohttp.test_utils import TestClient, TestServer
    HAVE_AIOHTTP = True
except ImportError:
    HAVE_AIOHTTP = False

pkg = load_package()
prepare = pkg.prepare


class FakeResponse(io.BytesIO):
    def __init__(self, data, status=200):
        super().__init__(data)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def sha(data):
    return hashlib.sha256(data).hexdigest()


class FakeJob(prepare.Job):
    """Records commands instead of running them."""

    def __init__(self):
        super().__init__()
        self.commands = []

    def run(self, command, env=None, secrets=()):
        self.check()
        self.commands.append([str(part) for part in command])


class ManifestAndDownloadTests(unittest.TestCase):
    def test_manifest_in_repo_is_safe_and_complete(self):
        manifest = prepare.load_manifest(ROOT / 'setup')
        self.assertEqual({pack['id'] for pack in manifest['packs']}, {'sfc', 'uss', 'bandit', 'mrx'})
        for pack in manifest['packs']:
            for entry in pack['files']:
                self.assertTrue(entry['url'].startswith('https://'))
                self.assertIn(entry['algorithm'].upper(), ('SHA256', 'MD5'))

    def test_unsafe_manifest_paths_and_urls_are_rejected(self):
        for bad in ('../x', '/abs/x', 'C:\\x', 'a/../../x', 'a|b'):
            with self.assertRaises(ValueError):
                prepare.safe_relative(bad)
        self.assertEqual(prepare.safe_relative('uss/Cnn14_mAP=0.431.pth').parts[-1], 'Cnn14_mAP=0.431.pth')
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'models.json').write_text(json.dumps({'packs': [{'id': 'x', 'name': 'x', 'files': [{'path': 'a', 'url': 'http://plain', 'size': 1, 'algorithm': 'SHA256', 'hash': 'x'}]}]}))
            with self.assertRaises(ValueError):
                prepare.load_manifest(tmp)

    def test_download_verifies_hash_and_publishes_atomically(self):
        data = b'weights' * 1000
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'sub' / 'model.pth'
            seen = []
            prepare.download_file('https://example.test/m', target, len(data), 'SHA256', sha(data), lambda have, size: seen.append(have), None, lambda request, timeout: FakeResponse(data))
            self.assertEqual(target.read_bytes(), data)
            self.assertFalse(target.with_name('model.pth.part').exists())
            self.assertEqual(seen[-1], len(data))
            calls = []
            prepare.download_file('https://example.test/m', target, len(data), 'SHA256', sha(data), None, None, lambda *a, **k: calls.append(1))
            self.assertEqual(calls, [], 'a verified file is not downloaded again')

    def test_corrupt_download_is_not_installed(self):
        data = b'x' * 100
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'm.bin'
            with self.assertRaisesRegex(ValueError, 'failed verification'):
                prepare.download_file('https://example.test/m', target, len(data), 'SHA256', sha(b'other'), None, None, lambda request, timeout: FakeResponse(data))
            self.assertFalse(target.exists())
            self.assertFalse(target.with_name('m.bin.part').exists())

    def test_resume_uses_range_and_restarts_when_server_ignores_it(self):
        data = bytes(range(200))
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'm.bin'
            target.with_name('m.bin.part').write_bytes(data[:80])
            ranges = []

            def opener(request, timeout):
                ranges.append(request.headers.get('Range'))
                return FakeResponse(data[80:], 206)
            prepare.download_file('https://example.test/m', target, len(data), 'MD5', hashlib.md5(data).hexdigest(), None, None, opener)
            self.assertEqual(ranges, ['bytes=80-']); self.assertEqual(target.read_bytes(), data)
            other = Path(tmp) / 'n.bin'
            other.with_name('n.bin.part').write_bytes(data[:80])
            prepare.download_file('https://example.test/n', other, len(data), 'MD5', hashlib.md5(data).hexdigest(), None, None, lambda request, timeout: FakeResponse(data, 200))
            self.assertEqual(other.read_bytes(), data)

    def test_cancel_stops_a_download(self):
        data = b'y' * (3 * 1024 * 1024)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(prepare.Cancelled):
                prepare.download_file('https://example.test/m', Path(tmp) / 'm', len(data), 'SHA256', sha(data), None, lambda: True, lambda request, timeout: FakeResponse(data))

    def test_prepare_models_downloads_and_writes_runtime_json(self):
        model = b'sfc-weights'
        config = b'cfg'
        manifest = {'packs': [{'id': 'sfc', 'name': 'SFC', 'files': [
            {'path': 'sfc-locoformer-dnr/model.pth', 'url': 'https://h/m', 'size': len(model), 'algorithm': 'SHA256', 'hash': sha(model)},
            {'path': 'sfc-locoformer-dnr/merged_config.yaml', 'url': 'https://h/c', 'size': len(config), 'algorithm': 'SHA256', 'hash': sha(config)}]}]}
        bodies = {'https://h/m': model, 'https://h/c': config}
        with tempfile.TemporaryDirectory() as tmp:
            root, node = Path(tmp, 'models'), Path(tmp, 'node'); node.mkdir()
            job = prepare.Job()
            self.assertFalse(prepare.pack_status(manifest, root)[0]['ready'])
            prepare.prepare_models(job, manifest, root, ['sfc'], node, lambda request, timeout: FakeResponse(bodies[request.full_url]))
            self.assertEqual(job.snapshot()['phase'], 'complete')
            self.assertTrue(prepare.pack_status(manifest, root)[0]['ready'])
            runtime = json.loads((node / 'runtime.json').read_text())
            self.assertEqual(Path(runtime['checkpoint']), root / 'sfc-locoformer-dnr' / 'model.pth')
            self.assertEqual(Path(runtime['model_root']), root)
            with self.assertRaises(ValueError):
                prepare.prepare_models(job, manifest, root, ['nope'], node)


class RuntimeTests(unittest.TestCase):
    def test_platform_paths_and_index(self):
        self.assertEqual(prepare.venv_python('r', True), Path('r/Scripts/python.exe'))
        self.assertEqual(prepare.venv_python('r', False), Path('r/bin/python'))
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'lib' / 'python3.12' / 'site-packages').mkdir(parents=True)
            self.assertEqual(prepare.site_packages(tmp, False), Path(tmp) / 'lib' / 'python3.12' / 'site-packages')
        self.assertEqual(prepare.site_packages('r', True), Path('r/Lib/site-packages'))
        self.assertIn('cu128', prepare.torch_index(('windows', 'x86_64')))
        self.assertIn('cu128', prepare.torch_index(('linux', 'x86_64')))
        self.assertIsNone(prepare.torch_index(('darwin', 'aarch64')))
        self.assertIsNone(prepare.torch_index(('linux', 'aarch64')))

    def test_uv_assets_are_pinned_for_each_supported_platform(self):
        for key, (name, digest) in prepare.UV_ASSETS.items():
            self.assertRegex(digest, r'^[0-9a-f]{64}$'); self.assertIn(key[1].replace('x86_64', 'x86_64'), name)
        self.assertEqual(prepare.UV_ASSETS[('windows', 'x86_64')][1], '3b2661a463a5baea7f5076ea2b25ab71d77f36a6c0d809e5350651792f80a672')

    def _archive(self, kind):
        buffer = io.BytesIO()
        if kind == 'zip':
            with zipfile.ZipFile(buffer, 'w') as bundle:
                bundle.writestr('uv-x/uv.exe', b'binary')
        else:
            with tarfile.open(fileobj=buffer, mode='w:gz') as bundle:
                info = tarfile.TarInfo('uv-x/uv'); info.size = 6; bundle.addfile(info, io.BytesIO(b'binary'))
        return buffer.getvalue()

    def test_uv_is_downloaded_hash_checked_and_extracted_on_every_archive_kind(self):
        for key, kind, binary in ((('windows', 'x86_64'), 'zip', 'uv.exe'), (('linux', 'x86_64'), 'tar', 'uv'), (('darwin', 'aarch64'), 'tar', 'uv')):
            data = self._archive(kind)
            name = prepare.UV_ASSETS[key][0]
            with tempfile.TemporaryDirectory() as tmp, patch.dict(prepare.UV_ASSETS, {key: (name, sha(data))}):
                path = prepare.ensure_uv(prepare.Job(), tmp, key, lambda request, timeout: FakeResponse(data))
                self.assertEqual(path, Path(tmp) / f'uv-{prepare.UV_VERSION}' / binary)
                self.assertEqual(path.read_bytes(), b'binary')
                self.assertEqual(prepare.ensure_uv(prepare.Job(), tmp, key, lambda *a, **k: self.fail('already present')), path)
                self.assertFalse((Path(tmp) / name).exists())

    def test_uv_with_wrong_hash_or_unknown_platform_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, 'integrity'):
                prepare.ensure_uv(prepare.Job(), tmp, ('linux', 'x86_64'), lambda request, timeout: FakeResponse(b'tampered'))
            with self.assertRaisesRegex(RuntimeError, 'No pinned runtime manager'):
                prepare.ensure_uv(prepare.Job(), tmp, ('freebsd', 'x86_64'))

    def test_uv_archive_with_path_traversal_is_refused(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as bundle:
            bundle.writestr('../evil.exe', b'x')
        data = buffer.getvalue(); key = ('windows', 'x86_64')
        with tempfile.TemporaryDirectory() as tmp, patch.dict(prepare.UV_ASSETS, {key: (prepare.UV_ASSETS[key][0], sha(data))}):
            with self.assertRaisesRegex(RuntimeError, 'unsafe'):
                prepare.ensure_uv(prepare.Job(), tmp, key, lambda request, timeout: FakeResponse(data))
            self.assertFalse((Path(tmp).parent / 'evil.exe').exists())

    def test_sam_preparation_order_stubs_and_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp); setup = tmp / 'setup'; setup.mkdir(); (setup / 'prepare-sam.py').write_text('')
            private, model, cache = tmp / 'private', tmp / 'models' / 'sam-audio-small-tv', tmp / 'cache'
            key = ('linux', 'x86_64'); uv = private / f'uv-{prepare.UV_VERSION}' / 'uv'
            uv.parent.mkdir(parents=True); uv.write_text('')
            job = FakeJob()
            site = prepare.site_packages(private / 'sam-audio' / 'runtime', False)
            (site / 'torchcodec').mkdir(parents=True); (site / 'torchcodec' / 'real.so').write_text('')
            with patch.object(prepare, 'system_key', return_value=key), patch.object(prepare.sys, 'platform', 'linux'):
                prepare.prepare_sam(job, setup, model, private, 'small-tv', 'hf_' + 'a' * 30, cache, key)
            joined = [' '.join(command) for command in job.commands]
            self.assertIn('venv --python 3.12 --managed-python', joined[0])
            self.assertIn('cu128', joined[1]); self.assertIn('torch==2.11.0', joined[1])
            self.assertIn('--no-deps', joined[2]); self.assertIn(prepare.SAM_REVISION, joined[2])
            self.assertIn('--constraint', joined[3])
            self.assertTrue(joined[4].endswith('facebook/sam-audio-small-tv')); self.assertIn('prepare-sam.py', joined[4])
            self.assertTrue(joined[4].startswith(str(private / 'sam-audio' / 'runtime' / 'bin' / 'python')))
            self.assertFalse((site / 'torchcodec' / 'real.so').exists())
            self.assertIn('AudioDecoder', (site / 'torchcodec' / 'decoders.py').read_text())
            self.assertTrue((site / 'xformers' / 'ops' / '__init__.py').is_file())
            marker = json.loads((model / 'stem-runtime.json').read_text())
            self.assertEqual(marker['repo'], 'facebook/sam-audio-small-tv'); self.assertEqual(marker['revision'], prepare.SAM_REVISION)
            self.assertEqual(job.snapshot()['phase'], 'complete')

    def test_sam_validates_token_variant_and_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            setup = Path(tmp)
            with self.assertRaisesRegex(ValueError, 'Hugging Face'):
                prepare.prepare_sam(FakeJob(), setup, Path(tmp, 'm'), Path(tmp, 'p'), 'small-tv', 'nope', Path(tmp, 'c'))
            with self.assertRaisesRegex(ValueError, 'Small or Large'):
                prepare.prepare_sam(FakeJob(), setup, Path(tmp, 'm'), Path(tmp, 'p'), 'huge', 'hf_' + 'a' * 30, Path(tmp, 'c'))
            with self.assertRaisesRegex(RuntimeError, 'prepare-sam.py'):
                prepare.prepare_sam(FakeJob(), setup, Path(tmp, 'm'), Path(tmp, 'p'), 'small-tv', 'hf_' + 'a' * 30, Path(tmp, 'c'))

    def test_guidesep_preparation_on_macos_uses_default_index_and_writes_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp); setup = tmp / 'setup'; setup.mkdir(); (setup / 'prepare-guidesep.py').write_text('')
            private, model = tmp / 'private', tmp / 'models' / 'guidesep-v1'
            key = ('darwin', 'aarch64'); uv = private / f'uv-{prepare.UV_VERSION}' / 'uv'
            uv.parent.mkdir(parents=True); uv.write_text('')
            job = FakeJob()
            with patch.object(prepare.sys, 'platform', 'darwin'):
                prepare.prepare_guidesep(job, setup, model, private, key)
            joined = [' '.join(command) for command in job.commands]
            self.assertNotIn('cu128', joined[1]); self.assertIn('--default-index', joined[1])
            self.assertIn('einops-exts', joined[2]); self.assertIn('prepare-guidesep.py', joined[3])
            self.assertEqual(json.loads((model / 'stem-runtime.json').read_text())['revision'], prepare.GUIDESEP_REVISION)

    def test_runtime_ready_needs_python_and_weights(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp)
            self.assertFalse(prepare.runtime_ready(model, 'checkpoint.pt'))
            python = model / 'py'; python.write_text('')
            (model / 'stem-runtime.json').write_text(json.dumps({'python': str(python)}))
            self.assertFalse(prepare.runtime_ready(model, 'checkpoint.pt'))
            (model / 'checkpoint.pt').write_bytes(b'x')
            self.assertTrue(prepare.runtime_ready(model, 'checkpoint.pt'))

    def test_job_runs_real_subprocess_without_shell_and_redacts_secrets(self):
        job = prepare.Job()
        job.run([sys.executable, '-c', 'print("token hf_abcdefghijklmnop done")'], None, ('hf_abcdefghijklmnop',))
        self.assertNotIn('hf_abcdefghijklmnop', job.snapshot()['detail']); self.assertIn('[redacted]', job.snapshot()['detail'])
        with self.assertRaisesRegex(RuntimeError, 'Command failed'):
            job.run([sys.executable, '-c', 'raise SystemExit(3)'])
        self.assertEqual(prepare.redact('x hf_abcdefghijklmnop y'), 'x [redacted] y')


@unittest.skipUnless(HAVE_AIOHTTP, 'aiohttp is not installed')
class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(); tmp = Path(self.tmp.name)
        self.setup = tmp / 'setup'; self.setup.mkdir()
        self.model = b'tiny-model'
        manifest = {'schemaVersion': 1, 'packs': [{'id': 'mrx', 'name': 'MRX', 'license': 'x', 'files': [{'path': 'mrx/adapted_loudness.pth', 'url': 'https://h/m', 'size': len(self.model), 'algorithm': 'SHA256', 'hash': sha(self.model)}]}]}
        (self.setup / 'models.json').write_text(json.dumps(manifest))
        (self.setup / 'prepare-guidesep.py').write_text('')
        self.app_dir = tmp / 'app'; (self.app_dir / 'assets').mkdir(parents=True)
        (self.app_dir / 'index.html').write_text('<html>app</html>'); (self.app_dir / 'assets' / 'a.js').write_text('export {}')
        (tmp / 'secret.txt').write_text('secret')
        self.paths = pkg.web_routes.Paths(model_root=tmp / 'models', private_root=tmp / 'private', setup_dir=self.setup, app_dir=self.app_dir, node_dir=tmp)
        self.app, self.jobs = pkg.web_routes.make_app(self.paths)
        self.client = TestClient(TestServer(self.app)); await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close(); self.tmp.cleanup()

    async def wait(self, job):
        for _ in range(200):
            if not job.active:
                return
            time.sleep(0.01)
        self.fail('job did not finish')

    async def test_app_is_served_with_correct_types_and_no_traversal(self):
        index = await self.client.get('/stemstudio/app/')
        self.assertEqual(index.status, 200); self.assertIn('text/html', index.headers['Content-Type']); self.assertEqual(await index.text(), '<html>app</html>')
        asset = await self.client.get('/stemstudio/app/assets/a.js')
        self.assertIn('javascript', asset.headers['Content-Type']); self.assertEqual(asset.headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual((await self.client.get('/stemstudio/app/assets/missing.js')).status, 404)
        self.assertEqual((await self.client.get('/stemstudio/app/..%2Fsecret.txt')).status, 404)
        self.assertEqual((await self.client.get('/stemstudio/app/%2e%2e/secret.txt')).status, 404)
        redirect = await self.client.get('/stemstudio/app', allow_redirects=False)
        self.assertEqual(redirect.status, 302); self.assertTrue(redirect.headers['Location'].endswith('/stemstudio/app/'))
        (self.app_dir / 'index.html').unlink()
        missing = await self.client.get('/stemstudio/app/')
        self.assertEqual(missing.status, 404); self.assertIn('npm run build:nodepack', await missing.text())

    async def test_models_prepare_status_and_validation(self):
        status = await (await self.client.get('/stemstudio/models/status')).json()
        self.assertFalse(status['packs'][0]['ready'])
        self.assertEqual((await self.client.post('/stemstudio/models/prepare', json={'packs': ['nope']})).status, 400)
        self.assertEqual((await self.client.post('/stemstudio/models/prepare', json={'packs': 'mrx'})).status, 400)
        self.assertEqual((await self.client.post('/stemstudio/models/prepare', data='not json')).status, 400)
        with patch.object(prepare.urllib.request, 'urlopen', lambda request, timeout: FakeResponse(self.model)):
            response = await self.client.post('/stemstudio/models/prepare', json={'packs': ['mrx']})
            self.assertEqual(response.status, 200)
            await self.wait(self.jobs['models'])
        status = await (await self.client.get('/stemstudio/models/status')).json()
        self.assertEqual(status['phase'], 'complete'); self.assertTrue(status['packs'][0]['ready'])

    async def test_failed_download_reports_verification_error(self):
        with patch.object(prepare.urllib.request, 'urlopen', lambda request, timeout: FakeResponse(b'wrong-bytes')):
            self.assertEqual((await self.client.post('/stemstudio/models/prepare', json={'packs': ['mrx']})).status, 200)
            await self.wait(self.jobs['models'])
        status = await (await self.client.get('/stemstudio/models/status')).json()
        self.assertEqual(status['phase'], 'failed'); self.assertIn('failed verification', status['message']); self.assertFalse(status['packs'][0]['ready'])

    async def test_only_local_same_origin_callers_may_prepare(self):
        with patch.object(prepare, 'is_local', return_value=False):
            self.assertEqual((await self.client.get('/stemstudio/sam/status')).status, 403)
            self.assertEqual((await self.client.post('/stemstudio/guidesep/prepare', json={})).status, 403)
            self.assertEqual((await self.client.get('/stemstudio/models/status')).status, 403)
        evil = await self.client.post('/stemstudio/guidesep/prepare', json={}, headers={'Origin': 'http://evil.test'})
        self.assertEqual(evil.status, 403)
        self.assertFalse(self.jobs['guidesep'].active)
        same = await self.client.post('/stemstudio/sam/cancel', json={}, headers={'Origin': f'http://{self.client.server.host}:{self.client.server.port}'})
        self.assertEqual(same.status, 200)

    async def test_sam_routes_validate_input_and_never_echo_the_token(self):
        self.assertEqual((await (await self.client.get('/stemstudio/sam/status?variant=large-tv')).json())['ready'], False)
        self.assertEqual((await self.client.get('/stemstudio/sam/status?variant=huge')).status, 400)
        bad = await self.client.post('/stemstudio/sam/prepare', json={'variant': 'small-tv', 'token': 'hf_' + 'a' * 30})
        self.assertEqual(bad.status, 400)  # prepare-sam.py is not present in the fixture setup folder
        self.assertNotIn('hf_' + 'a' * 30, await bad.text())
        self.assertEqual((await self.client.post('/stemstudio/sam/prepare', json={'variant': 'small-tv'})).status, 400)

    async def test_guidesep_prepare_starts_once_and_reports_running(self):
        release = __import__('threading').Event()

        def slow(job, setup, model, private, *args):
            job.update(phase='downloading', message='working'); release.wait(5)
        with patch.object(prepare, 'prepare_guidesep', slow):
            first = await self.client.post('/stemstudio/guidesep/prepare', json={})
            self.assertEqual(first.status, 200)
            second = await self.client.post('/stemstudio/guidesep/prepare', json={})
            self.assertEqual(second.status, 409)
            other = await self.client.post('/stemstudio/models/prepare', json={'packs': ['mrx']})
            self.assertEqual(other.status, 409)
            cancel = await self.client.post('/stemstudio/guidesep/cancel', json={})
            self.assertEqual(cancel.status, 200)
            release.set(); await self.wait(self.jobs['guidesep'])

    async def test_register_attaches_once_to_a_prompt_server(self):
        added = []

        class Routes:
            def route(self, method, path):
                return lambda handler: added.append((method, path)) or handler
        server = types.SimpleNamespace(routes=Routes())
        first = pkg.web_routes.register(server, self.paths)
        count = len(added)
        self.assertGreater(count, 8)
        self.assertIn(('GET', '/stemstudio/app/{tail:.*}'), added)
        self.assertIs(pkg.web_routes.register(server, self.paths), first)
        self.assertEqual(len(added), count)


if __name__ == '__main__':
    unittest.main()
