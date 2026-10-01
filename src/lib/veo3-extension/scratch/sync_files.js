const fs = require('fs');
const path = require('path');

const srcDir = 'H:/laragon/www/anime/backend/src/veo3';
const destDir = 'H:/laragon/www/HARUMI/harumi-ai/src/lib/veo3-extension';

const files = [
  'worker.cjs',
  'browserPool.cjs',
  'cloakbrowser-updater.cjs',
  'configManager.cjs',
  'accountManager.cjs',
  'proxyManager.cjs',
  'encryption.cjs'
];

for (const f of files) {
  const srcPath = path.join(srcDir, f);
  if (fs.existsSync(srcPath)) {
    let content = fs.readFileSync(srcPath, 'utf8');
    // Replace .cjs internal requires with .js
    content = content.split('.cjs').join('.js');
    
    const targetName = f.replace('.cjs', '.js');
    const destPath = path.join(destDir, targetName);
    fs.writeFileSync(destPath, content, 'utf8');
    console.log(`Copied and transformed: ${f} -> ${targetName}`);
  } else {
    console.error(`File not found: ${srcPath}`);
  }
}
