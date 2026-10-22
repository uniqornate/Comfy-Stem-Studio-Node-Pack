"""Invoked only after the user approves SAM preparation and provides access."""
import os
import sys
from pathlib import Path

def main(destination, repo='facebook/sam-audio-small-tv'):
    from huggingface_hub import snapshot_download, HfApi
    if repo not in ['facebook/sam-audio-small-tv', 'facebook/sam-audio-large-tv']:
        raise ValueError('Unsupported SAM model')
    revision = HfApi().model_info(repo).sha
    print('SAM snapshot ' + revision, flush=True)
    snapshot_download(repo_id=repo, revision=revision, local_dir=destination, max_workers=4)
    print('Loading processor and caching encoder dependencies on CPU. No separation is run.', flush=True)
    from sam_audio import SAMAudio, SAMAudioProcessor
    processor = SAMAudioProcessor.from_pretrained(str(destination))
    model = SAMAudio.from_pretrained(str(destination))
    # A second fully offline load ensures all secondary weights/tokenizers exist.
    del model, processor
    import gc
    gc.collect()
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    import huggingface_hub.constants
    import transformers.utils.hub
    huggingface_hub.constants.HF_HUB_OFFLINE = True
    transformers.utils.hub._is_offline_mode = True
    SAMAudioProcessor.from_pretrained(str(destination))
    SAMAudio.from_pretrained(str(destination))
    (destination / 'stem-snapshot.txt').write_text(revision, encoding='ascii')
    print('SAM files and offline model loading verified.', flush=True)

if __name__ == '__main__':
    main(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else 'facebook/sam-audio-small-tv')
