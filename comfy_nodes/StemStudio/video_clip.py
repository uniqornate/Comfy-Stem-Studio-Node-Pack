"""Cuts a region of the uploaded video into frames at a fixed rate, for video-to-sound models such as MMAudio."""
FPS = 25
MAX_SIDE = 384


def frame_indices(times, moments, hold=0.5):
    """For each wanted moment, the index of the nearest decoded frame. The last frame is held for up to `hold` seconds
    past the end of the picture; a larger gap means the video is shorter than the selection."""
    if not times:
        raise ValueError('The video has no frames at the selected time.')
    chosen = []
    for moment in moments:
        best = min(range(len(times)), key=lambda index: abs(times[index] - moment))
        if moment > times[-1] + hold:
            raise ValueError(f'The source video ends at about {times[-1]:.1f}s but the selection runs to {moments[-1]:.1f}s. Shorten the selection so it stays inside the picture.')
        chosen.append(best)
    return chosen


def clip_frames(video, start, seconds):
    import av
    import numpy as np
    import torch
    import comfy.model_management as mm
    source = video.get_stream_source()
    count = max(1, int(round(seconds * FPS)))
    moments = [start + index / FPS for index in range(count)]
    times, frames = [], []
    with av.open(source) as container:
        if not container.streams.video:
            raise ValueError('The source has no video frames.')
        stream = container.streams.video[0]
        origin = float((stream.start_time or 0) * stream.time_base)
        container.seek(max(0, int((origin + max(0.0, start - 0.5)) / stream.time_base)), stream=stream, backward=True)
        for frame in container.decode(stream):
            mm.throw_exception_if_processing_interrupted()
            if frame.pts is None:
                continue
            moment = float(frame.pts * stream.time_base) - origin
            if moment < start - 0.5:
                continue
            if moment > moments[-1] + 0.1:
                break
            scale = min(1, MAX_SIDE / max(frame.width, frame.height))
            width, height = max(2, round(frame.width * scale)), max(2, round(frame.height * scale))
            rgb = frame.reformat(width=width, height=height, format='rgb24').to_ndarray()
            rotation = int(getattr(frame, 'rotation', 0) or 0)
            if rotation % 90:
                raise ValueError('Only right-angle video rotation is supported.')
            if rotation:
                rgb = np.rot90(rgb, k=rotation // 90)
            times.append(moment)
            frames.append(rgb)
    picked = frame_indices(times, moments)
    return torch.from_numpy(np.stack([frames[index] for index in picked])).float() / 255.0


class StemStudioVideoClip:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'video': ('VIDEO',), 'start_seconds': ('FLOAT', {'default': 0.0, 'min': 0.0, 'max': 864000.0, 'step': 0.01}),
                             'seconds': ('FLOAT', {'default': 8.0, 'min': 0.1, 'max': 120.0, 'step': 0.01})}}

    RETURN_TYPES = ('IMAGE',)
    RETURN_NAMES = ('frames',)
    FUNCTION = 'cut'
    CATEGORY = 'Stem Studio'

    def cut(self, video, start_seconds, seconds):
        return (clip_frames(video, start_seconds, seconds),)
