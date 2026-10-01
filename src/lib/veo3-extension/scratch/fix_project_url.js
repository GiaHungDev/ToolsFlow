const fs = require('fs');

let content = fs.readFileSync('src/lib/veo3-extension/worker.js', 'utf8');

// Replace all occurrences of regex match for /flow/project/
content = content.replace(/match\(\/\\\/flow\\\/project\\\/\[\^\\\/\]\+\/\)/g, 'match(/\\/project\\/[^\\/]+/)');
content = content.replace(/includes\(['"]\/flow\/project\/['"]\)/g, "includes('/project/')");

// Replace labs.google domain checks to also support flow.google.com
content = content.replace(/currentUrl\.includes\('labs\.google'\)/g, "(currentUrl.includes('labs.google') || currentUrl.includes('flow.google.com'))");
content = content.replace(/!currentUrl\.includes\('labs\.google'\)/g, "(!currentUrl.includes('labs.google') && !currentUrl.includes('flow.google.com'))");
content = content.replace(/url\.includes\('labs\.google'\)/g, "(url.includes('labs.google') || url.includes('flow.google.com'))");
content = content.replace(/!url\.includes\('labs\.google'\)/g, "(!url.includes('labs.google') && !url.includes('flow.google.com'))");
content = content.replace(/loopUrl\.includes\('labs\.google'\)/g, "(loopUrl.includes('labs.google') || loopUrl.includes('flow.google.com'))");

fs.writeFileSync('src/lib/veo3-extension/worker.js', content, 'utf8');
console.log('Updated worker.js to support flow.google.com and /project/{id} URLs successfully!');
