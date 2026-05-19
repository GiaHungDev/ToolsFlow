const fs = require('fs');
let content = fs.readFileSync('Veo3PipelineController.js', 'utf8');

const replacements = [
    [/Khï¿½xi táº¡o/g, 'Khoi tao'],
    [/trï¿½nh duyï¿½!t/g, 'trinh duyet'],
    [/Sá» dá»¥ng/g, 'Su dung'],
    [/Tï¿½m tháº¥y/g, 'Tim thay'],
    [/ï¿½ang thiáº¿t láºp/g, 'dang thiet lap'],
    [/vï¿½o/g, 'vao'],
    [/Thiáº¿t láºp/g, 'Thiet lap'],
    [/thï¿½nh cï¿½ng/g, 'thanh cong'],
    [/Äï¿½ phï¿½ng to/g, 'Da phong to'],
    [/cá»a sï¿½"/g, 'cua so'],
    [/Kiá»’m tra tráº¡ng thï¿½i:/g, 'Kiem tra trang thai:'],
    [/CHÆ¯A Äï¿½␦NG NHáº¬P/g, 'CHUA DANG NHAP'],
    [/Chuáº©n bï¿½9 ï¿½Ä’ng nháºp tá»± ï¿½ï¿½"ng/g, 'Chuan bi dang nhap tu dong'],
    [/Äï¿½␦ Đï¿½␦NG NHáº¬P/g, 'DA DANG NHAP'],
    [/Bá» qua bï¿½Æ°á»›c ï¿½iá»’n máºt kháº©u/g, 'Bo qua buoc dien mat khau'],
    [/Báº¯t ï¿½Ä’u vï¿½ng láº·p/g, 'Bat dau vong lap'],
    [/Náº¡p/g, 'Nap'],
    [/Khï¿½ng/g, 'Khong'],
    [/Lá»—i/g, 'Loi'],
    [/Lï¿½u/g, 'Luu'],
    [/hoï¿½n thï¿½nh/g, 'hoan thanh'],
    [/trï¿½n mï¿½n hï¿½nh/g, 'tren man hinh'],
    [/Äï¿½ang F5 láº¡i trang/g, 'Dang F5 lai trang'],
    [/ï¿½ï¿½ng bï¿½"/g, 'dong bo'],
    [/cá»§a/g, 'cua'],
    [/Bï¿½/g, 'Bo'],
    [/áº£nh/g, 'anh']
];

for (const [regex, replacement] of replacements) {
    content = content.replace(regex, replacement);
}

fs.writeFileSync('Veo3PipelineController.js', content, 'utf8');
console.log('Fixed log strings');
