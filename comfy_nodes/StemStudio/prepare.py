"""Preparation of model packs and private runtimes for node pack mode.

Standard library only, no ComfyUI imports, cross-platform. This is the Python counterpart of the Electron helpers
(the desktop app has Electron counterparts). Nothing here runs at node
discovery: every operation starts only from an explicit user action in the Stem Studio UI.
"""
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

UV_VERSION = '0.13.1'
# Release assets of https://github.com/astral-sh/uv/releases/tag/0.13.1 (sha256 pinned here, checked before extraction).
UV_ASSETS = {
    ('windows', 'x86_64'): ('uv-x86_64-pc-windows-msvc.zip', '3b2661a463a5baea7f5076ea2b25ab71d77f36a6c0d809e5350651792f80a672'),
    ('linux', 'x86_64'): ('uv-x86_64-unknown-linux-gnu.tar.gz', 'eadd9d27c134ab5ac1ffd4473b97a741407f3ea238288f03121fc4deddf90220'),
    ('linux', 'aarch64'): ('uv-aarch64-unknown-linux-gnu.tar.gz', '9041c73c99fdc5892cf128140beb354eca9231d502068cc36e6cb53a8e59ad14'),
    ('darwin', 'x86_64'): ('uv-x86_64-apple-darwin.tar.gz', 'bb7b805bdcf3d0bc8c74ceb94569e6b3e8aa35bd492acdbb9d46bf46d9d4ff6b'),
    ('darwin', 'aarch64'): ('uv-aarch64-apple-darwin.tar.gz', 'cfe454573412ff7380d15fc7dae5997ab53ffce72fce0a78e91ddbc84001acd2'),
}
SAM_REVISION = 'bb4c6999d2677c7402360e426afc01ddfad6dce0'
GUIDESEP_REVISION = 'c7f97a2f938e355a6aefa53bf5e81ceaf3604275'
SAM_VARIANTS = ('small-tv', 'large-tv')
SAM_CONSTRAINTS = 'torch==2.11.0\ntorchaudio==2.11.0\ntorchvision==0.26.0\ntorchcodec==0.15.0\ntransformers>=4.54,<5\nnumpy<2\n'
GUIDESEP_CONSTRAINTS = 'torch==2.11.0\ntorchaudio==2.11.0\n'
SAM_SOURCES = [
    f'sam_audio @ https://github.com/facebookresearch/sam-audio/archive/{SAM_REVISION}.zip',
    'dacvae @ https://github.com/facebookresearch/dacvae/archive/414c20785fc3a28373073ea8ef7a1316eeeaca6e.zip',
    'imagebind @ https://github.com/facebookresearch/ImageBind/archive/53680b02d7e37b19b124fa37bae4b6c98c38f5be.zip',
    'perception-models @ https://github.com/facebookresearch/perception_models/archive/e72b6810b1133e1c879f2cc965d276eb73803f1f.zip',
    'laion-clap @ https://github.com/lematt1991/CLAP/archive/b85cb7ecac0af7d064cbf03ebd990e709e959fe7.zip',
    'pytorchvideo @ https://github.com/facebookresearch/pytorchvideo/archive/6cdc929315aab1b5674b6dcf73b16ec99147735f.zip',
]
SAM_PACKAGES = ['transformers>=4.54,<5', 'huggingface-hub>=0.34,<1', 'numpy<2', 'soundfile', 'scipy', 'einops', 'torchdiffeq', 'audiobox-aesthetics', 'pydub', 'sentencepiece', 'tiktoken', 'safetensors', 'timm', 'ftfy', 'regex', 'iopath', 'fvcore', 'librosa', 'torchlibrosa', 'webdataset', 'braceexpand', 'wget', 'tqdm', 'omegaconf', 'hydra-core', 'scikit-learn', 'pandas', 'tensorboard', 'matplotlib', 'pyyaml', 'descript-audiotools', 'encodec', 'beartype', 'easydict', 'argbind', 'setuptools<81', 'av', 'parameterized', 'yacs', 'msgspec', 'rouge-score', 'sacrebleu', 'blobfile', 'wandb', 'viztracer', 'pynvml', 'orjson', 'pyahocorasick', 'torchdata', 'opencv-python', 'h5py', 'progressbar']
GUIDESEP_PACKAGES = ['numpy', 'scipy', 'soundfile', 'einops', 'einops-exts', 'torchsde', 'typing_extensions', 'huggingface-hub>=0.34,<1', 'omegaconf', 'tqdm']
# perception-models imports xformers at module load but never calls it in SDPA mode; sam_audio imports torchcodec,
# which needs system FFmpeg libraries. Stem Studio only passes decoded tensors, so inert stubs are enough.
_MISSING = 'class _Unavailable:\n    def __init__(self, *args, **kwargs):\n        raise RuntimeError({message!r})\n'
PYTHON_STUBS = {
    'xformers/__init__.py': '',
    'xformers/ops/__init__.py': 'class AttentionBias:\n    pass\n\n\nclass _Fmha:\n    def __getattr__(self, name):\n        raise RuntimeError("xformers is not available: Stem Studio uses PyTorch SDPA attention")\n\n\nfmha = _Fmha()\n',
    'torchcodec/__init__.py': '',
    'torchcodec/decoders.py': _MISSING.format(message='torchcodec decoders is not available: Stem Studio passes decoded tensors') + '\n\nAudioDecoder = VideoDecoder = _Unavailable\n',
    'torchcodec/encoders.py': _MISSING.format(message='torchcodec encoders is not available: SAM rankers are disabled') + '\n\nAudioEncoder = _Unavailable\n',
}


class Cancelled(Exception):
    pass


def system_key():
    name = {'win32': 'windows', 'darwin': 'darwin'}.get(sys.platform, 'linux')
    machine = platform.machine().lower()
    arch = 'aarch64' if machine in ('arm64', 'aarch64') else 'x86_64' if machine in ('amd64', 'x86_64', 'x64') else machine
    return name, arch


def torch_index(key=None):
    """CUDA 12.8 wheels exist for Windows and x86_64 Linux; other platforms use the default index."""
    name, arch = key or system_key()
    return 'https://download.pytorch.org/whl/cu128' if (name == 'windows' or (name == 'linux' and arch == 'x86_64')) else None


def venv_python(runtime, windows=None):
    runtime = Path(runtime)
    return runtime / 'Scripts' / 'python.exe' if (windows if windows is not None else sys.platform == 'win32') else runtime / 'bin' / 'python'


def site_packages(runtime, windows=None):
    runtime = Path(runtime)
    if windows if windows is not None else sys.platform == 'win32':
        return runtime / 'Lib' / 'site-packages'
    found = sorted((runtime / 'lib').glob('python3*/site-packages'))
    return found[0] if found else runtime / 'lib' / 'python3.12' / 'site-packages'


def sha256_file(path, algorithm='sha256', block=8 * 1024 * 1024):
    digest = hashlib.new(algorithm.lower())
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(block), b''):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(path):
    pure = Path(path)
    if pure.is_absolute() or path.startswith(('/', chr(92))) or '..' in pure.parts or not pure.parts or re.search(r'[<>:"|?*\x00-\x1f]', path):
        raise ValueError(f'Unsafe model path in manifest: {path}')
    return pure


def is_local(address):
    return address in ('127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost')


class Job:
    """One preparation at a time per kind. State is a small dict the UI polls."""

    def __init__(self):
        self.state = {'phase': 'idle', 'message': '', 'detail': ''}
        self.lock = threading.Lock()
        self.cancel_event = threading.Event()
        self.process = None
        self.thread = None

    @property
    def active(self):
        return self.thread is not None and self.thread.is_alive()

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def update(self, **patch):
        with self.lock:
            self.state.update(patch)

    def cancel(self):
        self.cancel_event.set()
        process = self.process
        if process and process.poll() is None:
            try:
                process.terminate()
            except OSError:
                pass

    def check(self):
        if self.cancel_event.is_set():
            raise Cancelled()

    def start(self, work, label):
        if self.active:
            raise RuntimeError(f'{label} preparation is already running.')
        self.cancel_event.clear()
        self.update(phase='preparing', message=f'Preparing {label}…', detail='')

        def runner():
            try:
                work()
            except Cancelled:
                self.update(phase='cancelled', message=f'{label} preparation cancelled. Downloaded files are retained.', detail='')
            except Exception as error:  # noqa: BLE001 - surfaced to the user verbatim
                self.update(phase='failed', message=redact(str(error)), detail='')
        self.thread = threading.Thread(target=runner, name=f'stemstudio-{label}', daemon=True)
        self.thread.start()

    def run(self, command, env=None, secrets=()):
        """Run a subprocess, stream the last lines to the state and honor cancel. Never uses a shell."""
        self.check()
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) if sys.platform == 'win32' else 0
        process = subprocess.Popen([str(part) for part in command], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=flags)
        self.process = process
        tail = ''
        try:
            for raw in iter(process.stdout.readline, b''):
                tail = (tail + raw.decode('utf-8', 'replace'))[-2500:]
                for secret in secrets:
                    tail = tail.replace(secret, '[redacted]')
                self.update(detail=tail)
            code = process.wait()
        finally:
            self.process = None
            process.stdout.close()
        self.check()
        if code != 0:
            raise RuntimeError(f'Command failed ({code}). {tail}')


def redact(text):
    return re.sub(r'hf_[A-Za-z0-9]{10,250}', '[redacted]', text)


# ---- model packs ----------------------------------------------------------------------------------------

def load_manifest(setup_dir):
    manifest = json.loads((Path(setup_dir) / 'models.json').read_text(encoding='utf-8'))
    for pack in manifest['packs']:
        for entry in pack['files']:
            safe_relative(entry['path'])
            if not entry['url'].startswith('https://'):
                raise ValueError('Model downloads must use HTTPS.')
    return manifest


def pack_status(manifest, model_root):
    """Size check only (cheap). The nodes verify hashes when they load a model; downloads verify before publishing."""
    root = Path(model_root)
    result = []
    for pack in manifest['packs']:
        ready = all((root / entry['path']).is_file() and (root / entry['path']).stat().st_size == entry['size'] for entry in pack['files'])
        result.append({'id': pack['id'], 'name': pack['name'], 'license': pack.get('license', ''), 'licenseUrl': pack.get('licenseUrl', ''), 'source': pack.get('source', ''), 'ready': ready, 'size': sum(entry['size'] for entry in pack['files'])})
    return result


def download_file(url, destination, size, algorithm, expected, progress=None, cancelled=None, opener=None):
    """Resumable download into <name>.part, verified by size and hash before the atomic rename."""
    opener = opener or urllib.request.urlopen
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and destination.stat().st_size == size and sha256_file(destination, algorithm) == expected:
        return destination
    part = destination.with_name(destination.name + '.part')
    for attempt in range(2):
        have = part.stat().st_size if part.is_file() else 0
        if have > size:
            part.unlink()
            have = 0
        if have < size:
            request = urllib.request.Request(url, headers={'User-Agent': 'StemStudio-NodePack', **({'Range': f'bytes={have}-'} if have else {})})
            with opener(request, timeout=60) as response:
                status = getattr(response, 'status', 200)
                if have and status != 206:
                    have = 0  # The server ignored the range: restart cleanly.
                with open(part, 'ab' if have else 'wb') as handle:
                    while True:
                        if cancelled and cancelled():
                            raise Cancelled()
                        block = response.read(1024 * 1024)
                        if not block:
                            break
                        handle.write(block)
                        have += len(block)
                        if progress:
                            progress(have, size)
        if part.stat().st_size == size and sha256_file(part, algorithm) == expected:
            os.replace(part, destination)
            return destination
        part.unlink(missing_ok=True)  # Corrupt or wrong size: one clean retry, then fail.
    raise ValueError(f'Download of {destination.name} failed verification (size or {algorithm} mismatch). Nothing was installed.')


def write_runtime(node_dir, model_root):
    """Equivalent of installEngine: point the SFC node at the verified checkpoint. Best effort (folder may be read-only)."""
    checkpoint = Path(model_root) / 'sfc-locoformer-dnr' / 'model.pth'
    if not checkpoint.is_file():
        return None
    runtime = json.dumps({'checkpoint': str(checkpoint), 'model_root': str(model_root)}, indent=2)
    target = Path(node_dir) / 'runtime.json'
    try:
        if not target.is_file() or target.read_text(encoding='utf-8') != runtime:
            target.write_text(runtime, encoding='utf-8')
    except OSError:
        return None
    return target


def prepare_models(job, manifest, model_root, wanted, node_dir, opener=None):
    packs = [pack for pack in manifest['packs'] if pack['id'] in wanted]
    if not packs or len(packs) != len(set(wanted)):
        raise ValueError('Choose valid model packs.')
    files = [entry for pack in packs for entry in pack['files']]
    total = sum(entry['size'] for entry in files)
    done = 0
    for entry in files:
        job.check()
        base = done
        label = entry['path']

        def progress(have, size, base=base, label=label):
            job.update(phase='downloading', message=f'Downloading {label}', detail=f'{(base + have) / 1048576:.0f} of {total / 1048576:.0f} MiB')
        download_file(entry['url'], Path(model_root) / safe_relative(entry['path']), entry['size'], entry['algorithm'], entry['hash'], progress, job.cancel_event.is_set, opener)
        done += entry['size']
    write_runtime(node_dir, model_root)
    job.update(phase='complete', message='Model packs verified. Run the audio engine check, then separate.', detail='')


# ---- private Python runtimes (SAM Audio, GuideSep) ------------------------------------------------------

def ensure_uv(job, root, key=None, opener=None):
    opener = opener or urllib.request.urlopen
    key = key or system_key()
    if key not in UV_ASSETS:
        raise RuntimeError(f'No pinned runtime manager for {key[0]} {key[1]}. SAM Audio and GuideSep preparation are not supported on this platform yet.')
    name, expected = UV_ASSETS[key]
    tools = Path(root) / f'uv-{UV_VERSION}'
    binary = tools / ('uv.exe' if key[0] == 'windows' else 'uv')
    if binary.is_file():
        return binary
    job.update(phase='downloading', message='Downloading the runtime manager (uv)…', detail=name)
    archive = Path(root) / name
    Path(root).mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(f'https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/{name}', headers={'User-Agent': 'StemStudio-NodePack'})
    with opener(request, timeout=60) as response, open(archive, 'wb') as handle:
        shutil.copyfileobj(response, handle, 1024 * 1024)
    if sha256_file(archive) != expected:
        archive.unlink(missing_ok=True)
        raise RuntimeError('Runtime manager integrity check failed. Retry preparation.')
    stage = Path(root) / f'uv-stage-{os.getpid()}'
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    try:
        if name.endswith('.zip'):
            with zipfile.ZipFile(archive) as bundle:
                for member in bundle.namelist():
                    if member.startswith('/') or '..' in Path(member).parts:
                        raise RuntimeError('The runtime manager archive has an unsafe layout.')
                bundle.extractall(stage)
        else:
            with tarfile.open(archive) as bundle:
                for member in bundle.getmembers():
                    if member.name.startswith('/') or '..' in Path(member.name).parts or not (member.isfile() or member.isdir()):
                        raise RuntimeError('The runtime manager archive has an unsafe layout.')
                try:
                    bundle.extractall(stage, filter='data')
                except TypeError:  # Python builds without extraction filters; members were validated above.
                    bundle.extractall(stage)
        found = [path for path in stage.rglob(binary.name) if path.is_file()]
        if not found:
            raise RuntimeError('The runtime manager archive has an unexpected layout.')
        tools.mkdir(parents=True, exist_ok=True)
        shutil.move(str(found[0]), str(binary))
        binary.chmod(0o755)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
        archive.unlink(missing_ok=True)
    return binary


def clean_env(extra):
    env = dict(os.environ)
    for key in list(env):
        if re.match(r'^(PIP_|UV_INDEX|UV_DEFAULT_INDEX|UV_EXTRA_INDEX)', key):
            del env[key]
    for key in ('PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
        env.pop(key, None)
    env.update({key: str(value) for key, value in extra.items()})
    env.update({'UV_NO_PROGRESS': '1', 'PYTHONUNBUFFERED': '1'})
    return env


def runtime_ready(model_dir, checkpoint):
    try:
        config = json.loads((Path(model_dir) / 'stem-runtime.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False
    python = config.get('python')
    weights = Path(model_dir) / checkpoint
    return isinstance(python, str) and Path(python).is_file() and weights.is_file() and weights.stat().st_size > 0


def _venv_and_torch(job, uv, runtime, env, constraints, torch_packages, key=None):
    python = venv_python(runtime)
    job.run([uv, '--no-config', 'venv', '--python', '3.12', '--managed-python', '--allow-existing', runtime], env)
    Path(constraints[0]).parent.mkdir(parents=True, exist_ok=True)
    Path(constraints[0]).write_text(constraints[1], encoding='utf-8')
    job.update(phase='installing', message='Installing private PyTorch libraries…')
    command = [uv, '--no-config', 'pip', 'install', '--python', python]
    index = torch_index(key)
    command += ['--index-url', index] if index else ['--default-index', 'https://pypi.org/simple']
    job.run(command + torch_packages, env)
    return python


def check_sam_request(setup_dir, variant, token):
    if variant not in SAM_VARIANTS:
        raise ValueError('Choose SAM Small or Large.')
    if not re.fullmatch(r'hf_[a-zA-Z0-9]{10,250}', token or ''):
        raise ValueError('Enter a Hugging Face read token with access to SAM Audio and its encoder models.')
    script = Path(setup_dir) / 'prepare-sam.py'
    if not script.is_file():
        raise RuntimeError('prepare-sam.py is not part of this install. Install Stem Studio from its repository or use the desktop app.')
    return script


def check_guidesep_request(setup_dir):
    script = Path(setup_dir) / 'prepare-guidesep.py'
    if not script.is_file():
        raise RuntimeError('prepare-guidesep.py is not part of this install. Install Stem Studio from its repository or use the desktop app.')
    return script


def prepare_sam(job, setup_dir, model_dir, private_root, variant, token, cache_root, key=None, opener=None):
    script = check_sam_request(setup_dir, variant, token)
    model_dir = Path(model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / 'stem-runtime.json').unlink(missing_ok=True)
    root = Path(private_root)
    uv = ensure_uv(job, root, key, opener)
    runtime = root / 'sam-audio' / 'runtime'
    env = clean_env({'HF_TOKEN': token, 'HF_HOME': cache_root, 'TORCH_HOME': Path(cache_root) / 'torch', 'XDG_CACHE_HOME': Path(cache_root) / 'xdg', 'UV_PYTHON_INSTALL_DIR': root / 'python', 'UV_CACHE_DIR': root / 'sam-audio' / 'cache'})
    secrets = (token,)
    run = lambda command: job.run(command, env, secrets)  # noqa: E731
    python = _venv_and_torch(job, uv, runtime, env, (root / 'sam-audio' / 'sam-constraints.txt', SAM_CONSTRAINTS), ['torch==2.11.0', 'torchaudio==2.11.0', 'torchvision==0.26.0'], key)
    job.update(message='Installing SAM Audio and its private dependencies…')
    run([uv, '--no-config', 'pip', 'install', '--python', python, '--no-deps', '--default-index', 'https://pypi.org/simple', *SAM_SOURCES])
    run([uv, '--no-config', 'pip', 'install', '--python', python, '--constraint', root / 'sam-audio' / 'sam-constraints.txt', '--default-index', 'https://pypi.org/simple', *SAM_PACKAGES])
    site = site_packages(runtime)
    shutil.rmtree(site / 'torchcodec', ignore_errors=True)
    for relative, text in PYTHON_STUBS.items():
        target = site / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')
    job.update(phase='downloading', message='Downloading approved SAM weights and encoder files. Existing cache is reused…')
    run([python, script, model_dir, 'facebook/sam-audio-' + variant])
    (model_dir / 'stem-runtime.json').write_text(json.dumps({'python': str(python), 'revision': SAM_REVISION, 'repo': 'facebook/sam-audio-' + variant, 'cacheRoot': str(cache_root)}, indent=2), encoding='utf-8')
    job.update(phase='complete', message='SAM Audio prepared. Select a target and extract a short range.', detail='')


def prepare_guidesep(job, setup_dir, model_dir, private_root, key=None, opener=None):
    script = check_guidesep_request(setup_dir)
    model_dir = Path(model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / 'stem-runtime.json').unlink(missing_ok=True)
    root = Path(private_root)
    uv = ensure_uv(job, root, key, opener)
    runtime = root / 'guidesep' / 'runtime'
    env = clean_env({'HF_HOME': model_dir / 'cache', 'UV_PYTHON_INSTALL_DIR': root / 'python', 'UV_CACHE_DIR': root / 'sam-audio' / 'cache'})
    python = _venv_and_torch(job, uv, runtime, env, (root / 'guidesep' / 'guidesep-constraints.txt', GUIDESEP_CONSTRAINTS), ['torch==2.11.0', 'torchaudio==2.11.0'], key)
    job.update(message='Installing GuideSep dependencies…')
    job.run([uv, '--no-config', 'pip', 'install', '--python', python, '--default-index', 'https://pypi.org/simple', '--constraint', root / 'guidesep' / 'guidesep-constraints.txt', *GUIDESEP_PACKAGES], env)
    job.update(phase='downloading', message='Downloading the GuideSep checkpoint (about 1 GB) and extracting weights…')
    job.run([python, script, model_dir], env)
    (model_dir / 'stem-runtime.json').write_text(json.dumps({'python': str(python), 'revision': GUIDESEP_REVISION, 'repo': 'YutongCooper/GuideSep-v1'}, indent=2), encoding='utf-8')
    job.update(phase='complete', message='GuideSep prepared. Choose a reference sound and extract a short range first.', detail='')


# ---- brush sound models, six-stem music and MMAudio -----------------------------------------------------
# The pins live in setup/extra-models.json, generated from the desktop app's own constants (scripts/make-extra-models.mjs).

def load_extra(setup_dir):
    data = json.loads((Path(setup_dir) / 'extra-models.json').read_text(encoding='utf-8'))
    groups = [data['music']['files'], data['mmaudio']['files'], *[model['files'] for model in data['brush']['models'].values()]]
    for files in groups:
        for entry in files:
            safe_relative(entry['path'])
            if not entry['url'].startswith('https://') or not re.fullmatch(r'[0-9a-f]{64}', entry['sha256']):
                raise ValueError('Model downloads must use HTTPS and a SHA-256 pin.')
    for name in data['mmaudio']['node']['files']:
        safe_relative(name)
    return data


def files_ready(files, root):
    """Size check only; the downloader verified the hash before publishing each file."""
    return all((Path(root) / entry['path']).is_file() and (Path(root) / entry['path']).stat().st_size == entry['size'] for entry in files)


def prepare_files(job, files, root, done_message, opener=None):
    total = sum(entry['size'] for entry in files)
    done = 0
    for entry in files:
        job.check()
        start = done

        def progress(have, size, start=start, name=entry['name']):
            job.update(phase='downloading', message=f'Downloading {name}', percent=round((start + have) / total * 100), detail=f'{(start + have) / 1048576:.0f} / {total / 1048576:.0f} MiB')
        download_file(entry['url'], Path(root) / safe_relative(entry['path']), entry['size'], 'sha256', entry['sha256'], progress, job.cancel_event.is_set, opener)
        done += entry['size']
    job.update(phase='complete', message=done_message, percent=100, detail='')


def git_blob_sha(content):
    return hashlib.sha1(b'blob %d\x00' % len(content) + content).hexdigest()


def mmaudio_node_installed(custom_nodes, node):
    return (Path(custom_nodes) / node['folder'] / '.stemstudio.json').is_file()


def install_mmaudio_node(job, node, custom_nodes, opener=None):
    """Unpacks the pinned commit of the community node pack, checking every file against its git blob hash first."""
    import io
    target = Path(custom_nodes) / node['folder']
    if mmaudio_node_installed(custom_nodes, node):
        return False
    if target.exists():
        raise ValueError(f'A custom node folder named {node["folder"]} already exists and was not installed by Stem Studio. Move it aside first.')
    job.update(phase='installing', message='Downloading the MMAudio node pack from GitHub…', percent=-1)
    request = urllib.request.Request(node['archive'], headers={'User-Agent': 'StemStudio-NodePack'})
    with (opener or urllib.request.urlopen)(request, timeout=60) as response:
        data = response.read(20 * 1024 * 1024 + 1)
    if not data or len(data) > 20 * 1024 * 1024:
        raise ValueError('The node pack archive has an unexpected size. Nothing was installed.')
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = [name for name in archive.namelist() if not name.endswith('/')]
        if len({name.split('/')[0] for name in names}) != 1:
            raise ValueError('The node pack archive has an unexpected layout. Nothing was installed.')
        for name in names:
            relative = name.split('/', 1)[1]
            safe_relative(relative)
            content = archive.read(name)
            if node['files'].get(relative) != git_blob_sha(content):
                raise ValueError(f'The downloaded node pack differs from the pinned version ({relative}). Nothing was installed.')
            files[relative] = content
    for required in ('__init__.py', 'nodes.py', 'requirements.txt'):
        if required not in files:
            raise ValueError(f'The downloaded node pack is incomplete ({required}). Nothing was installed.')
    staging = target.with_name(target.name + '.installing')
    shutil.rmtree(staging, ignore_errors=True)
    for relative, content in files.items():
        destination = staging / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    (staging / '.stemstudio.json').write_text(json.dumps({'owner': 'Stem Studio', 'commit': node['commit']}), encoding='utf-8')
    os.replace(staging, target)
    return True


def python_imports_ready(imports, python=None):
    """ComfyUI's own interpreter runs this code, so its packages are the ones the node pack will use."""
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) if sys.platform == 'win32' else 0
    try:
        return subprocess.run([python or sys.executable, '-c', 'import ' + ', '.join(imports)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags, timeout=120).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def prepare_mmaudio(job, spec, models_dir, custom_nodes, opener=None):
    install_mmaudio_node(job, spec['node'], custom_nodes, opener)
    job.check()
    if not python_imports_ready(spec['imports']):
        job.update(phase='installing', message="Installing the Python packages the node pack needs into ComfyUI's Python…", percent=-1, detail='')
        job.run([sys.executable, '-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', '-r', Path(custom_nodes) / spec['node']['folder'] / 'requirements.txt'])
        if not python_imports_ready(spec['imports']):
            raise RuntimeError("The packages installed but ComfyUI's Python still cannot import them. See the ComfyUI log.")
    prepare_files(job, spec['files'], Path(models_dir) / spec['folder'], 'MMAudio is ready. Restart ComfyUI once so it loads the new nodes, then check the engine again.', opener)
