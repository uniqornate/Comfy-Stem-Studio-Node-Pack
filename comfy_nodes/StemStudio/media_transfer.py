"""Small-request media transfer and audio-only preparation for long sources."""
import asyncio
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from aiohttp import web

from .audio_prepare import audio_only

CHUNK_BYTES = 8 * 1024 * 1024
MAX_BYTES = 32 * 1024 * 1024 * 1024
EXTENSIONS = {'.mp4', '.mov', '.m4v', '.webm', '.mkv', '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.mka'}
_sessions = {}
_prepared = {}


def _denied(request):
    if (request.remote or '') not in ('127.0.0.1', '::1', 'localhost'):
        return web.json_response({'error': 'Media transfer is available only on this ComfyUI machine.'}, status=403)
    origin = request.headers.get('Origin')
    if origin and urlsplit(origin).netloc != request.host:
        return web.json_response({'error': 'Cross-origin media transfer is not allowed.'}, status=403)
    return None


def _input():
    import folder_paths
    return Path(folder_paths.get_input_directory()).resolve()


def _folder(name):
    folder = _input() / 'StemStudio' / name
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def register(prompt_server=None):
    if prompt_server is None:
        try:
            from server import PromptServer
            prompt_server = PromptServer.instance
        except ImportError:
            return None
    if getattr(prompt_server, '_stemstudio_media_routes', False):
        return True
    prompt_server._stemstudio_media_routes = True

    @prompt_server.routes.post('/stemstudio/media/init')
    async def init(request):
        denied = _denied(request)
        if denied is not None:
            return denied
        try:
            data = await request.json()
            size = int(data['size'])
            suffix = Path(str(data['name'])).suffix.lower()
            if suffix not in EXTENSIONS or not 0 < size <= MAX_BYTES:
                raise ValueError('Unsupported media or invalid size.')
            token = uuid4().hex
            partial = _folder('inbox') / (token + suffix + '.part')
            partial.touch(exist_ok=False)
            _sessions[token] = {'path': partial, 'filename': token + suffix, 'size': size, 'received': 0, 'next': 0, 'lock': asyncio.Lock()}
            return web.json_response({'token': token, 'chunkBytes': CHUNK_BYTES})
        except (ValueError, TypeError, KeyError, OSError) as exc:
            return web.json_response({'error': str(exc)}, status=400)

    @prompt_server.routes.put('/stemstudio/media/{token}/{index}')
    async def chunk(request):
        denied = _denied(request)
        if denied is not None:
            return denied
        session = _sessions.get(request.match_info['token'])
        if not session:
            return web.json_response({'error': 'Unknown transfer session.'}, status=404)
        try:
            index = int(request.match_info['index'])
            async with session['lock']:
                if index != session['next']:
                    return web.json_response({'error': 'Chunks must arrive in order.'}, status=409)
                data = await request.read()
                if not data or len(data) > CHUNK_BYTES or session['received'] + len(data) > session['size']:
                    return web.json_response({'error': 'Invalid chunk size.'}, status=413)
                with session['path'].open('ab') as output:
                    output.write(data)
                session['received'] += len(data)
                session['next'] += 1
                return web.json_response({'received': session['received']})
        except (ValueError, OSError) as exc:
            return web.json_response({'error': str(exc)}, status=400)

    @prompt_server.routes.post('/stemstudio/media/{token}/complete')
    async def complete(request):
        denied = _denied(request)
        if denied is not None:
            return denied
        token = request.match_info['token']
        session = _sessions.get(token)
        if not session:
            return web.json_response({'error': 'Unknown transfer session.'}, status=404)
        async with session['lock']:
            if session['received'] != session['size'] or session['path'].stat().st_size != session['size']:
                return web.json_response({'error': 'Transfer is incomplete.'}, status=409)
            final = session['path'].with_suffix('')
            os.replace(session['path'], final)
            del _sessions[token]
            return web.json_response({'type': 'input', 'subfolder': 'StemStudio/inbox', 'name': session['filename']})

    @prompt_server.routes.delete('/stemstudio/media/{token}')
    async def cancel(request):
        denied = _denied(request)
        if denied is not None:
            return denied
        session = _sessions.pop(request.match_info['token'], None)
        if session:
            session['path'].unlink(missing_ok=True)
        return web.json_response({'cancelled': bool(session)})

    @prompt_server.routes.post('/stemstudio/audio/prepare')
    async def prepare(request):
        denied = _denied(request)
        if denied is not None:
            return denied
        try:
            data = await request.json()
            name = str(data['audio'])
            output_media = name.endswith(' [output]')
            if output_media:
                name = name[:-9]
            if not name or '..' in Path(name.replace('\\', '/')).parts or Path(name).is_absolute():
                raise ValueError('Invalid input media reference.')
            if output_media:
                import folder_paths
                root = Path(folder_paths.get_output_directory()).resolve()
            else:
                root = _input()
            source = (root / name).resolve()
            if not source.is_relative_to(root) or source.suffix.lower() not in EXTENSIONS or not source.is_file():
                raise ValueError('Media is not in the selected ComfyUI directory.')
            signature = (str(source), source.stat().st_size, source.stat().st_mtime_ns)
            cached = _prepared.get(signature)
            if cached and (_input() / cached['audio']).is_file():
                return web.json_response(cached)
            destination = _folder('audio') / (uuid4().hex + '.mka')
            info = await asyncio.to_thread(audio_only, source, destination)
            result = {'audio': 'StemStudio/audio/' + destination.name, 'size': info['size'], 'duration': info['duration']}
            _prepared[signature] = result
            return web.json_response(result)
        except (ValueError, TypeError, KeyError, OSError) as exc:
            return web.json_response({'error': str(exc)}, status=400)
    return True
