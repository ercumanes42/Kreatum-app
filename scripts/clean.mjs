import { rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const distDirectory = resolve(projectRoot, 'dist');
const relativeTarget = relative(projectRoot, distDirectory);

if (!relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
  throw new Error('Refusing to clean a directory outside the project root.');
}

await rm(distDirectory, { recursive: true, force: true });