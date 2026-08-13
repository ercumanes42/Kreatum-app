import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../node_modules/pdfkit/js/data/', import.meta.url));
const destination = fileURLToPath(new URL('../lib/data/', import.meta.url));

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
