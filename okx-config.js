// ملف منفصل للإعدادات
const OKX_CONFIG = {
    apiKey: 'b20c667d-ae40-48a6-93f4-a11a64185068',
    secretKey: 'BD7C76F71D1A4E01B4C7E1A23B620365', 
    passphrase: '212160Nm$#',
    baseURL: 'https://www.okx.com',
    endpoints: {
        tickers: '/api/v5/market/tickers?instType=SPOT',
        klines: '/api/v5/market/candles',
        orderBook: '/api/v5/market/books'
    }
};
