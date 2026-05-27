const fs = require('fs-extra');
const path = require('path');

exports.default = async function(context) {
    const { appOutDir } = context;
    // appOutDir is the path to the unpacked application (e.g. dist_electron/win-unpacked)
    
    const sourceNodeModules = path.join(context.packager.projectDir, '.next/standalone/node_modules');
    const destNodeModules = path.join(appOutDir, 'resources', '.next', 'standalone', 'node_modules');

    try {
        if (await fs.pathExists(sourceNodeModules)) {
            console.log('\n=======================================');
            console.log('  afterPack: Copying standalone node_modules...');
            console.log('  From:', sourceNodeModules);
            console.log('  To:  ', destNodeModules);
            console.log('=======================================\n');
            await fs.copy(sourceNodeModules, destNodeModules);
        } else {
            console.log('\n[afterPack] Warning: source node_modules not found at', sourceNodeModules);
        }
    } catch (err) {
        console.error('\n[afterPack] Error copying node_modules:', err);
    }
};
