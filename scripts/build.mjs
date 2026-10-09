import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('_site', { recursive: true });
for (const file of ['index.html', 'icon.svg', '.nojekyll']) await copyFile(file, `_site/${file}`);
await cp('src', '_site/src', { recursive: true });
console.log('Static site prepared in _site/');
