import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readLocalSupabaseEnvironment() {
  const supabaseBinary = path.join(projectRoot, 'node_modules', '.bin', 'supabase');
  const output = execFileSync(supabaseBinary, ['status', '-o', 'env'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)="?(.*?)"?$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]])
  );
}

export function getLocalSupabaseCredentials() {
  const local = readLocalSupabaseEnvironment();
  const url = process.env.SUPABASE_URL || local.API_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || local.ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || local.SERVICE_ROLE_KEY;

  if (!url) throw new Error('Missing local Supabase API URL');
  if (!anonKey) throw new Error('Missing local Supabase anonymous key');
  if (!serviceRoleKey) throw new Error('Missing local Supabase service-role key');

  return { url, anonKey, serviceRoleKey };
}
