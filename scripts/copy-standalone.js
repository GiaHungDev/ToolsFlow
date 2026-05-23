const fs = require('fs-extra');
const path = require('path');

async function copyAssets() {
    console.log('Copying static assets to standalone folder...');
    
    const standaloneDir = path.join(__dirname, '../.next/standalone');
    const staticDir = path.join(__dirname, '../.next/static');
    const publicDir = path.join(__dirname, '../public');

    const destStatic = path.join(standaloneDir, '.next/static');
    const destPublic = path.join(standaloneDir, 'public');

    try {
        if (fs.existsSync(staticDir)) {
            await fs.copy(staticDir, destStatic);
            console.log('Copied .next/static');
        }
        
        if (fs.existsSync(publicDir)) {
            await fs.copy(publicDir, destPublic);
            console.log('Copied public');
        }
        
        console.log('Standalone build is ready for Electron packaging!');
    } catch (err) {
        console.error('Error copying assets:', err);
        process.exit(1);
    }
}

copyAssets();
