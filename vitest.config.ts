import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Тот же список непустых JSON, что next.config.js кладёт в DATA_FILES_AVAILABLE
// при сборке — subjectCatalog читает его из env.
function availableDataFiles(): string {
  const dir = path.join(__dirname, 'src', 'data');
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .filter(name => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        return Array.isArray(data) ? data.length > 0 : !!data && Object.keys(data).length > 0;
      } catch {
        return false;
      }
    })
    .join(',');
}

export default defineConfig({
  resolve: {
    alias: { '@': path.join(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: { DATA_FILES_AVAILABLE: availableDataFiles() },
  },
});
