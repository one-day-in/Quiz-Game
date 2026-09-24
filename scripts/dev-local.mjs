import { spawn } from 'node:child_process';
import path from 'node:path';
import { getLocalSupabaseCredentials, projectRoot } from './local-supabase-env.mjs';

const { url, anonKey } = getLocalSupabaseCredentials();
const viteBinary = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(process.execPath, [viteBinary, '--host', '127.0.0.1'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: anonKey,
    VITE_BUZZER_WS_URL: '',
  },
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
