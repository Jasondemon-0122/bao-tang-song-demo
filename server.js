require('dotenv').config(); // Kích hoạt biến môi trường ẩn
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const helmet = require('helmet'); // Gọi khiên bảo mật

// --- KẾT NỐI BẰNG BIẾN MÔI TRƯỜNG AN TOÀN ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();

// --- 1. BỨC TƯỜNG LỬA (SECURITY MIDDLEWARES) ---
app.use(helmet({
    contentSecurityPolicy: false, // Tắt tính năng chặn mã nhúng nội bộ để chạy được MindAR và code Form
    crossOriginEmbedderPolicy: false // Cần thiết để A-Frame dựng không gian 3D
}));
app.use(express.json({ limit: '20mb' })); // Chặn ném văn bản rác quá lớn
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// --- 2. HẢI QUAN KIỂM DUYỆT FILE (MULTER) ---
const upload = multer({ 
    dest: 'temp/',
    limits: { 
        // Đổi số 15 thành 30 (nghĩa là 30MB), hoặc 50 (50MB)
        fileSize: 30 * 1024 * 1024 
    },
    fileFilter: (req, file, cb) => {
        // Chỉ cho phép Video MP4 và Ảnh gốc, chặn file hack (.exe, .php, v.v)
        if (file.fieldname === 'video' && file.mimetype !== 'video/mp4') {
            return cb(new Error('Sai định dạng! Chỉ được nộp video MP4.'));
        }
        if (file.fieldname === 'image' && !file.mimetype.startsWith('image/')) {
            return cb(new Error('Sai định dạng! Chỉ được nộp file ảnh.'));
        }
        cb(null, true); // Cho qua nếu hợp lệ
    }
});

app.use('/mindar', express.static(path.join(__dirname, 'node_modules/mind-ar/dist')));
app.use(express.static('public'));
app.use('/data', express.static('data'));

// --- 3. MÁY LỌC MÃ ĐỘC (XSS SANITIZER) ---
const sanitizeText = (str) => {
    if (!str || typeof str !== 'string') return '';
    // Biến các ký tự nhạy cảm thành mã an toàn (Vô hiệu hóa thẻ <script>)
    return str.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
};

// API Nhận bài nộp (Đã bọc thép)
app.post('/api/nop-bai', upload.fields([{ name: 'image' }, { name: 'video' }, { name: 'mind' }]), async (req, res) => {
    try {
        // Vệ sinh Tên nhóm (Chống Path Traversal hack đường dẫn thư mục)
        let rawTenNhom = sanitizeText(req.body.tenNhom);
        let tenNhom = rawTenNhom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_');
        
        // Cắt ngắn nếu nhập quá dài
        if (!tenNhom) tenNhom = "Hoc_Sinh_An_Danh";
        if (tenNhom.length > 50) tenNhom = tenNhom.substring(0, 50);

        const dirPath = path.join(__dirname, 'data', tenNhom);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

        // Gửi Ảnh và Video lên Cloudinary
        const imgUpload = await cloudinary.uploader.upload(req.files['image'][0].path, { folder: "bao-tang-song" });
        const vidUpload = await cloudinary.uploader.upload(req.files['video'][0].path, { folder: "bao-tang-song", resource_type: "video" });

        // Giữ file nhận diện AR .mind lại
        fs.renameSync(req.files['mind'][0].path, path.join(dirPath, 'targets.mind'));

        // LƯU Ý KỸ: Vệ sinh toàn bộ Text trước khi lưu vào JSON
        const links = { 
            image: imgUpload.secure_url, 
            video: vidUpload.secure_url,
            hs1Title: sanitizeText(req.body.hs1Title) || "Góc Giải Nghĩa",
            hs1Content: sanitizeText(req.body.hs1Content) || "Chưa có thông tin",
            hs2Title: sanitizeText(req.body.hs2Title) || "Bí mật Lịch sử",
            hs2Content: sanitizeText(req.body.hs2Content) || "Chưa có thông tin"
        };
        fs.writeFileSync(path.join(dirPath, 'links.json'), JSON.stringify(links));

        // Dọn dẹp RAM máy chủ
        fs.unlinkSync(req.files['image'][0].path);
        fs.unlinkSync(req.files['video'][0].path);

        res.json({ success: true, message: 'Dữ liệu đã được kiểm duyệt và lưu trữ an toàn!' });

    } catch (error) {
        console.error("Báo động hệ thống:", error.message);
        
        // Nếu file bị khóa bởi Multer do quá 15MB
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'Lỗi: Có file vượt quá mức trần 15MB!' });
        }
        
        // Các lỗi định dạng file hoặc Cloudinary
        res.status(400).json({ success: false, message: error.message || 'Lỗi từ chối lưu file.' });
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
            students.push({ name: dir, image: links.image });
        }
    });
    res.json(students);
});
// --- LƯỚI HỨNG LỖI HỆ THỐNG (BẮT BUỘC ĐỂ TRÁNH TRẢ VỀ HTML) ---
app.use((err, req, res, next) => {
    console.error("Lỗi hệ thống Middleware:", err);
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Lỗi: Có file vượt quá mức trần!' });
    }
    res.status(500).json({ success: false, message: err.message || "Lỗi máy chủ nội bộ. Vui lòng thử lại!" });
});

// Chạy máy chủ (ĐOẠN NÀY CHỈ ĐƯỢC XUẤT HIỆN 1 LẦN DUY NHẤT DƯỚI ĐÁY FILE)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server Bảo Mật đang chạy tại cổng ${PORT}`);
    console.log('☁️ Đã nạp chìa khóa Cloudinary từ biến môi trường!');
});