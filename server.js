const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Cache kết quả xổ số - Chỉ XSHCM
let lotteryCache = {
    hcm: null,
    hcmLastUpdate: null
};

const CACHE_DURATION = 2 * 60 * 1000; // 2 phút

// ==================== PARSER CHO TỪNG NGUỒN ====================

// Parser chính xác cho xskt.com.vn - CHỈ XSHCM
// Cấu trúc HTML thực tế:
// <tr><td title="Giải tám">G8</td><td><p>20</p></td><td>0</td><td></td></tr>
// <tr><td title="Giải ĐB">ĐB</td><td><em>683111</em></td><td>9</td><td>2, 8</td></tr>
async function fetchFromXSKT() {
    try {
        const url = 'https://xskt.com.vn/xshcm-xstp';
        
        console.log(`📡 Fetching from xskt.com.vn: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
                'Referer': 'https://xskt.com.vn/'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const result = { 
            date: '', 
            prizes: {
                g8: [], g7: [], g6: [], g5: [], g4: [], g3: [], g2: [], g1: [], db: []
            }, 
            dauDuoi: { dau: [], duoi: [] },
            source: 'xskt.com.vn' 
        };

        // Lấy ngày từ link trong bảng (XSHCM 26-1)
        const dateLink = $('a[href*="/xshcm-xstp/ngay-"]').first().text().trim();
        const dateMatch = dateLink.match(/(\d{1,2}[-\/]\d{1,2})/);
        if (dateMatch) {
            result.date = `Xổ số TP.HCM ngày ${dateMatch[1].replace('-', '/')}`;
        } else {
            result.date = 'Xổ số TP.HCM - Kết quả mới nhất';
        }

        // Tìm bảng kết quả đầu tiên (HCM0) - bảng mới nhất
        const mainTable = $('table.result').first();
        
        // Lấy HTML thô của bảng để xử lý
        const tableHtml = mainTable.html() || '';
        
        // Parse từng row trong bảng
        mainTable.find('tr').each((i, row) => {
            const $row = $(row);
            const cells = $row.find('td');
            if (cells.length < 2) return;
            
            // Cell đầu tiên chứa tên giải (G8, G7, ..., ĐB)
            const prizeCell = cells.first();
            const prizeText = prizeCell.text().trim().toUpperCase();
            
            // Skip row không có giải (như row 6 chỉ có "5" -> đầu đuôi)
            if (!/^(G\d|ĐB|DB)$/.test(prizeText)) return;
            
            // Cell thứ 2 chứa số (trong <p> hoặc <em>)
            const numberCell = cells.eq(1);
            let numbers = [];
            
            // Lấy HTML của cell và xử lý
            let cellHtml = numberCell.html() || '';
            
            // Thay <br> thành space
            cellHtml = cellHtml.replace(/<br\s*\/?>/gi, ' ');
            // Loại bỏ tất cả tags HTML (p, em, etc)
            cellHtml = cellHtml.replace(/<[^>]*>/g, ' ');
            // Normalize spaces
            cellHtml = cellHtml.replace(/\s+/g, ' ').trim();
            
            // Tách theo space
            const parts = cellHtml.split(/\s+/);
            parts.forEach(part => {
                const num = part.replace(/\D/g, '');
                if (num && num.length >= 2 && num.length <= 6) {
                    numbers.push(num);
                }
            });
            
            // Fallback: lấy text trực tiếp và tách theo khoảng trắng
            if (numbers.length === 0) {
                const directText = numberCell.text().trim().replace(/\s+/g, ' ');
                const parts = directText.split(/\s+/);
                parts.forEach(part => {
                    const num = part.replace(/\D/g, '');
                    if (num && num.length >= 2 && num.length <= 6) {
                        numbers.push(num);
                    }
                });
            }

            // Gán giải theo tên
            if (prizeText === 'G8' || prizeText.includes('GIẢI TÁM')) {
                result.prizes.g8 = numbers;
            } else if (prizeText === 'G7' || prizeText.includes('GIẢI BẢY')) {
                result.prizes.g7 = numbers;
            } else if (prizeText === 'G6' || prizeText.includes('GIẢI SÁU')) {
                result.prizes.g6 = numbers;
            } else if (prizeText === 'G5' || prizeText.includes('GIẢI NĂM')) {
                result.prizes.g5 = numbers;
            } else if (prizeText === 'G4' || prizeText.includes('GIẢI TƯ')) {
                // G4 có thể có rowspan, gộp số từ nhiều row
                if (result.prizes.g4.length === 0) {
                    result.prizes.g4 = numbers;
                } else {
                    result.prizes.g4.push(...numbers);
                }
            } else if (prizeText === 'G3' || prizeText.includes('GIẢI BA')) {
                result.prizes.g3 = numbers;
            } else if (prizeText === 'G2' || prizeText.includes('GIẢI NHÌ')) {
                result.prizes.g2 = numbers;
            } else if (prizeText === 'G1' || prizeText.includes('GIẢI NHẤT')) {
                result.prizes.g1 = numbers;
            } else if (prizeText === 'ĐB' || prizeText === 'DB' || prizeText.includes('ĐẶC BIỆT')) {
                result.prizes.db = numbers;
            }
        });

        // Parse Đầu-Đuôi từ cột 3 và 4
        mainTable.find('tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 4) {
                const dauVal = cells.eq(2).text().trim();
                const duoiVal = cells.eq(3).text().trim();
                if (/^\d$/.test(dauVal) || dauVal.includes(',')) {
                    result.dauDuoi.dau.push({ num: dauVal, values: duoiVal });
                }
            }
        });

        console.log('📊 Parsed prizes:', JSON.stringify(result.prizes, null, 2));
        return result;
    } catch (error) {
        console.error('❌ XSKT error:', error.message);
        return null;
    }
}

// Parser backup cho xoso.com.vn - CHỈ XSHCM
async function fetchFromXoSo() {
    try {
        const url = 'https://xoso.com.vn/xo-so-tphcm/xshcm-p1.html';
        
        console.log(`📡 Fetching from xoso.com.vn: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const result = { 
            date: '', 
            prizes: { g8: [], g7: [], g6: [], g5: [], g4: [], g3: [], g2: [], g1: [], db: [] }, 
            source: 'xoso.com.vn' 
        };

        result.date = $('h1, .title-kqxs').first().text().trim() || 'Xổ số TP.HCM';

        $('table tr').each((i, row) => {
            const $row = $(row);
            const cells = $row.find('td');
            if (cells.length < 2) return;

            const label = cells.first().text().trim().toUpperCase();
            const numbers = [];

            cells.slice(1).find('span, em, a').each((j, el) => {
                const num = $(el).text().trim().replace(/\D/g, '');
                if (num && num.length >= 2 && num.length <= 6) numbers.push(num);
            });

            if (numbers.length === 0) {
                cells.slice(1).each((j, cell) => {
                    const matches = $(cell).text().match(/\d{2,6}/g);
                    if (matches) numbers.push(...matches);
                });
            }

            if (label.includes('G8') || label === '8') result.prizes.g8 = numbers;
            else if (label.includes('G7') || label === '7') result.prizes.g7 = numbers;
            else if (label.includes('G6') || label === '6') result.prizes.g6 = numbers;
            else if (label.includes('G5') || label === '5') result.prizes.g5 = numbers;
            else if (label.includes('G4') || label === '4') result.prizes.g4 = numbers;
            else if (label.includes('G3') || label === '3') result.prizes.g3 = numbers;
            else if (label.includes('G2') || label === '2') result.prizes.g2 = numbers;
            else if (label.includes('G1') || label === '1') result.prizes.g1 = numbers;
            else if (label.includes('DB') || label.includes('ĐB')) result.prizes.db = numbers;
        });

        return result;
    } catch (error) {
        console.error('❌ XoSo error:', error.message);
        return null;
    }
}

// Parser backup cho minhngoc.net.vn - CHỈ XSHCM
async function fetchFromMinhNgoc() {
    try {
        const url = 'https://www.minhngoc.net.vn/ket-qua-xo-so/mien-nam/tp-hcm.html';
        
        console.log(`📡 Fetching from minhngoc.net.vn: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const result = { 
            date: '', 
            prizes: { g8: [], g7: [], g6: [], g5: [], g4: [], g3: [], g2: [], g1: [], db: [] }, 
            source: 'minhngoc.net.vn' 
        };

        result.date = $('h1, .title').first().text().trim() || 'Xổ số TP.HCM';

        $('table tr').each((i, row) => {
            const $row = $(row);
            const label = $row.find('td').first().text().trim().toUpperCase();
            const numbers = [];

            $row.find('td span, td em').each((j, el) => {
                const num = $(el).text().trim().replace(/\D/g, '');
                if (num && num.length >= 2 && num.length <= 6) numbers.push(num);
            });

            if (numbers.length === 0) {
                $row.find('td').slice(1).each((j, cell) => {
                    const matches = $(cell).text().match(/\d{2,6}/g);
                    if (matches) numbers.push(...matches);
                });
            }

            if (label.includes('G8') || label === '8') result.prizes.g8 = numbers;
            else if (label.includes('G7') || label === '7') result.prizes.g7 = numbers;
            else if (label.includes('G6') || label === '6') result.prizes.g6 = numbers;
            else if (label.includes('G5') || label === '5') result.prizes.g5 = numbers;
            else if (label.includes('G4') || label === '4') result.prizes.g4 = numbers;
            else if (label.includes('G3') || label === '3') result.prizes.g3 = numbers;
            else if (label.includes('G2') || label === '2') result.prizes.g2 = numbers;
            else if (label.includes('G1') || label === '1') result.prizes.g1 = numbers;
            else if (label.includes('DB') || label.includes('ĐB')) result.prizes.db = numbers;
        });

        return result;
    } catch (error) {
        console.error('❌ MinhNgoc error:', error.message);
        return null;
    }
}

// Kiểm tra dữ liệu hợp lệ - cấu trúc XSHCM
function isValidData(data) {
    if (!data || !data.prizes) return false;
    if (!data.prizes.db || data.prizes.db.length === 0) return false;
    // XSHCM phải có ít nhất G8, G7, DB
    const prizeCount = Object.keys(data.prizes).filter(k => 
        data.prizes[k] && data.prizes[k].length > 0
    ).length;
    return prizeCount >= 5;
}

// Hàm fetch chính - thử nhiều nguồn - CHỈ XSHCM
async function fetchLotteryData() {
    console.log(`\n🎰 Fetching XSHCM lottery data...`);
    
    // Thử từng nguồn theo thứ tự ưu tiên: xskt.com.vn đầu tiên
    const fetchers = [
        fetchFromXSKT,
        fetchFromXoSo,
        fetchFromMinhNgoc
    ];

    for (const fetcher of fetchers) {
        try {
            const data = await fetcher();
            if (isValidData(data)) {
                console.log(`✅ Successfully fetched from ${data.source}`);
                return data;
            } else {
                console.log(`⚠️ Data from ${data?.source || 'unknown'} is incomplete`);
            }
        } catch (e) {
            console.log(`⚠️ Fetcher failed: ${e.message}`);
        }
    }

    console.log(`❌ All sources failed for XSHCM`);
    return null;
}

// Dữ liệu mẫu XSHCM khi không fetch được (theo cấu trúc thực tế)
function generateFallbackData() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('vi-VN', { 
        day: '2-digit',
        month: '2-digit'
    });

    const gen = (len) => {
        let r = '';
        for (let i = 0; i < len; i++) r += Math.floor(Math.random() * 10);
        return r;
    };

    // Cấu trúc XSHCM thực tế: G8 -> DB (từ trên xuống)
    return {
        date: `Xổ số TP.HCM ngày ${dateStr}`,
        prizes: {
            g8: [gen(2)],                                           // 1 số 2 chữ số
            g7: [gen(3)],                                           // 1 số 3 chữ số
            g6: [gen(4), gen(4), gen(4)],                          // 3 số 4 chữ số
            g5: [gen(4)],                                           // 1 số 4 chữ số
            g4: [gen(5), gen(5), gen(5), gen(5), gen(5), gen(5), gen(5)], // 7 số 5 chữ số
            g3: [gen(5), gen(5)],                                   // 2 số 5 chữ số
            g2: [gen(5)],                                           // 1 số 5 chữ số
            g1: [gen(5)],                                           // 1 số 5 chữ số
            db: [gen(6)]                                            // 1 số 6 chữ số
        },
        source: 'Demo (Chờ cập nhật)',
        isDemo: true
    };
}

// ==================== API ENDPOINTS ====================

// API lấy kết quả XSHCM
app.get('/api/lottery/hcm', async (req, res) => {
    const forceRefresh = req.query.refresh === 'true';
    const now = Date.now();

    // Kiểm tra cache
    if (!forceRefresh && lotteryCache.hcm && 
        (now - lotteryCache.hcmLastUpdate) < CACHE_DURATION) {
        console.log(`📦 Returning cached XSHCM data`);
        return res.json({
            success: true,
            data: lotteryCache.hcm,
            cached: true,
            lastUpdate: lotteryCache.hcmLastUpdate
        });
    }

    try {
        let data = await fetchLotteryData();

        if (!data || !isValidData(data)) {
            console.log(`⚠️ Using fallback data for XSHCM`);
            data = generateFallbackData();
        }

        // Cập nhật cache
        lotteryCache.hcm = data;
        lotteryCache.hcmLastUpdate = now;

        res.json({
            success: true,
            data: data,
            cached: false,
            lastUpdate: now
        });
    } catch (error) {
        console.error('API Error:', error);
        const fallback = generateFallbackData();
        res.json({
            success: true,
            data: fallback,
            cached: false,
            lastUpdate: now,
            error: error.message
        });
    }
});

// Redirect các route cũ
app.get('/api/lottery/:region', (req, res) => {
    res.redirect('/api/lottery/hcm');
});

// API thời gian server
app.get('/api/time', (req, res) => {
    res.json({
        serverTime: new Date().toISOString(),
        localTime: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    });
});

// API lịch quay số XSHCM
app.get('/api/schedule', (req, res) => {
    res.json({
        hcm: { 
            days: ['Thứ 2', 'Thứ 7'], 
            time: '16:15', 
            note: 'Xổ số TP.HCM quay vào Thứ 2 và Thứ 7 hàng tuần lúc 16:15' 
        }
    });
});

// API xóa cache
app.post('/api/clear-cache', (req, res) => {
    lotteryCache = { hcm: null, hcmLastUpdate: null };
    console.log('🗑️ Cache cleared');
    res.json({ success: true, message: 'Cache cleared' });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║     🎰 XỔ SỐ TP.HỒ CHÍ MINH - XSHCM TRỰC TUYẾN 🎰           ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  🌐 URL: http://localhost:${PORT}                               ║`);
    console.log('║  📡 Nguồn ưu tiên: xskt.com.vn                                ║');
    console.log('║  📡 Backup: xoso.com.vn | minhngoc.net.vn                     ║');
    console.log('║  🔄 Auto-refresh: 2 phút                                      ║');
    console.log('║  📅 Lịch quay: Thứ 2 & Thứ 7 lúc 16:15                        ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('║  API Endpoints:                                               ║');
    console.log('║    GET /api/lottery/hcm  - Kết quả XSHCM                      ║');
    console.log('║    GET /api/time         - Thời gian server                   ║');
    console.log('║    GET /api/schedule     - Lịch quay số                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📅 ${new Date().toLocaleString('vi-VN')}`);
    console.log('');
});
