import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await mkdir(dist, { recursive: true });
for (const name of await readdir(dist)) await rm(path.join(dist, name), { recursive: true, force: true });
for (const name of ['index.html', 'icon.svg', '.nojekyll', 'assets', 'src']) await cp(path.join(root, name), path.join(dist, name), { recursive: true });
console.log('Built PHIGAME → dist/');
