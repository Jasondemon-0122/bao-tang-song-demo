require('dotenv').config(); 
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const helmet = require('helmet');
const archiver = require('archiver'); 
const https = require('https');
const mongoose = require('mongoose'); // THÊM THƯ VIỆN CƠ SỞ DỮ LIỆU

// --- 1. KẾT NỐI DATABASE MONGODB VĨNH VIỄN ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✨ Đã kết nối Cơ sở dữ liệu MongoDB vĩnh viễn!"))
    .catch(err => console.error("❌ Lỗi kết nối DB:", err));

// --- 2. TẠO CẤU TRÚC "SỔ CÁI" CHO BÀI NỘP ---
const SubmissionSchema = new mongoose.Schema({
    tenNhom: String,
    image: String,
    video: String,
    model: String,
    mindFile: String, // Lưu link file nhận diện AR trên Cloudinary
    hs1Title: String,
    hs1Content: String,
    hs2Title: String,
    hs2Content: String,
    createdAt: { type: Date, default: Date.now }
});
const Submission = mongoose.model('Submission', SubmissionSchema);

// --- 3. CẤU HÌNH CLOUDINARY ---
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
            if (ext !== '.glb') {
                return cb(new Error('Chỉ chấp nhận mô hình 3D định dạng .glb (Khuyến khích để tối ưu dung lượng)'));
            }
        }
        cb(null, true); 
    }
});

app.use('/mindar', express.static(path.join(__dirname, 'node_modules/mind-ar/dist')));
app.use(express.static('public'));

const sanitizeText = (str) => {
    if (!str || typeof str !== 'string') return '';
    return str.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
};

// --- API 1: NỘP BÀI (ĐẨY LÊN CLOUD VÀ LƯU MONGO) ---
app.post('/api/nop-bai', upload.fields([{ name: 'image' }, { name: 'video' }, { name: 'model' }, { name: 'mind' }]), async (req, res, next) => {
    try {
        let rawTenNhom = sanitizeText(req.body.tenNhom);
        let tenNhom = rawTenNhom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_');
        if (!tenNhom) tenNhom = "Hoc_Sinh_An_Danh";
        if (tenNhom.length > 50) tenNhom = tenNhom.substring(0, 50);

        // Upload Ảnh
        const imgUpload = await cloudinary.uploader.upload(req.files['image'][0].path, { folder: "bao-tang-song" });
        
        // Upload file .mind (Nhận diện AR) lên mây thay vì lưu máy chủ
        const mindUpload = await cloudinary.uploader.upload(req.files['mind'][0].path, { 
            folder: "bao-tang-song/mind_files", 
            resource_type: "raw",
            public_id: `${tenNhom}_targets_${Date.now()}` // Thêm Date để chống trùng lặp
        });

        fs.unlinkSync(req.files['image'][0].path);
        fs.unlinkSync(req.files['mind'][0].path);

        let vidUrl = "";
        if (req.files['video'] && req.files['video'][0]) {
            const vidUpload = await cloudinary.uploader.upload(req.files['video'][0].path, { folder: "bao-tang-song", resource_type: "video" });
            vidUrl = vidUpload.secure_url;
            fs.unlinkSync(req.files['video'][0].path);
        }

        let modelUrl = "";
        if (req.files['model'] && req.files['model'][0]) {
            const modelFile = req.files['model'][0];
            const ext = '.glb'; 
            const newPath = modelFile.path + ext; 
            fs.renameSync(modelFile.path, newPath); 
            const modelUpload = await cloudinary.uploader.upload(newPath, { folder: "bao-tang-song", resource_type: "raw" });
            modelUrl = modelUpload.secure_url;
            fs.unlinkSync(newPath); 
        }

        // Lưu thông tin vào Database MongoDB (Nếu nhóm đã nộp rồi thì cập nhật đè lên)
        const submissionData = {
            tenNhom: tenNhom,
            image: imgUpload.secure_url,
            video: vidUrl,
            model: modelUrl,
            mindFile: mindUpload.secure_url,
            hs1Title: sanitizeText(req.body.hs1Title) || "Góc Giải Nghĩa",
            hs1Content: sanitizeText(req.body.hs1Content) || "Chưa có thông tin",
            hs2Title: sanitizeText(req.body.hs2Title) || "Bí mật Lịch sử",
            hs2Content: sanitizeText(req.body.hs2Content) || "Chưa có thông tin",
            createdAt: Date.now()
        };

        await Submission.findOneAndUpdate({ tenNhom: tenNhom }, submissionData, { upsert: true, new: true });

        res.json({ success: true, message: 'Dữ liệu đã được lưu vĩnh viễn trên Đám mây và Database!' });

    } catch (error) {
        next(error); 
    }
});

// --- API 2: LẤY DANH SÁCH (ĐỌC TỪ MONGO) ---
app.get('/api/danh-sach', async (req, res) => {
    try {
        const submissions = await Submission.find().sort({ createdAt: -1 }); // Mới nhất xếp trước
        const students = submissions.map(s => ({ name: s.tenNhom, image: s.image }));
        res.json(students);
    } catch (error) {
        console.error("Lỗi lấy danh sách:", error);
        res.json([]);
    }
});

// --- API MỚI: LẤY CHI TIẾT CHO MÁY CHIẾU AR ---
app.get('/api/chi-tiet/:id', async (req, res) => {
    try {
        const data = await Submission.findOne({ tenNhom: req.params.id });
        if (!data) return res.status(404).json({ error: "Không tìm thấy dữ liệu nhóm này!" });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Lỗi máy chủ!" });
    }
});

// --- API 3: TẢI ZIP (GOM TỪ MÂY XUỐNG) ---
app.get('/api/tai-du-lieu', async (req, res) => {
    const matKhauNhapVao = req.query.pass;
    const tenNhom = req.query.nhom; 
    const matKhauGiaoVien = process.env.ADMIN_PASS || 'GiaoVien123'; 

    if (matKhauNhapVao !== matKhauGiaoVien) {
        return res.status(401).send('<h1>❌ Sai mật khẩu! Bạn không có quyền tải file.</h1>');
    }

    let zipName = 'Toan_Bo_Du_Lieu_Bao_Tang.zip';
    let query = {};
    if (tenNhom) {
        zipName = `Bai_Tap_${tenNhom}.zip`;
        query = { tenNhom: tenNhom };
    }

    const items = await Submission.find(query);

    if (items.length === 0) {
        return res.status(404).send('<h1>Không tìm thấy dữ liệu!</h1>');
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${zipName}`);

    let archive;
    if (typeof archiver === 'function') {
        archive = archiver('zip', { zlib: { level: 0 } });
    } else {
        archive = archiver.create('zip', { zlib: { level: 0 } });
    }

    archive.on('error', (err) => { 
        console.error("Lỗi nén file:", err);
        if (!res.headersSent) res.status(500).send('<h1>Lỗi hệ thống khi tạo file ZIP.</h1>');
    });
    
    archive.pipe(res);

    const appendUrlToZip = (url, zipPath) => {
        return new Promise((resolve) => {
            if (!url || url.trim() === "") return resolve();
            https.get(url, (response) => {
                if (response.statusCode === 200) {
                    archive.append(response, { name: zipPath });
                }
                resolve();
            }).on('error', (err) => {
                console.error("Lỗi tải file từ đám mây:", err);
                resolve(); 
            });
        });
    };

    for (const item of items) {
        const folder = item.tenNhom;
        // Tạo file JSON chứa chữ
        const infoJson = JSON.stringify(item, null, 2);
        archive.append(infoJson, { name: `${folder}/thong_tin_hotspot.json` });
        
        // Kéo file từ mây xuống Zip
        await appendUrlToZip(item.mindFile, `${folder}/nhan_dien_ar.mind`);
        await appendUrlToZip(item.image, `${folder}/anh_poster.jpg`);
        if (item.video) await appendUrlToZip(item.video, `${folder}/video_thuyet_minh.mp4`);
        if (item.model) await appendUrlToZip(item.model, `${folder}/mo_hinh_3d.glb`);
    }

    archive.finalize();
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