class OKXAdapter {
    constructor(config) {
        this.config = config;
        this.baseURL = config.baseURL;
    }

    // تحويل بيانات OKX لتتوافق مع الكود الحالي
    async getMarketData() {
        try {
            const response = await fetch(`${this.baseURL}${this.config.endpoints.tickers}`);
            const data = await response.json();
            
            // تحويل تنسيق OKX إلى تنسيق CoinGecko
            return this.transformOKXToCoinGecko(data.data);
        } catch (error) {
            console.error('OKX API Error:', error);
            // Fallback إلى CoinGecko
            return this.fallbackToCoinGecko();
        }
    }

    transformOKXToCoinGecko(okxData) {
        return okxData.map(coin => ({
            // تحويل تنسيق البيانات
            id: coin.instId.toLowerCase().replace('-usdt', ''),
            symbol: coin.instId.split('-')[0].toLowerCase(),
            name: coin.instId.split('-')[0],
            current_price: parseFloat(coin.last),
            price_change_percentage_24h: parseFloat(coin.chg) * 100,
            total_volume: parseFloat(coin.vol24h),
            market_cap: parseFloat(coin.last) * parseFloat(coin.vol24h),
            // إضافة بيانات OKX الخاصة
            okx_data: {
                bid: parseFloat(coin.bidPx),
                ask: parseFloat(coin.askPx),
                high24h: parseFloat(coin.high24h),
                low24h: parseFloat(coin.low24h),
                volCcy24h: parseFloat(coin.volCcy24h)
            }
        }));
    }

    async fallbackToCoinGecko() {
        // استخدام CoinGecko كـ backup
        const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1');
        return await response.json();
    }
}
