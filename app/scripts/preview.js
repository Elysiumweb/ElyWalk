/**
 * Shim de preview Emergent : le superviseur lance `yarn expo start --port 3000`.
 * Ce script ignore les arguments et démarre le serveur de dev Vite sur le port 3000.
 * (Le projet est une app Capacitor, pas Expo — ce fichier ne sert qu'à la preview cloud.)
 */
const { spawn } = require('child_process');
const path = require('path');

const vite = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(
  process.execPath,
  [vite, '--host', '0.0.0.0', '--port', '3000', '--strictPort'],
  { stdio: 'inherit', cwd: path.join(__dirname, '..') }
);
child.on('exit', (code) => process.exit(code == null ? 0 : code));
