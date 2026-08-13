#!/usr/bin/env node
import { main } from './smoke-production-release.mjs';

const values = process.argv.slice(2);
if (!values.includes('--cleanup-only')) values.push('--cleanup-only');
main(values).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
