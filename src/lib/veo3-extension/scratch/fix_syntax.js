/* eslint-disable */
const fs = require('fs');
const file = 'c:\\Users\\admin\\OneDrive\\Pictures\\Screenshots\\Extension\\Veo3PipelineController.js';
let data = fs.readFileSync(file, 'utf8').split(/\r?\n/);
let found = false;
for (let i = 0; i < data.length; i++) {
    if (data[i].includes('ID.")')) {
        data[i] = '                            throw new Error("Thiếu veo3Id trong dữ liệu ảnh. Vui lòng tạo lại nhân vật bằng công cụ AI để đồng bộ ID.");';
        found = true;
    }
    if (data[i].includes('veo3Id).");')) {
        data[i] = '                    throw new Error("Đường dẫn ảnh không hợp lệ (Không phải dữ liệu JSON chứa veo3Id).");';
    }
}
if (found) {
    fs.writeFileSync(file, data.join('\n'), 'utf8');
    console.log("Fixed syntax error");
} else {
    console.log("Could not find the corrupted line");
}
