"""Sample actual uploaded video and retain manually marked target boxes."""
def masked_frames(video, start, duration, keyframes, destination):
    import math
    import av
    import numpy as np
    import comfy.model_management as mm
    from .sam_contract import box_at
    # A native VIDEO reference supplies the already approved uploaded input.
    source = video.get_stream_source()
    count = max(2, min(121, math.ceil(duration * 4) + 1))
    moments = np.linspace(0, max(0, duration - .001), count)
    output = []
    def append(frame, moment):
        scale = min(1, 256 / max(frame.width, frame.height))
        width, height = max(2, round(frame.width * scale)), max(2, round(frame.height * scale))
        rgb = frame.reformat(width=width, height=height, format='rgb24').to_ndarray()
        rotation = int(getattr(frame, 'rotation', 0) or 0)
        if rotation % 90: raise ValueError('Visual guidance supports right-angle video rotation only.')
        if rotation: rgb = np.rot90(rgb, k=rotation // 90)
        height, width = rgb.shape[:2]
        box = box_at(keyframes, float(moment))
        if box is None:
            output.append(np.zeros_like(rgb).transpose(2, 0, 1)); return
        x1, y1 = int(box['x'] * width), int(box['y'] * height)
        x2 = min(width, max(x1 + 1, math.ceil((box['x'] + box['width']) * width)))
        y2 = min(height, max(y1 + 1, math.ceil((box['y'] + box['height']) * height)))
        mask = np.zeros_like(rgb); mask[y1:y2, x1:x2] = rgb[y1:y2, x1:x2]
        output.append(mask.transpose(2, 0, 1))
    with av.open(source) as container:
        if not container.streams.video: raise ValueError('Visual reference has no video frames.')
        stream = container.streams.video[0]
        origin = float((stream.start_time or 0) * stream.time_base)
        container.seek(max(0, int((origin + start) / stream.time_base)), stream=stream, backward=True)
        pending = 0; previous = None; previous_time = None
        for frame in container.decode(stream):
            mm.throw_exception_if_processing_interrupted()
            if frame.pts is None: continue
            time = float(frame.pts * stream.time_base) - origin - start
            while pending < count and time >= moments[pending]:
                chosen = previous if previous is not None and abs(previous_time - moments[pending]) < abs(time - moments[pending]) else frame
                append(chosen, moments[pending]); pending += 1
            if pending == count: break
            previous, previous_time = frame, time
        tail = 0.0
        if pending < count and previous is not None:
            # The last frame covers its display duration even without a later PTS.
            tail = float(getattr(previous, 'duration', 0) or 0) * float(stream.time_base)
            if tail <= 0 and stream.average_rate: tail = 1 / float(stream.average_rate)
            # Audio tracks are often a fraction of a second longer than the picture; hold the last frame for that gap.
            while pending < count and moments[pending] <= previous_time + tail + max(0.5, 3 * tail):
                append(previous, moments[pending]); pending += 1
        if pending != count:
            ends = start + (previous_time + tail if previous_time is not None else 0)
            raise ValueError(f'The source video ends at about {ends:.1f}s but the selection runs to {start + duration:.1f}s. Shorten the selection so it stays inside the picture.')
    np.save(destination, np.stack(output), allow_pickle=False)
