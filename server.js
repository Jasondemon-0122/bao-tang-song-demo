const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path'); // Đảm bảo đã có dòng này

const app = express();
const upload = multer({ dest: 'temp/' });

// 1. CHỈ ĐỊNH ĐƯỜNG DẪN THƯ VIỆN (Quan trọng nhất)
// Dòng này giúp trình duyệt tìm thấy file trong node_modules khi gọi /mindar/...
app.use('/mindar', express.static(path.join(__dirname, 'node_modules/mind-ar/dist')));

// 2. CHỈ ĐỊNH CÁC THƯ MỤC CÒN LẠI
app.use(express.static('public'));
app.use('/data', express.static('data'));

// API Nhận bài nộp
app.post('/api/nop-bai', upload.fields([{ name: 'image' }, { name: 'video' }, { name: 'mind' }]), (req, res) => {
    try {
        let tenNhom = req.body.tenNhom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_');
        if (!tenNhom) tenNhom = "Hoc_Sinh_An_Danh";

        const dirPath = path.join(__dirname, 'data', tenNhom);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

        fs.renameSync(req.files['image'][0].path, path.join(dirPath, 'image.jpg'));
        fs.renameSync(req.files['video'][0].path, path.join(dirPath, 'video.mp4'));
        fs.renameSync(req.files['mind'][0].path, path.join(dirPath, 'targets.mind'));

        res.json({ success: true, message: 'Nộp bài thành công!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lỗi lưu file.' });
    }
});

// API Lấy danh sách
app.get('/api/danh-sach', (req, res) => {
    const dataPath = path.join(__dirname, 'data');
    if (!fs.existsSync(dataPath)) return res.json([]);
    const dirs = fs.readdirSync(dataPath).filter(f => fs.statSync(path.join(dataPath, f)).isDirectory());
    res.json(dirs);
});

app.listen(3000, () => {
    console.log('✅ Server đang chạy tại http://localhost:3000');
    console.log('🚀 Đã kích hoạt đường dẫn thư viện: /mindar');
});