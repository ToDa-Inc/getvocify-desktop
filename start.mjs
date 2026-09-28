import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));

if (process.platform === 'darwin') {
  const script = path.join(root, 'scripts', 'dev-desktop.sh');
  const child = spawn('bash', [script], { stdio: 'inherit', cwd: root });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  console.error('On Mac, Vocify is apps/macos/Vocify.app — run: ./scripts/dev-desktop.sh');
  console.error('Electron legacy was removed from npm start.');
  process.exit(1);
}
