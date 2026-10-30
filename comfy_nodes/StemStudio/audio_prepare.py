"""Copy a media file's first audio stream into an audio-only container.

Packets are remuxed without encoding, so this is fast and preserves the audio
bytes already present in the source. Also used by the node-pack web endpoint.
"""
import json
import os
import sys
from pathlib import Path


def audio_only(source, destination):
    import av

    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.part')
    temporary.unlink(missing_ok=True)
    try:
        with av.open(str(source)) as incoming:
            if not incoming.streams.audio:
                raise ValueError('The selected media has no audio stream.')
            stream = incoming.streams.audio[0]
            duration = float(incoming.duration / av.time_base) if incoming.duration is not None else None
            if duration is None and stream.duration is not None and stream.time_base is not None:
                duration = float(stream.duration * stream.time_base)
            with av.open(str(temporary), 'w', format='matroska') as outgoing:
                target = outgoing.add_stream_from_template(stream)
                for packet in incoming.demux(stream):
                    if packet.dts is None:
                        continue
                    packet.stream = target
                    outgoing.mux(packet)
        if not temporary.stat().st_size:
            raise ValueError('The extracted audio was empty.')
        os.replace(temporary, destination)
        return {'path': str(destination), 'size': destination.stat().st_size, 'duration': duration}
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: audio_prepare.py SOURCE DESTINATION')
    print(json.dumps(audio_only(sys.argv[1], sys.argv[2])))
