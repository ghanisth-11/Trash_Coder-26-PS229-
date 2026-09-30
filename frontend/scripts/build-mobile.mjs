import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiBaseUrl = process.env.MOBILE_API_BASE_URL ?? 'https://trash-coder-26-ps229.onrender.com';
const nextCli = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));

const child = spawn(process.execPath, [nextCli, 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: apiBaseUrl },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
