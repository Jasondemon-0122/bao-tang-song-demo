require('dotenv').config(); 
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const helmet = require('helmet');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '20mb' })); 
app.use(express.urlencoded({ limit: '20mb', extended: true }));

const upload = multer({ 
    dest: 'temp/',
    limits: { fileSize: 30 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'video' && file.mimetype !== 'video/mp4') {
            return cb(new Error('Sai định dạng! Chỉ được nộp video MP4.'));
        }
        if (file.fieldname === 'image' && !file.mimetype.startsWith('image/')) {
            return cb(new Error('Sai định dạng! Chỉ được nộp file ảnh.'));
        }
        if (file.fieldname === 'model') {
            const ext = path.extname(file.originalname).toLowerCase();
            if (ext !== '.glb' && ext !== '.gltf') {
                return cb(new Error('Chỉ chấp nhận mô hình 3D định dạng .glb hoặc .gltf'));
            }
        }
        cb(null, true); 
    }
});

app.use('/mindar', express.static(path.join(__dirname, 'node_modules/mind-ar/dist')));
app.use(express.static('public'));
app.use('/data', express.static('data'));

const sanitizeText = (str) => {
    if (!str || typeof str !== 'string') return '';
    return str.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
};

app.post('/api/nop-bai', upload.fields([{ name: 'image' }, { name: 'video' }, { name: 'model' }, { name: 'mind' }]), async (req, res, next) => {
    try {
        let rawTenNhom = sanitizeText(req.body.tenNhom);
        let tenNhom = rawTenNhom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_');
        if (!tenNhom) tenNhom = "Hoc_Sinh_An_Danh";
        if (tenNhom.length > 50) tenNhom = tenNhom.substring(0, 50);

        const dirPath = path.join(__dirname, 'data', tenNhom);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

        // 1. LUÔN LUÔN CÓ ẢNH VÀ FILE MIND
        const imgUpload = await cloudinary.uploader.upload(req.files['image'][0].path, { folder: "bao-tang-song" });
        fs.renameSync(req.files['mind'][0].path, path.join(dirPath, 'targets.mind'));
        fs.unlinkSync(req.files['image'][0].path);

        // 2. VIDEO (NẾU CÓ THÌ MỚI UP)
        let vidUrl = "";
        if (req.files['video'] && req.files['video'][0]) {
            const vidUpload = await cloudinary.uploader.upload(req.files['video'][0].path, { folder: "bao-tang-song", resource_type: "video" });
            vidUrl = vidUpload.secure_url;
            fs.unlinkSync(req.files['video'][0].path);
        }

        // 3. MÔ HÌNH 3D (GIẢI QUYẾT LỖI N/A: ÉP GẮN ĐUÔI .glb)
        let modelUrl = "";
        if (req.files['model'] && req.files['model'][0]) {
            const modelFile = req.files['model'][0];
            // Lấy đuôi từ file gốc, nếu mất thì tự động gán .glb
            let ext = path.extname(modelFile.originalname).toLowerCase(); 
            if (ext !== '.glb' && ext !== '.gltf') ext = '.glb';
            
            const newPath = modelFile.path + ext; 
            fs.renameSync(modelFile.path, newPath); // Gắn đuôi vào file nháp
            
            // Upload lên Cloudinary dạng Raw
            const modelUpload = await cloudinary.uploader.upload(newPath, { folder: "bao-tang-song", resource_type: "raw" });
            modelUrl = modelUpload.secure_url;
            fs.unlinkSync(newPath); // Xóa file nháp
        }

        const links = { 
            image: imgUpload.secure_url, 
            video: vidUrl, // Có thể rỗng
            model: modelUrl, // Có thể rỗng
            hs1Title: sanitizeText(req.body.hs1Title) || "Góc Giải Nghĩa",
            hs1Content: sanitizeText(req.body.hs1Content) || "Chưa có thông tin",
            hs2Title: sanitizeText(req.body.hs2Title) || "Bí mật Lịch sử",
            hs2Content: sanitizeText(req.body.hs2Content) || "Chưa có thông tin"
        };
        fs.writeFileSync(path.join(dirPath, 'links.json'), JSON.stringify(links));

        res.json({ success: true, message: 'Dữ liệu đã được kiểm duyệt và lưu trữ an toàn!' });

    } catch (error) {
        next(error); 
    }
});

app.get('/api/danh-sach', (req, res) => {
    const dataPath = path.join(__dirname, 'data');
    if (!fs.existsSync(dataPath)) return res.json([]);
    const students = [];
    const dirs = fs.readdirSync(dataPath).filter(f => fs.statSync(path.join(dataPath, f)).isDirectory());
    dirs.forEach(dir => {
        const linkFile = path.join(dataPath, dir, 'links.json');
        if(fs.existsSync(linkFile)) {
            const links = JSON.parse(fs.readFileSync(linkFile));
            students.push({ name: dir, image: links.image });
        }
    });
    res.json(students);
});

app.use((err, req, res, next) => {
    console.error("Lỗi hệ thống Middleware:", err);
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Lỗi: Có file vượt quá mức trần 30MB!' });
    }
    res.status(500).json({ success: false, message: err.message || "Lỗi máy chủ nội bộ. Vui lòng thử lại!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server Bảo Mật đang chạy tại cổng ${PORT}`);
});