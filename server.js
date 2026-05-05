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

// --- 2. CẤU HÌNH CƠ SỞ DỮ LIỆU MONGODB (Đã chèn chuẩn mã của bạn) ---
const mongoUri = "mongodb+srv://Admin:Lehuy2005%40@cluster0.merrmad.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(mongoUri);
let db;
client.connect().then(() => {
    db = client.db("BaoTangSong");
    console.log("✅ Đã kết nối với sổ ghi chép MongoDB!");
}).catch(err => console.error("Lỗi MongoDB:", err));

// --- 3. CẤU HÌNH DANH SÁCH LỚP & MẬT KHẨU GIÁO VIÊN ---
const LOP_HOC = {
    "11A1": "mk11a1",
    "11A2": "mk11a2",
    "11A3": "mk11a3"
};
const ADMIN_PASS = "giaovien123"; // Mật khẩu quyền lực nhất của bạn

const app = express();
const upload = multer({ dest: 'temp/' });
app.use(express.json()); // Hỗ trợ đọc dữ liệu JSON
app.use('/mindar', express.static(path.join(__dirname, 'node_modules/mind-ar/dist')));
app.use(express.static('public'));

// --- API 1: HỌC SINH NỘP BÀI ---
app.post('/api/nop-bai', upload.fields([{ name: 'image' }, { name: 'video' }, { name: 'mind' }]), async (req, res) => {
    try {
        const { lop, tenNhom } = req.body;
        if (!LOP_HOC[lop]) return res.status(400).json({ success: false, message: 'Lớp không tồn tại!' });

        // Đẩy toàn bộ 3 file lên mây (File .mind tải dạng 'raw' để lưu trữ vĩnh viễn)
        const imgUpload = await cloudinary.uploader.upload(req.files['image'][0].path, { folder: `bao-tang-song/${lop}` });
        const vidUpload = await cloudinary.uploader.upload(req.files['video'][0].path, { folder: `bao-tang-song/${lop}`, resource_type: "video" });
        const mindUpload = await cloudinary.uploader.upload(req.files['mind'][0].path, { folder: `bao-tang-song/${lop}`, resource_type: "raw" });

        // Ghi thông tin bài nộp vào sổ MongoDB
        await db.collection("submissions").insertOne({
            lop: lop,
            tenNhom: tenNhom || "Ẩn danh",
            image: imgUpload.secure_url,
            video: vidUpload.secure_url,
            mind: mindUpload.secure_url, // Link AR giờ đã nằm trên mây
            ngayNop: new Date()
        });

        // Dọn dẹp máy chủ Render
        fs.unlinkSync(req.files['image'][0].path);
        fs.unlinkSync(req.files['video'][0].path);
        fs.unlinkSync(req.files['mind'][0].path);

        res.json({ success: true, message: 'Nộp bài thành công!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lỗi khi lưu bài.' });
    }
});

// --- API 2: PHÒNG TRIỂN LÃM (Cần mật khẩu của lớp) ---
app.post('/api/trien-lam', async (req, res) => {
    const { lop, password } = req.body;
    if (LOP_HOC[lop] && LOP_HOC[lop] === password) {
        // Lọc ra các bài của đúng lớp đó
        const data = await db.collection("submissions").find({ lop: lop }).toArray();
        res.json({ success: true, data: data });
    } else {
        res.json({ success: false, message: 'Sai mật khẩu lớp!' });
    }
});

// --- API 3: TRANG ADMIN CỦA GIÁO VIÊN (Cần mật khẩu Admin) ---
app.post('/api/admin', async (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASS) {
        // Lấy tất cả bài nộp, sắp xếp theo lớp
        const data = await db.collection("submissions").find({}).sort({lop: 1}).toArray();
        res.json({ success: true, data: data });
    } else {
        res.json({ success: false, message: 'Sai mật khẩu Giáo viên!' });
    }
});

app.listen(3000, () => {
    console.log('✅ Server đang chạy tại http://localhost:3000');
});