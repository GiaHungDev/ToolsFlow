/* eslint-disable */
const fs = require('fs');
let content = fs.readFileSync('Veo3PipelineController.js', 'utf8');

// Danh sách các từ bị lỗi phổ biến và từ thay thế (không dấu)
const map = {
    'táº£i l ï¿½n': 'tai len',
    'ChÆ°a tháº¥y': 'Chua thay',
    'n ï¿½t': 'nut',
    'ï¿½ á»£i th ï¿½m': 'doi them',
    'Kh ï¿½ng t ï¿½m tháº¥y': 'Khong tim thay',
    'ï¿½ á»’': 'de',
    'ï¿½  ï¿½nh k ï¿½m': 'dinh kem',
    'giá» ng n ï¿½i': 'giong noi',
    'gi ï¿½y': 'giay',
    'Dá»«ng': 'Dung',
    'T ï¿½m tháº¥y': 'Tim thay',
    'Th ï¿½m': 'Them',
    'Ä ang click táº¡i tá» a ï¿½ ï¿½"': 'Dang click tai toa do',
    'Tiáº¿n h ï¿½nh chá» n': 'Tien hanh chon',
    'nh ï¿½n váº­t tá»«': 'nhan vat tu',
    'báº±ng': 'bang',
    'Chá» ': 'Cho',
    'hï¿½"p thoáº¡i hiï¿½!n l ï¿½n': 'hop thoai hien len',
    'Táº£i thĂ nh cĂ´ng': 'Tai thanh cong',
    'D Ă¹ng cho': 'Dung cho',
    'Ảnh hoáº·c': 'Anh hoac',
    'nhá» ': 'nho',
    'trá»±c tiáº¿p': 'truc tiep',
    'chá»‘ng': 'chong',
    'ï¿½ Ä’nh k ï¿½m': 'dinh kem',
    'v ï¿½ng': 'vung',
    'ï¿½ nháº­p lï¿½!nh': 'nhap lenh',
    'c ï¿½ch khoanh': 'cach khoanh',
    'Chuyá»’n sang luï¿½ ng giáº£ láº­p': 'Chuyen sang luong gia lap',
    'Báº¯t ï¿½ áº§u': 'Bat dau',
    'ThÆ° viï¿½!n': 'Thu vien',
    'ï¿½ï¿½"ng': 'dong',
    'ï¿½Ä’ng': 'dang',
    'ï¿½iá»’n': 'dien',
    'vï¿½ng láº·p': 'vong lap',
    'hoï¿½n thï¿½nh': 'hoan thanh',
    'trï¿½n mï¿½n hï¿½nh': 'tren man hinh',
    'Äï¿½ang F5 láº¡i trang': 'Dang F5 lai trang',
    'Äï¿½␦ Đï¿½␦NG NHáº¬P': 'DA DANG NHAP',
    'CHÆ¯A Äï¿½␦NG NHáº¬P': 'CHUA DANG NHAP',
    'Kiá»’m tra tráº¡ng thï¿½i': 'Kiem tra trang thai',
    'cá»a sï¿½"': 'cua so',
    'Äï¿½ phï¿½ng to': 'Da phong to',
    'thï¿½nh cï¿½ng': 'thanh cong',
    'Thiáº¿t láºp': 'Thiet lap',
    'ï¿½ang thiáº¿t láºp': 'dang thiet lap',
    'vï¿½o': 'vao',
    'Tï¿½m tháº¥y': 'Tim thay',
    'Sá» dá»¥ng': 'Su dung',
    'trï¿½nh duyï¿½!t': 'trinh duyet',
    'Khï¿½xi táº¡o': 'Khoi tao',
    'Bï¿½': 'Bo',
    'cá»§a': 'cua',
    'ï¿½ï¿½ng bï¿½"': 'dong bo',
    'áº£nh': 'anh',
    'Lï¿½u': 'Luu',
    'Lá»—i': 'Loi',
    'Khï¿½ng': 'Khong',
    'Náº¡p': 'Nap',
    'Cï¿½': 'Co',
    'thá»ƒ': 'the',
    'bá»‹': 'bi',
    'quáº£n': 'quan',
    'lï¿½': 'ly'
};

for (const [bad, good] of Object.entries(map)) {
    const regex = new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    content = content.replace(regex, good);
}

// Chạy thêm 1 vòng để dọn các ký tự rác đơn lẻ còn sót
content = content.replace(/[ï¿½áº¡áº¥áº§áº©áº«áº­áº¯áº±áº³áºµáº·áº¹áº»áº½áº¿á»á»ƒá»…á»‡á»‰á»‹á»á»á»‘á»“á»•á»—á»™á»›á»á»Ÿá»¡á»£á»¥á»§á»©á»«á»­á»¯á»±á»³á»µá»·á»¹Ă Ă´Æ°Æ¯]/g, '');

fs.writeFileSync('Veo3PipelineController.js', content, 'utf8');
console.log('Finished deep cleaning');
