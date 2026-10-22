// Writes setup/extra-models.json from the same constants the desktop app uses, so the node pack's Python downloads can
// never drift from the Electron side. Run: node scripts/make-extra-models.mjs
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BRUSH_FOLDER, brushFiles } from '../src/shared/brush.mjs';
import { MUSIC_FILES, MUSIC_FOLDER } from '../src/shared/music.mjs';
import { MMAUDIO_ARCHIVE, MMAUDIO_COMMIT, MMAUDIO_FILES, MMAUDIO_IMPORTS, MMAUDIO_NODE_FOLDER } from '../src/shared/mmaudio.mjs';

const clean = files => files.map(({ path, name, url, size, sha256 }) => ({ path, name, url, size, sha256 }));
export async function extraModels() {
  const manifest = JSON.parse(await readFile(new URL('../setup/mmaudio-manifest.json', import.meta.url), 'utf8'));
  return {
    brush: { folder: BRUSH_FOLDER, models: { small: { files: clean(brushFiles('small')) }, medium: { files: clean(brushFiles('medium')) } } },
    music: { folder: MUSIC_FOLDER, files: clean(MUSIC_FILES) },
    mmaudio: { folder: 'mmaudio', files: clean(MMAUDIO_FILES), imports: MMAUDIO_IMPORTS, node: { folder: MMAUDIO_NODE_FOLDER, archive: MMAUDIO_ARCHIVE, commit: MMAUDIO_COMMIT, files: manifest.files } },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('../setup/extra-models.json', import.meta.url), JSON.stringify(await extraModels(), null, 1) + '\n');
  console.log('setup/extra-models.json written');
}
