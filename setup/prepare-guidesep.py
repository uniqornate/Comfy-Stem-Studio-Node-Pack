"""Invoked only after the user approves GuideSep preparation. Downloads the pinned public checkpoint
and rewrites it as a tensor-only weights file so inference never unpickles third-party objects."""
import collections
import hashlib
import sys
import typing
from pathlib import Path

REPO = 'YutongCooper/GuideSep-v1'
REVISION = 'c7f97a2f938e355a6aefa53bf5e81ceaf3604275'
FILENAME = 'last.ckpt'
SHA256 = '9f09a077a17981dd6a76c9438f3c4a3dc8e801edfb7c50c266c5cff6eb5eaa24'


def main(destination):
    from huggingface_hub import hf_hub_download
    import torch
    from omegaconf import ListConfig
    from omegaconf.base import ContainerMetadata, Metadata
    from omegaconf.nodes import AnyNode
    destination.mkdir(parents=True, exist_ok=True)
    print('Downloading GuideSep v1 checkpoint (about 1 GB).', flush=True)
    source = Path(hf_hub_download(repo_id=REPO, filename=FILENAME, revision=REVISION, local_dir=str(destination / 'download')))
    print('Verifying checkpoint hash.', flush=True)
    digest = hashlib.sha256()
    with source.open('rb') as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != SHA256:
        raise ValueError('GuideSep checkpoint hash mismatch. Delete the download folder and retry.')
    print('Extracting model weights.', flush=True)
    inert = [ListConfig, ContainerMetadata, Metadata, AnyNode, typing.Any, collections.defaultdict, list, dict, int, set]
    with torch.serialization.safe_globals(inert):
        checkpoint = torch.load(source, map_location='cpu', weights_only=True)
    weights = {key: value.detach().clone().contiguous() for key, value in checkpoint['state_dict'].items() if key.startswith('net.') and torch.is_tensor(value)}
    if not weights:
        raise ValueError('The checkpoint has no net.* tensors.')
    del checkpoint
    torch.save(weights, destination / 'guidesep.pt')
    (destination / 'stem-snapshot.txt').write_text(REVISION, encoding='ascii')
    source.unlink()
    print(f'GuideSep weights ready: {len(weights)} tensors.', flush=True)


if __name__ == '__main__':
    main(Path(sys.argv[1]))
