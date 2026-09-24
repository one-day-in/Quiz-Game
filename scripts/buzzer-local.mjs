import { spawn } from 'node:child_process';
import path from 'node:path';
import { getLocalSupabaseCredentials, projectRoot } from './local-supabase-env.mjs';

const { url, serviceRoleKey } = getLocalSupabaseCredentials();
const serverEntry = path.join(projectRoot, 'server', 'buzzerServer.js');
const child = spawn(process.execPath, [serverEntry], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    BUZZER_PORT: process.env.BUZZER_PORT || '8787',
  },
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
