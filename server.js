const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

// --- ĐIỀN 3 CHÌA KHÓA CLOUDINARY CỦA BẠN VÀO ĐÂY ---
cloudinary.config({
    cloud_name: 'dsrd0bylc',
    api_key: '343291657262945',
    api_secret: '9ICn7uAjxyng00JAa_W46i7_DJE'
});

const app = express();
const upload = multer({ dest: 'temp/' });

app.use('/mindar', express.static(path.join(__dirname, 'node_modules/mind-ar/dist')));
app.use(express.static('public'));
app.use('/data', express.static('data'));

// API Nhận bài nộp (Đã nâng cấp nhận file 3D .glb)
app.post('/api/nop-bai', upload.fields([{ name: 'image' }, { name: 'model3d' }, { name: 'mind' }]), async (req, res) => {
    try {
        let tenNhom = req.body.tenNhom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_');
        if (!tenNhom) tenNhom = "Hoc_Sinh_An_Danh";

        const dirPath = path.join(__dirname, 'data', tenNhom);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

        // 1. Gửi Ảnh lên Cloudinary
        const imgUpload = await cloudinary.uploader.upload(req.files['image'][0].path, { folder: "bao-tang-song" });
        
        // 2. Gửi Mô hình 3D (.glb) lên Cloudinary dưới dạng 'raw'
        let model3dUrl = null;
        if (req.files['model3d']) {
            const modelUpload = await cloudinary.uploader.upload(req.files['model3d'][0].path, { folder: "bao-tang-song", resource_type: "raw" });
            model3dUrl = modelUpload.secure_url;
            fs.unlinkSync(req.files['model3d'][0].path); // Xóa rác
        }

        // 3. Giữ file nhận diện AR .mind lại máy chủ
        fs.renameSync(req.files['mind'][0].path, path.join(dirPath, 'targets.mind'));

        // 4. Lưu địa chỉ (link) của ảnh và mô hình 3D
        const links = { image: imgUpload.secure_url, model3d: model3dUrl };
        fs.writeFileSync(path.join(dirPath, 'links.json'), JSON.stringify(links));

        // 5. Xóa rác ảnh
        fs.unlinkSync(req.files['image'][0].path);

        res.json({ success: true, message: 'Tạo bản sao AR và lưu trữ Đám mây thành công!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lỗi lưu file.' });
    }
});

// API Lấy danh sách hiển thị
app.get('/api/danh-sach', (req, res) => {
    const dataPath = path.join(__dirname, 'data');
    if (!fs.existsSync(dataPath)) return res.json([]);
    
    const students = [];
    const dirs = fs.readdirSync(dataPath).filter(f => fs.statSync(path.join(dataPath, f)).isDirectory());
    
    dirs.forEach(dir => {
        const linkFile = path.join(dataPath, dir, 'links.json');
        if(fs.existsSync(linkFile)) {
            const links = JSON.parse(fs.readFileSync(linkFile));
            students.push({ name: dir, image: links.image, model3d: links.model3d });
        }
    });
    res.json(students);
});

// Cho phép Render tự động chọn cổng (PORT)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server đang chạy tại cổng ${PORT}`);
    console.log('☁️ Đã kết nối với kho lưu trữ Cloudinary!');
});