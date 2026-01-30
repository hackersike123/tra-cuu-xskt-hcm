const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
    console.log('Fetching...');
    const r = await axios.get('https://xskt.com.vn/xshcm-xstp');
    const $ = cheerio.load(r.data);
    const t = $('table.result').first();
    
    // Tìm G4 row
    t.find('tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
            const prizeText = cells.first().text().trim().toUpperCase();
            if (prizeText === 'G4') {
                const cellHtml = cells.eq(1).html() || '';
                console.log('G4 Raw HTML:', cellHtml);
                console.log('Has <br>:', cellHtml.includes('<br'));
                
                // Try replacing
                let processed = cellHtml.replace(/<br\s*\/?>/gi, ' ');
                console.log('After br replace:', processed);
                
                // Remove tags
                processed = processed.replace(/<[^>]*>/g, ' ');
                console.log('After tag remove:', processed);
                
                // Normalize spaces
                processed = processed.replace(/\s+/g, ' ').trim();
                console.log('Final:', processed);
                
                // Split
                const parts = processed.split(/\s+/);
                console.log('Parts:', parts);
            }
        }
    });
})();
