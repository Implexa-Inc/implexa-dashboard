// node --test "app/(dashboard)/runs/[id]/manager-scaffold-redirect.test.ts"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'app/(dashboard)/runs/[id]/page.tsx'), 'utf8');

test('manager execution permalinks resolve to their canonical worker target', () => {
  assert.match(page, /\.eq\('run_id', r\.id\)/);
  assert.match(page, /\.in\('kind', \['judge', 'recover'\]\)/);
  assert.match(page, /managerRequest\?\.kind === 'judge'[\s\S]*judge_target_run_id/);
  assert.match(page, /managerRequest\?\.kind === 'recover'[\s\S]*recovery_target_run_id/);
  assert.match(page, /managerTarget && managerTarget !== r\.id/);
});
