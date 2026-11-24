import fs from 'node:fs';
for (const dir of ['.next', '.next-build']) {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('cleaned .next and .next-build');
