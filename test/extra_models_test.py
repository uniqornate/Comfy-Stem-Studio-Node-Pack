"""Brush models, six-stem music and MMAudio preparation in node pack mode. Mocks only: no network, pip or real weights."""
import hashlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from web_routes_test import FakeJob, FakeResponse, pkg, prepare, sha, HAVE_AIOHTTP  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


class Opener:
    def __init__(self, files):
        self.files = files
        self.urls = []

    def __call__(self, request, timeout=None):
        self.urls.append(request.full_url)
        return FakeResponse(self.files[request.full_url])


class ExtraManifestTests(unittest.TestCase):
    def test_repository_manifest_is_safe_and_pins_every_file(self):
        data = prepare.load_extra(ROOT / 'setup')
        self.assertEqual(set(data['brush']['models']), {'small', 'medium'})
        self.assertEqual(data['music']['files'][0]['sha256'][:8], '34c22ccb')
        names = [entry['path'] for entry in data['mmaudio']['files']]
        self.assertIn('mmaudio_large_44k_v2_fp16.safetensors', names)
        self.assertTrue(any(name.startswith('nvidia/bigvgan_v2') for name in names))
        self.assertEqual(len(data['mmaudio']['node']['commit']), 40)
        self.assertIn('nodes.py', data['mmaudio']['node']['files'])

    def test_unsafe_entries_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            data = json.loads((ROOT / 'setup' / 'extra-models.json').read_text(encoding='utf-8'))
            data['music']['files'][0]['path'] = '../escape.bin'
            (Path(folder) / 'extra-models.json').write_text(json.dumps(data), encoding='utf-8')
            with self.assertRaises(ValueError):
                prepare.load_extra(folder)
            data['music']['files'][0]['path'] = 'ok.bin'
            data['music']['files'][0]['url'] = 'http://example.com/ok.bin'
            (Path(folder) / 'extra-models.json').write_text(json.dumps(data), encoding='utf-8')
            with self.assertRaises(ValueError):
                prepare.load_extra(folder)


class DownloadTests(unittest.TestCase):
    def test_files_are_downloaded_verified_and_reported_ready(self):
        payload = b'weights' * 300
        files = [{'path': 'sub/model.bin', 'name': 'Model', 'url': 'https://example.invalid/model.bin', 'size': len(payload), 'sha256': sha(payload)}]
        with tempfile.TemporaryDirectory() as folder:
            job = FakeJob()
            self.assertFalse(prepare.files_ready(files, folder))
            prepare.prepare_files(job, files, folder, 'done', Opener({files[0]['url']: payload}))
            self.assertEqual((Path(folder) / 'sub' / 'model.bin').read_bytes(), payload)
            self.assertTrue(prepare.files_ready(files, folder))
            self.assertEqual(job.snapshot()['phase'], 'complete')
            self.assertEqual(job.snapshot()['percent'], 100)

    def test_a_corrupt_download_is_not_installed(self):
        payload = b'weights' * 100
        files = [{'path': 'model.bin', 'name': 'Model', 'url': 'https://example.invalid/model.bin', 'size': len(payload), 'sha256': sha(payload)}]
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                prepare.prepare_files(FakeJob(), files, folder, 'done', Opener({files[0]['url']: b'x' * len(payload)}))
            self.assertFalse((Path(folder) / 'model.bin').exists())


def pack_zip(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, content in files.items():
            archive.writestr(f'ComfyUI-MMAudio-abc/{name}', content)
    return buffer.getvalue()


class MMAudioTests(unittest.TestCase):
    files = {'__init__.py': b'init', 'nodes.py': b'nodes', 'requirements.txt': b'einops\n'}

    def node(self, **over):
        return {'folder': 'ComfyUI-MMAudio', 'archive': 'https://example.invalid/pack.zip', 'commit': 'c' * 40, 'files': {name: prepare.git_blob_sha(content) for name, content in self.files.items()}, **over}

    def test_git_blob_hash_matches_git(self):
        self.assertEqual(prepare.git_blob_sha(b'hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a')

    def test_pack_is_verified_installed_with_a_marker_and_not_reinstalled(self):
        node = self.node()
        with tempfile.TemporaryDirectory() as folder:
            opener = Opener({node['archive']: pack_zip(self.files)})
            self.assertTrue(prepare.install_mmaudio_node(FakeJob(), node, folder, opener))
            self.assertEqual((Path(folder) / 'ComfyUI-MMAudio' / 'nodes.py').read_bytes(), b'nodes')
            self.assertTrue(prepare.mmaudio_node_installed(folder, node))
            self.assertFalse(prepare.install_mmaudio_node(FakeJob(), node, folder, opener))
            self.assertEqual(len(opener.urls), 1)

    def test_a_changed_file_or_a_foreign_folder_is_refused(self):
        node = self.node()
        with tempfile.TemporaryDirectory() as folder:
            tampered = dict(self.files, **{'nodes.py': b'evil'})
            with self.assertRaisesRegex(ValueError, 'differs from the pinned version'):
                prepare.install_mmaudio_node(FakeJob(), node, folder, Opener({node['archive']: pack_zip(tampered)}))
            self.assertFalse((Path(folder) / 'ComfyUI-MMAudio').exists())
            (Path(folder) / 'ComfyUI-MMAudio').mkdir()
            with self.assertRaisesRegex(ValueError, 'not installed by Stem Studio'):
                prepare.install_mmaudio_node(FakeJob(), node, folder, Opener({node['archive']: pack_zip(self.files)}))

    def test_pip_runs_with_comfyuis_python_only_when_imports_fail(self):
        payload = b'w' * 64
        spec = {'folder': 'mmaudio', 'imports': ['einops'], 'files': [{'path': 'w.bin', 'name': 'W', 'url': 'https://example.invalid/w.bin', 'size': 64, 'sha256': sha(payload)}], 'node': self.node()}
        with tempfile.TemporaryDirectory() as custom, tempfile.TemporaryDirectory() as models:
            opener = Opener({spec['node']['archive']: pack_zip(self.files), spec['files'][0]['url']: payload})
            job = FakeJob()
            ready = iter([False, True])
            with patch.object(prepare, 'python_imports_ready', lambda imports, python=None: next(ready)):
                prepare.prepare_mmaudio(job, spec, models, custom, opener)
            self.assertEqual(len(job.commands), 1)
            command = [str(part) for part in job.commands[0]]
            self.assertEqual(command[:4], [sys.executable, '-m', 'pip', 'install'])
            self.assertTrue(command[-1].endswith('requirements.txt'))
            self.assertTrue((Path(models) / 'mmaudio' / 'w.bin').is_file())
            self.assertEqual(job.snapshot()['phase'], 'complete')
        with tempfile.TemporaryDirectory() as custom, tempfile.TemporaryDirectory() as models:
            opener = Opener({spec['node']['archive']: pack_zip(self.files), spec['files'][0]['url']: payload})
            job = FakeJob()
            with patch.object(prepare, 'python_imports_ready', lambda imports, python=None: True):
                prepare.prepare_mmaudio(job, spec, models, custom, opener)
            self.assertEqual(job.commands, [])


@unittest.skipUnless(HAVE_AIOHTTP, 'aiohttp is not installed')
class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from aiohttp.test_utils import TestClient, TestServer
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        for name in ('models', 'custom_nodes', 'setup'):
            (base / name).mkdir()
        (base / 'setup' / 'models.json').write_text((ROOT / 'setup' / 'models.json').read_text(encoding='utf-8'), encoding='utf-8')
        (base / 'setup' / 'extra-models.json').write_text((ROOT / 'setup' / 'extra-models.json').read_text(encoding='utf-8'), encoding='utf-8')
        paths = pkg.web_routes.Paths(model_root=base / 'models' / 'audio_separation', private_root=base / 'private', setup_dir=base / 'setup', models_dir=base / 'models', custom_nodes=base / 'custom_nodes')
        app, self.jobs = pkg.web_routes.make_app(paths)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.temp.cleanup()

    async def test_status_routes_report_missing_models(self):
        brush = await (await self.client.get('/stemstudio/brush/status?model=medium')).json()
        self.assertFalse(brush['ready'])
        self.assertEqual(brush['percent'], -1)
        self.assertEqual((await self.client.get('/stemstudio/brush/status?model=huge')).status, 400)
        self.assertFalse((await (await self.client.get('/stemstudio/music/status')).json())['ready'])
        with patch.object(prepare, 'python_imports_ready', lambda imports, python=None: False):
            mm = await (await self.client.get('/stemstudio/mmaudio/status')).json()
        self.assertEqual([mm['node'], mm['weights'], mm['deps'], mm['ready']], [False, False, False, False])

    async def test_prepare_routes_reject_foreign_origins_unknown_models_and_parallel_work(self):
        response = await self.client.post('/stemstudio/music/prepare', json={}, headers={'Origin': 'http://evil.example'})
        self.assertEqual(response.status, 403)
        self.assertEqual((await self.client.post('/stemstudio/brush/prepare', json={'model': 'huge'})).status, 400)
        with patch.object(type(self.jobs['music']), 'active', True):
            self.assertEqual((await self.client.post('/stemstudio/mmaudio/prepare', json={})).status, 409)


if __name__ == '__main__':
    unittest.main()
