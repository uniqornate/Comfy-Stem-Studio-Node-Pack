"""Lossless VIDEO adapter for ComfyUI's native SaveVideo, with no CLI process."""
from contextlib import ExitStack
from fractions import Fraction
from pathlib import Path
import heapq
import math
from comfy_api.latest._input import VideoInput


def input_file(file):
    import folder_paths
    path = Path(folder_paths.get_annotated_filepath(file)).resolve()
    root = Path(folder_paths.get_input_directory()).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('Export audio must be an uploaded ComfyUI input file.')
    return str(path)


class StemStudioVideoTrack:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'file': ('STRING', {'default': ''}), 'label': ('STRING', {'default': 'Stem'}),
            'mute': ('BOOLEAN', {'default': False}), 'solo': ('BOOLEAN', {'default': False}),
            'level': ('FLOAT', {'default': 1.0, 'min': 0.0, 'max': 1.0})},
            'optional': {'previous': ('STEM_STUDIO_TRACKS',)}}
    RETURN_TYPES = ('STEM_STUDIO_TRACKS',)
    FUNCTION = 'track'
    CATEGORY = 'Stem Studio'
    def track(self, file, label, mute, solo, level, previous=None):
        if not math.isfinite(level) or not 0 <= level <= 1: raise ValueError('Invalid channel gain.')
        tracks = list(previous or [])
        if len(tracks) >= 527: raise ValueError('Too many channels.')
        tracks.append({'path': input_file(file), 'label': str(label)[:120], 'mute': bool(mute), 'solo': bool(solo), 'level': level})
        return (tracks,)


class StemStudioVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'video': ('VIDEO',), 'tracks': ('STEM_STUDIO_TRACKS',), 'mode': (['mix', 'tracks'],)}}
    RETURN_TYPES = ('VIDEO',)
    FUNCTION = 'prepare'
    CATEGORY = 'Stem Studio'
    def prepare(self, video, tracks, mode):
        if mode not in ['mix', 'tracks'] or not tracks: raise ValueError('Choose export audio.')
        return (StemVideo(video, tracks, mode),)


class StemVideo(VideoInput):
    def __init__(self, source, tracks, mode):
        self.source, self.tracks, self.mode = source, tracks, mode
    def get_dimensions(self): return self.source.get_dimensions()
    def get_duration(self): return self.source.get_duration()
    def get_frame_count(self): return self.source.get_frame_count()
    def get_frame_rate(self): return self.source.get_frame_rate()
    def get_bit_depth(self): return self.source.get_bit_depth()
    def get_color_space(self): return self.source.get_color_space()
    def get_components(self): raise ValueError('This export-only VIDEO preserves encoded packets; connect it directly to SaveVideo.')
    def as_trimmed(self, *args, **kwargs): raise ValueError('Trim before creating the export VIDEO.')

    def save_to(self, path, format=None, codec=None, metadata=None, **kwargs):
        import av
        import numpy as np
        import comfy.model_management as mm
        from comfy.utils import ProgressBar
        from comfy_api.latest._input_impl.video_types import write_output_metadata
        if getattr(format, 'value', format) not in [None, 'auto', 'mkv'] or getattr(codec, 'value', codec) not in [None, 'auto']:
            raise ValueError('Lossless Stem Studio export requires SaveVideo format MKV and codec Auto.')
        if any(kwargs.get(key) is not None for key in ['crf', 'bit_depth', 'color_space', 'preset']):
            raise ValueError('Re-encoding overrides are not supported for lossless export.')
        source = self.source.get_stream_source()
        if not isinstance(source, (str, Path)): raise ValueError('Export requires an encoded file from LoadVideo.')
        if isinstance(path, (str, Path)) and Path(path).resolve() in [Path(source).resolve(), *[Path(track['path']).resolve() for track in self.tracks]]:
            raise ValueError('Export must not overwrite an input file.')
        solo = any(track['solo'] for track in self.tracks)
        selected = self.tracks if self.mode == 'tracks' else [track for track in self.tracks if not track['mute'] and (not solo or track['solo']) and track['level'] > 0]
        opened = False
        try:
            with ExitStack() as stack:
                original = stack.enter_context(av.open(source, mode='r'))
                if not original.streams.video: raise ValueError('Source has no video stream.')
                video = original.streams.video[0]
                video_origin = Fraction(video.start_time or 0) * video.time_base
                original_audio = original.streams.audio[0] if original.streams.audio else None
                audio_origin = Fraction(original_audio.start_time or 0) * original_audio.time_base if original_audio else video_origin
                duration = self.get_duration()
                if not math.isfinite(duration) or duration <= 0: raise ValueError('Source duration is unavailable.')
                sources = []
                for track in selected:
                    container = stack.enter_context(av.open(track['path'], mode='r'))
                    if not container.streams.audio or container.streams.audio[0].codec_context.name != 'flac': raise ValueError('Export expects FLAC stem files.')
                    sources.append((track, container, container.streams.audio[0]))
                output = stack.enter_context(av.open(path, mode='w', format='matroska')); opened = True
                write_output_metadata(original, output, metadata)
                target_video = output.add_stream_from_template(video, opaque=True)
                progress = ProgressBar(1000)
                def video_packets():
                    last = 0
                    for packet in original.demux(video):
                        mm.throw_exception_if_processing_interrupted()
                        if packet.dts is None: continue
                        position = Fraction(packet.pts if packet.pts is not None else packet.dts) * packet.time_base - video_origin
                        last = max(last, min(999, int(float(position) / duration * 1000)))
                        progress.update_absolute(last, 1000)
                        packet.stream = target_video
                        yield packet
                streams = [video_packets()]
                if self.mode == 'tracks':
                    for index, (track, container, stream) in enumerate(sources):
                        target = output.add_stream_from_template(stream, opaque=True)
                        target.metadata['title'] = track['label']
                        target.disposition = 1 if index == 0 else 0
                        def audio_packets(container=container, stream=stream, target=target):
                            for packet in container.demux(stream):
                                mm.throw_exception_if_processing_interrupted()
                                if packet.dts is None: continue
                                offset = round(audio_origin / packet.time_base)
                                if packet.pts is not None: packet.pts += offset
                                packet.dts += offset
                                packet.stream = target
                                yield packet
                        streams.append(audio_packets())
                else:
                    rate = sources[0][2].sample_rate if sources else 48000
                    layout = sources[0][2].layout.name if sources else 'mono'
                    channels = len(sources[0][2].layout.channels) if sources else 1
                    if any(stream.sample_rate != rate or stream.layout.name != layout for _, _, stream in sources): raise ValueError('Mix channels must have matching rate and layout. Export separate tracks instead.')
                    target = output.add_stream('flac', rate=rate, layout=layout)
                    target.codec_context.format = 's32'
                    target.metadata['title'] = 'Stem Studio mix'
                    video_end = video_origin + (Fraction(video.duration) * video.time_base if video.duration is not None else Fraction(str(duration)))
                    total = max(1, round((video_end - audio_origin) * rate))
                    def decoded(container, stream):
                        converter = av.AudioResampler(format='fltp', layout=layout, rate=rate)
                        for frame in container.decode(stream):
                            mm.throw_exception_if_processing_interrupted()
                            for converted in converter.resample(frame): yield converted.to_ndarray()
                        for converted in converter.resample(None): yield converted.to_ndarray()
                    readers = [{'iterator': iter(decoded(container, stream)), 'data': None, 'offset': 0, 'level': track['level']} for track, container, stream in sources]
                    def read(reader, count):
                        value = np.zeros((channels, count), dtype=np.float32); filled = 0
                        while filled < count:
                            if reader['data'] is None or reader['offset'] >= reader['data'].shape[1]:
                                reader['data'] = next(reader['iterator'], None); reader['offset'] = 0
                                if reader['data'] is None: break
                            available = min(count - filled, reader['data'].shape[1] - reader['offset'])
                            value[:, filled:filled + available] = reader['data'][:, reader['offset']:reader['offset'] + available]
                            filled += available; reader['offset'] += available
                        return value
                    def mix_packets():
                        for position in range(0, total, 4096):
                            mm.throw_exception_if_processing_interrupted()
                            count = min(4096, total - position)
                            value = np.zeros((channels, count), dtype=np.float32)
                            for reader in readers: value += read(reader, count) * reader['level']
                            if not np.isfinite(value).all(): raise ValueError('Invalid mixed audio samples.')
                            pcm = (np.rint(np.clip(value, -1, 1 - 1 / 8388608) * 8388608).astype(np.int32) << 8)
                            frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(pcm.T).reshape(1, -1), format='s32', layout=layout)
                            frame.sample_rate = rate; frame.time_base = Fraction(1, rate); frame.pts = position + round(audio_origin * rate)
                            yield from target.encode(frame)
                        yield from target.encode(None)
                    streams.append(mix_packets())
                for packet in heapq.merge(*streams, key=lambda packet: Fraction(packet.dts if packet.dts is not None else packet.pts or 0) * packet.time_base):
                    mm.throw_exception_if_processing_interrupted()
                    output.mux(packet)
                progress.update_absolute(1000, 1000)
        except BaseException:
            if opened and isinstance(path, (str, Path)):
                Path(path).unlink(missing_ok=True)
            raise
