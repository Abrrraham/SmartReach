import fs from 'fs';
import path from 'path';

const args = new Set(process.argv.slice(2));
const wantsHelp = args.has('--help') || args.has('-h');
const useAll = args.has('--all');
const useCache = args.has('--cache') || !useAll;

if (wantsHelp) {
  console.log('Usage: node scripts/clean.mjs [--cache|--all]');
  console.log('  --cache  Remove build/cache artifacts (default)');
  console.log('  --all    Remove cache artifacts and node_modules');
  process.exit(0);
}

const root = process.cwd();
const cacheTargets = [
  '.cache/vite',
  'node_modules/.vite',
  '.vite',
  'dist'
];
const allTargets = useAll ? [...cacheTargets, 'node_modules'] : cacheTargets;

function removePath(relativePath) {
  const target = path.resolve(root, relativePath);
  const label = path.relative(root, target) || relativePath;
  const existed = fs.existsSync(target);

  fs.rmSync(target, { recursive: true, force: true });

  if (existed) {
    console.log(`[clean] removed ${label}`);
  } else {
    console.log(`[clean] skip missing ${label}`);
  }
}

if (useCache) {
  allTargets.forEach(removePath);
}
