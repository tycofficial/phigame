import { cp, mkdir, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await mkdir(dist, { recursive: true });
for (const name of await readdir(dist)) await rm(path.join(dist, name), { recursive: true, force: true });
await cp(path.join(root, 'public'), dist, { recursive: true });
await cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
const p = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(dist, 'version.json'), JSON.stringify({ version: p.version }));
const fallback = {};
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), relative + '/');
    else fallback[relative] = (await readFile(path.join(directory, entry.name))).toString('base64');
  }
}
await collect(dist);
const worker = await readFile(path.join(root, 'scripts/worker.mjs'), 'utf8');
await mkdir(path.join(dist, 'server'), { recursive: true });
await writeFile(path.join(dist, 'server/index.js'), `${worker}\nconst fallback = ${JSON.stringify(fallback)};\nexport default createWorker(fallback);\n`);
console.log(`Built PHIGAME ${p.version} → dist/`);
