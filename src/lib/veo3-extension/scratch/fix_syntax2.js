const fs = require('fs');
let data = fs.readFileSync('Veo3PipelineController.js', 'utf8').split(/\r?\n/);
data[1101] = '        this.log(`Bat dau chon ${veo3Ids.length} anh nhan vat tu Thu vien (Gallery) cho mode IN2V/I2V...`);';
fs.writeFileSync('Veo3PipelineController.js', data.join('\n'), 'utf8');
console.log('Fixed line 1102');
