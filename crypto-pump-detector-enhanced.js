class EnhancedCryptoPumpDetector {
    constructor() {
         this.okxAdapter = new OKXAdapter(OKX_CONFIG);
        this.useOKX = true; // تبديل المصدر
        this.coins = [];
        this.filteredCoins = [];
        this.currentFilter = 'all';
        this.isLoading = false;
        this.marketTrend = 'neutral';
        this.marketCondition = 'sideways'; // bull, bear, sideways
        this.topCoinsLimit = 100; // عرض أفضل 100 عملة فقط
        this.minScore = 60; // الحد الأدنى للنقاط
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadData();
        
        // تحديث البيانات كل 3 دقائق للحصول على أفضل النتائج
        setInterval(() => {
            if (!this.isLoading) {
                this.loadData();
            }
        }, 180000);
    }

    bindEvents() {
        // أزرار الفلاتر المحدثة
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setActiveFilter(e.target);
                this.currentFilter = e.target.dataset.score;
                this.filterCoins();
            });
        });

        // زر التحديث
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadData();
        });

        // إغلاق النافذة المنبثقة
        document.getElementById('closeModal').addEventListener('click', () => {
            this.closeModal();
        });
        
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'modalOverlay') {
                this.closeModal();
            }
        });
    }

    setActiveFilter(activeBtn) {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        activeBtn.classList.add('active');
    }

    async loadData() {
        this.showLoading(true);
        
        try {
            // جلب بيانات العملات من OKX
            const tickers = await this.fetchOKXTickers();
            const candleData = await this.fetchCandleData(tickers);
            
            // تحديد حالة السوق أولاً
            await this.determineMarketCondition(tickers, candleData);
            
            // تحليل العملات بناءً على حالة السوق
            this.coins = await this.analyzeCoins(tickers, candleData);
            
            // فلترة العملات التي تحقق الحد الأدنى من النقاط
            this.coins = this.coins.filter(coin => coin.score >= this.minScore);
            
            // ترتيب العملات حسب النقاط
            this.coins.sort((a, b) => b.score - a.score);
            
            // الاحتفاظ بأفضل 100 عملة فقط
            this.coins = this.coins.slice(0, this.topCoinsLimit);
            
            // تحديد المراكز
            this.assignRanks();
            
            // تحديث اتجاه السوق
            this.updateMarketTrend();
            
            // عرض النتائج
            this.filterCoins();
            
            // تحديث وقت آخر تحديث
            document.getElementById('lastUpdate').textContent = 
                `آخر تحديث: ${new Date().toLocaleTimeString('ar-SA')}`;
                
        } catch (error) {
            console.error('خطأ في جلب البيانات:', error);
            this.showError('حدث خطأ في جلب البيانات. يرجى المحاولة مرة أخرى.');
        }
        
        this.showLoading(false);
    }

    async fetchOKXTickers() {
        const response = await fetch(`${CONFIG.OKX_API.BASE_URL}/market/tickers?instType=SPOT`);
        const data = await response.json();
        
        if (data.code !== '0') {
            throw new Error('فشل في جلب بيانات الأسعار');
        }
        
        // فلترة العملات المقترنة بـ USDT فقط
        return data.data.filter(ticker => {
            const symbol = ticker.instId;
            const baseSymbol = symbol.replace('-USDT', '');
            
            return symbol.endsWith('-USDT') &&
                   !CONFIG.FILTERS.EXCLUDED_SYMBOLS.includes(baseSymbol) &&
                   parseFloat(ticker.last) >= CONFIG.FILTERS.MIN_PRICE &&
                   parseFloat(ticker.vol24h) >= CONFIG.FILTERS.MIN_VOLUME;
        });
    }

    async fetchCandleData(tickers) {
        const candlePromises = tickers.slice(0, 200).map(async (ticker) => {
            try {
                const response = await fetch(
                    `${CONFIG.OKX_API.BASE_URL}/market/candles?instId=${ticker.instId}&bar=1D&limit=50`
                );
                const data = await response.json();
                return {
                    symbol: ticker.instId,
                    candles: data.code === '0' ? data.data : []
                };
            } catch (error) {
                return { symbol: ticker.instId, candles: [] };
            }
        });
        
        return await Promise.all(candlePromises);
    }

    // تحديد حالة السوق العامة
    async determineMarketCondition(tickers, candleData) {
        const majorCoins = ['BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'ADA-USDT', 'SOL-USDT'];
        let bullishCount = 0;
        let bearishCount = 0;
        
        for (const coinSymbol of majorCoins) {
            const ticker = tickers.find(t => t.instId === coinSymbol);
            const candles = candleData.find(c => c.symbol === coinSymbol)?.candles || [];
            
            if (ticker && candles.length >= 30) {
                const prices = candles.map(c => parseFloat(c[4]));
                const ma7 = this.simpleMovingAverage(prices, 7);
                const ma25 = this.simpleMovingAverage(prices, 25);
                const rsi = this.calculateRSI(prices);
                const change24h = parseFloat(ticker.sodUtc8);
                
                // تحديد الاتجاه بناءً على عدة عوامل
                const isBullish = ma7 > ma25 && rsi.value > 45 && change24h > -2;
                const isBearish = ma7 < ma25 && rsi.value < 55 && change24h < 2;
                
                if (isBullish) bullishCount++;
                if (isBearish) bearishCount++;
            }
        }
        
        if (bullishCount >= 3) {
            this.marketCondition = 'bull';
        } else if (bearishCount >= 3) {
            this.marketCondition = 'bear';
        } else {
            this.marketCondition = 'sideways';
        }
        
        console.log(`حالة السوق المحددة: ${this.marketCondition}`);
    }

    async analyzeCoins(tickers, candleData) {
        const analyzedCoins = [];
        
        for (let i = 0; i < Math.min(tickers.length, 300); i++) {
            const ticker = tickers[i];
            const candles = candleData.find(c => c.symbol === ticker.instId)?.candles || [];
            
            if (candles.length < 30) continue;
            
            const analysis = await this.performTechnicalAnalysis(ticker, candles);
            const score = this.calculateAdaptiveScore(analysis, ticker);
            
            // فقط العملات التي تحقق الحد الأدنى من النقاط
            if (score >= this.minScore) {
                analyzedCoins.push({
                    symbol: ticker.instId.replace('-USDT', ''),
                    fullSymbol: ticker.instId,
                    price: parseFloat(ticker.last),
                    change24h: parseFloat(ticker.sodUtc8),
                    volume24h: parseFloat(ticker.vol24h),
                    analysis,
                    score,
                    rank: 0,
                    marketCondition: this.marketCondition
                });
            }
        }
        
        return analyzedCoins;
    }

    async performTechnicalAnalysis(ticker, candles) {
        const prices = candles.map(c => parseFloat(c[4])); // أسعار الإغلاق
        const volumes = candles.map(c => parseFloat(c[5])); // الأحجام
        const highs = candles.map(c => parseFloat(c[2])); // أعلى سعر
        const lows = candles.map(c => parseFloat(c[3])); // أقل سعر
        const opens = candles.map(c => parseFloat(c[1])); // أسعار الافتتاح
        
        return {
            // التحليلات الأساسية (محفوظة)
            liquidityFlow: this.calculateLiquidityFlow(volumes.slice(0, 7)),
            buyingPower: this.calculateBuyingPower(ticker, volumes),
            accumulationDistribution: this.calculateAccumulationDistribution(prices.slice(0, 7), volumes.slice(0, 7)),
            movingAverages: this.calculateMovingAverages(prices),
            rsi: this.calculateRSI(prices),
            macd: this.calculateMACD(prices),
            moneyFlowIndex: this.calculateMFI(highs, lows, prices, volumes),
            supportResistance: this.calculateSupportResistance(highs, lows),
            entryPoint: this.calculateEntryPoint(prices, volumes),
            stopLoss: this.calculateStopLoss(prices),
            
            // تحليلات إضافية للتكيف مع السوق
            volatility: this.calculateVolatility(prices),
            momentum: this.calculateMomentum(prices),
            volumeProfile: this.calculateVolumeProfile(prices, volumes),
            priceAction: this.analyzePriceAction(opens, highs, lows, prices),
            marketStructure: this.analyzeMarketStructure(highs, lows, prices),
            
            // تحليل خاص بالسوق الهابط
            bearishAnalysis: this.marketCondition === 'bear' ? this.analyzeBearishOpportunity(highs, lows, prices, volumes) : null,
            
            // تحليل خاص بالسوق الصاعد
            bullishAnalysis: this.marketCondition === 'bull' ? this.analyzeBullishMomentum(prices, volumes) : null,
            
            // تحليل خاص بالسوق المتذبذب
            sidewaysAnalysis: this.marketCondition === 'sideways' ? this.analyzeSidewaysOpportunity(highs, lows, prices, volumes) : null
        };
    }

    // تحليل خاص بالسوق الهابط - البحث عن الدعوم والفرص
    analyzeBearishOpportunity(highs, lows, prices, volumes) {
        const currentPrice = prices[0];
        const recentLows = lows.slice(0, 14);
        const strongSupport = Math.min(...recentLows);
        const supportDistance = ((currentPrice - strongSupport) / currentPrice) * 100;
        
        // تحليل قوة الدعم
        const supportTouches = recentLows.filter(low => Math.abs(low - strongSupport) / strongSupport < 0.02).length;
        const supportStrength = supportTouches >= 2 ? 'strong' : 'weak';
        
        // تحليل الانحراف عن السوق
        const marketDivergence = this.calculateMarketDivergence(prices, volumes);
        
        // تحليل احتمالية الارتداد
        const bounceProb = this.calculateBounceprobability(prices, volumes, supportDistance);
        
        return {
            supportLevel: strongSupport,
            supportDistance: supportDistance.toFixed(2),
            supportStrength,
            marketDivergence,
            bounceProb,
            recommendation: this.getBearishRecommendation(supportDistance, supportStrength, bounceProb)
        };
    }

    // تحليل خاص بالسوق الصاعد
    analyzeBullishMomentum(prices, volumes) {
        const momentum = this.calculateMomentum(prices);
        const volumeConfirmation = this.calculateVolumeConfirmation(prices, volumes);
        const breakoutPotential = this.calculateBreakoutPotential(prices);
        
        return {
            momentum,
            volumeConfirmation,
            breakoutPotential,
            trendStrength: this.calculateTrendStrength(prices),
            recommendation: this.getBullishRecommendation(momentum, volumeConfirmation, breakoutPotential)
        };
    }

    // تحليل خاص بالسوق المتذبذب
    analyzeSidewaysOpportunity(highs, lows, prices, volumes) {
        const range = this.calculateTradingRange(highs, lows);
        const rangePosition = this.calculateRangePosition(prices[0], range);
        const breakoutDirection = this.predictBreakoutDirection(prices, volumes);
        
        return {
            range,
            rangePosition,
            breakoutDirection,
            recommendation: this.getSidewaysRecommendation(rangePosition, breakoutDirection)
        };
    }

        // حساب النقاط المتكيف مع حالة السوق 
    calculateAdaptiveScore(analysis, ticker) {
        let score = 0;
        const baseScore = this.calculateBaseScore(analysis); // النقاط الأساسية
        
        score += baseScore;
        
        // نقاط إضافية بناءً على حالة السوق
        switch (this.marketCondition) {
            case 'bull':
                score += this.calculateBullishScore(analysis);
                break;
            case 'bear':
                score += this.calculateBearishScore(analysis);
                break;
            case 'sideways':
                score += this.calculateSidewaysScore(analysis);
                break;
        }
        
        // نقاط إضافية للجودة العامة
        score += this.calculateQualityScore(analysis, ticker);
        
        return Math.min(Math.max(score, 0), 100);
    }

    // النقاط الأساسية (محفوظة من الكود الأصلي)
    calculateBaseScore(analysis) {
        let score = 0;
        
        // نقاط RSI
        if (analysis.rsi.trend === 'bullish' && analysis.rsi.signal !== 'overbought') {
            score += 15;
        }
        
        // نقاط MACD
        if (analysis.macd.signal === 'bullish') {
            score += 15;
        }
        
        // نقاط السيولة
        if (analysis.liquidityFlow.trend === 'increasing' && parseFloat(analysis.liquidityFlow.percentage) > 20) {
            score += 10;
        }
        
        // نقاط القوة الشرائية
        if (analysis.buyingPower.strength === 'high') {
            score += 10;
        } else if (analysis.buyingPower.strength === 'medium') {
            score += 6;
        }
        
        // نقاط المتوسطات المتحركة
        if (analysis.movingAverages.signal === 'buy' && analysis.movingAverages.priceAboveMA) {
            score += 10;
        }
        
        return score;
    }

    // نقاط خاصة بالسوق الصاعد
    calculateBullishScore(analysis) {
        let score = 0;
        
        if (analysis.bullishAnalysis) {
            // قوة الزخم
            if (analysis.bullishAnalysis.momentum > 5) score += 8;
            else if (analysis.bullishAnalysis.momentum > 2) score += 5;
            
            // تأكيد الحجم
            if (analysis.bullishAnalysis.volumeConfirmation === 'strong') score += 8;
            else if (analysis.bullishAnalysis.volumeConfirmation === 'medium') score += 5;
            
            // إمكانية الاختراق
            if (analysis.bullishAnalysis.breakoutPotential === 'high') score += 10;
            else if (analysis.bullishAnalysis.breakoutPotential === 'medium') score += 6;
            
            // قوة الاتجاه
            if (analysis.bullishAnalysis.trendStrength === 'strong') score += 6;
        }
        
        // نقاط إضافية للمؤشرات الإيجابية في السوق الصاعد
        if (analysis.rsi.value < 70 && analysis.rsi.trend === 'bullish') score += 5;
        if (analysis.moneyFlowIndex.flow === 'positive') score += 5;
        
        return score;
    }

    // نقاط خاصة بالسوق الهابط - التركيز على الدعوم والفرص
    calculateBearishScore(analysis) {
        let score = 0;
        
        if (analysis.bearishAnalysis) {
            // قوة الدعم
            if (analysis.bearishAnalysis.supportStrength === 'strong') score += 15;
            else if (analysis.bearishAnalysis.supportStrength === 'medium') score += 8;
            
            // المسافة من الدعم
            const supportDistance = parseFloat(analysis.bearishAnalysis.supportDistance);
            if (supportDistance < 5) score += 12; // قريب من الدعم القوي
            else if (supportDistance < 10) score += 8;
            else if (supportDistance < 15) score += 5;
            
            // احتمالية الارتداد
            if (analysis.bearishAnalysis.bounceProb === 'high') score += 15;
            else if (analysis.bearishAnalysis.bounceProb === 'medium') score += 10;
            
            // مخالفة اتجاه السوق (إشارة إيجابية في السوق الهابط)
            if (analysis.bearishAnalysis.marketDivergence === 'positive') score += 10;
        }
        
        // نقاط إضافية للمؤشرات المناسبة للسوق الهابط
        if (analysis.rsi.signal === 'oversold') score += 12;
        if (analysis.accumulationDistribution.trend === 'accumulation') score += 8;
        
        // مكافأة العملات التي تظهر قوة في السوق الهابط
        if (analysis.liquidityFlow.trend === 'increasing') score += 10;
        
        return score;
    }

    // نقاط خاصة بالسوق المتذبذب
    calculateSidewaysScore(analysis) {
        let score = 0;
        
        if (analysis.sidewaysAnalysis) {
            // موقع السعر في النطاق
            if (analysis.sidewaysAnalysis.rangePosition === 'bottom') score += 12;
            else if (analysis.sidewaysAnalysis.rangePosition === 'middle-low') score += 8;
            
            // اتجاه الاختراق المتوقع
            if (analysis.sidewaysAnalysis.breakoutDirection === 'upward') score += 10;
            else if (analysis.sidewaysAnalysis.breakoutDirection === 'neutral') score += 5;
        }
        
        // نقاط للتذبذب المربح
        if (analysis.volatility && analysis.volatility.level === 'optimal') score += 8;
        
        return score;
    }

    // نقاط الجودة العامة
    calculateQualityScore(analysis, ticker) {
        let score = 0;
        
        // جودة السيولة
        const volume24h = parseFloat(ticker.vol24h);
        if (volume24h > 10000000) score += 5; // حجم تداول عالي
        else if (volume24h > 5000000) score += 3;
        
        // استقرار المؤشرات
        const positiveIndicators = [
            analysis.rsi.trend === 'bullish',
            analysis.macd.signal === 'bullish',
            analysis.liquidityFlow.trend === 'increasing',
            analysis.buyingPower.strength !== 'low',
            analysis.movingAverages.crossover === 'bullish',
            analysis.accumulationDistribution.trend === 'accumulation'
        ].filter(Boolean).length;
        
        if (positiveIndicators >= 5) score += 8;
        else if (positiveIndicators >= 4) score += 5;
        else if (positiveIndicators >= 3) score += 3;
        
        return score;
    }

    // الدوال المساعدة الجديدة
    calculateVolatility(prices) {
        const returns = [];
        for (let i = 1; i < Math.min(prices.length, 14); i++) {
            returns.push((prices[i-1] - prices[i]) / prices[i]);
        }
        
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
        const volatility = Math.sqrt(variance) * 100;
        
        return {
            value: volatility.toFixed(2),
            level: volatility > 8 ? 'high' : volatility > 4 ? 'optimal' : 'low'
        };
    }

    calculateMomentum(prices) {
        if (prices.length < 10) return 0;
        const momentum = ((prices[0] - prices[9]) / prices[9]) * 100;
        return momentum;
    }

    calculateVolumeProfile(prices, volumes) {
        const recentVolume = volumes.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
        const avgVolume = volumes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
        
        return {
            ratio: (recentVolume / avgVolume).toFixed(2),
            trend: recentVolume > avgVolume ? 'increasing' : 'decreasing'
        };
    }

    analyzePriceAction(opens, highs, lows, closes) {
        const recentCandles = [];
        for (let i = 0; i < Math.min(5, opens.length); i++) {
            const bodySize = Math.abs(closes[i] - opens[i]);
            const totalSize = highs[i] - lows[i];
            const bodyRatio = bodySize / totalSize;
            
            recentCandles.push({
                type: closes[i] > opens[i] ? 'bullish' : 'bearish',
                strength: bodyRatio > 0.7 ? 'strong' : bodyRatio > 0.4 ? 'medium' : 'weak'
            });
        }
        
        const bullishCandles = recentCandles.filter(c => c.type === 'bullish').length;
        const strongCandles = recentCandles.filter(c => c.strength === 'strong').length;
        
        return {
            bullishRatio: (bullishCandles / recentCandles.length * 100).toFixed(0),
            strength: strongCandles >= 3 ? 'strong' : strongCandles >= 2 ? 'medium' : 'weak'
        };
    }

    analyzeMarketStructure(highs, lows, prices) {
        // تحليل الهيكل: Higher Highs, Higher Lows, etc.
        const recentHighs = highs.slice(0, 10);
        const recentLows = lows.slice(0, 10);
        
        let higherHighs = 0;
        let higherLows = 0;
        
        for (let i = 1; i < 5; i++) {
            if (recentHighs[i-1] > recentHighs[i]) higherHighs++;
            if (recentLows[i-1] > recentLows[i]) higherLows++;
        }
        
        let structure = 'neutral';
        if (higherHighs >= 3 && higherLows >= 3) structure = 'uptrend';
        else if (higherHighs <= 1 && higherLows <= 1) structure = 'downtrend';
        
        return {
            structure,
            strength: Math.max(higherHighs, higherLows) >= 4 ? 'strong' : 'weak'
        };
    }

    calculateMarketDivergence(prices, volumes) {
        const priceChange = ((prices[0] - prices[6]) / prices[6]) * 100;
        const volumeChange = ((volumes[0] - volumes[6]) / volumes[6]) * 100;
        
        // إذا كان السعر ينخفض والحجم يزيد = إشارة إيجابية
        if (priceChange < -2 && volumeChange > 10) return 'positive';
        if (priceChange > 2 && volumeChange < -10) return 'negative';
        return 'neutral';
    }

    calculateBounceprobability(prices, volumes, supportDistance) {
        const rsi = this.calculateRSI(prices);
        const volumeIncrease = volumes[0] > volumes.slice(1, 8).reduce((a, b) => a + b, 0) / 7;
        
        let probability = 'low';
        if (supportDistance < 5 && rsi.value < 35 && volumeIncrease) {
            probability = 'high';
        } else if (supportDistance < 10 && rsi.value < 45) {
            probability = 'medium';
        }
        
        return probability;
    }

    calculateVolumeConfirmation(prices, volumes) {
        const priceUp = prices[0] > prices[1];
        const volumeUp = volumes[0] > volumes[1];
        
        if (priceUp && volumeUp) return 'strong';
        if (priceUp && !volumeUp) return 'weak';
        return 'medium';
    }

    calculateBreakoutPotential(prices) {
        const ma20 = this.simpleMovingAverage(prices, 20);
        const currentPrice = prices[0];
        const distanceFromMA = ((currentPrice - ma20) / ma20) * 100;
        
        if (distanceFromMA > 5) return 'high';
        if (distanceFromMA > 2) return 'medium';
        return 'low';
    }

    calculateTrendStrength(prices) {
        const ma7 = this.simpleMovingAverage(prices, 7);
        const ma25 = this.simpleMovingAverage(prices, 25);
        const separation = ((ma7 - ma25) / ma25) * 100;
        
        if (Math.abs(separation) > 5) return 'strong';
        if (Math.abs(separation) > 2) return 'medium';
        return 'weak';
    }

    calculateTradingRange(highs, lows) {
        const recentHighs = highs.slice(0, 20);
        const recentLows = lows.slice(0, 20);
        
        return {
            high: Math.max(...recentHighs),
            low: Math.min(...recentLows),
            range: ((Math.max(...recentHighs) - Math.min(...recentLows)) / Math.min(...recentLows) * 100).toFixed(2)
        };
    }

    calculateRangePosition(currentPrice, range) {
        const position = (currentPrice - range.low) / (range.high - range.low);
        
        if (position < 0.2) return 'bottom';
        if (position < 0.4) return 'middle-low';
        if (position < 0.6) return 'middle';
        if (position < 0.8) return 'middle-high';
        return 'top';
    }

       predictBreakoutDirection(prices, volumes) {
        const momentum = this.calculateMomentum(prices);
        const volumeTrend = this.calculateVolumeProfile(prices, volumes);
        const rsi = this.calculateRSI(prices);
        
        let upwardSignals = 0;
        let downwardSignals = 0;
        
        if (momentum > 2) upwardSignals++;
        if (momentum < -2) downwardSignals++;
        
        if (volumeTrend.trend === 'increasing' && rsi.value > 50) upwardSignals++;
        if (volumeTrend.trend === 'decreasing' && rsi.value < 50) downwardSignals++;
        
        if (upwardSignals > downwardSignals) return 'upward';
        if (downwardSignals > upwardSignals) return 'downward';
        return 'neutral';
    }

    // التوصيات المتخصصة لكل نوع سوق
    getBearishRecommendation(supportDistance, supportStrength, bounceProb) {
        if (supportStrength === 'strong' && parseFloat(supportDistance) < 5 && bounceProb === 'high') {
            return 'strong_buy_dip';
        } else if (supportStrength === 'strong' && parseFloat(supportDistance) < 10) {
            return 'moderate_buy_dip';
        } else {
            return 'wait_for_better_entry';
        }
    }

    getBullishRecommendation(momentum, volumeConfirmation, breakoutPotential) {
        if (momentum > 5 && volumeConfirmation === 'strong' && breakoutPotential === 'high') {
            return 'strong_momentum_buy';
        } else if (momentum > 2 && volumeConfirmation !== 'weak') {
            return 'moderate_momentum_buy';
        } else {
            return 'wait_for_confirmation';
        }
    }

    getSidewaysRecommendation(rangePosition, breakoutDirection) {
        if (rangePosition === 'bottom' && breakoutDirection === 'upward') {
            return 'range_bottom_buy';
        } else if (rangePosition === 'middle-low' && breakoutDirection === 'upward') {
            return 'moderate_range_buy';
        } else {
            return 'wait_for_range_break';
        }
    }

    // باقي الدوال المحفوظة من الكود الأصلي مع تحسينات
    calculateLiquidityFlow(volumes) {
        const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        const recentVolume = volumes.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        
        return {
            percentage: ((recentVolume / avgVolume - 1) * 100).toFixed(2),
            trend: recentVolume > avgVolume ? 'increasing' : 'decreasing'
        };
    }

    calculateBuyingPower(ticker, volumes) {
        const totalVolume = parseFloat(ticker.vol24h);
        const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        
        return {
            percentage: ((totalVolume / avgVolume - 1) * 100).toFixed(2),
            strength: totalVolume > avgVolume * 1.5 ? 'high' : totalVolume > avgVolume ? 'medium' : 'low'
        };
    }

    calculateAccumulationDistribution(prices, volumes) {
        let ad = 0;
        for (let i = 1; i < prices.length; i++) {
            const clv = ((prices[i] - prices[i-1]) / (prices[i] + prices[i-1])) * volumes[i];
            ad += clv;
        }
        
        return {
            value: ad,
            percentage: (ad / volumes.reduce((a, b) => a + b, 0) * 100).toFixed(2),
            trend: ad > 0 ? 'accumulation' : 'distribution'
        };
    }

    calculateMovingAverages(prices) {
        const ma7 = this.simpleMovingAverage(prices, 7);
        const ma25 = this.simpleMovingAverage(prices, 25);
        const currentPrice = prices[0];
        
        return {
            ma7: ma7.toFixed(6),
            ma25: ma25.toFixed(6),
            crossover: ma7 > ma25 ? 'bullish' : 'bearish',
            priceAboveMA: currentPrice > ma7 && currentPrice > ma25,
            signal: ma7 > ma25 && currentPrice > ma7 ? 'buy' : 'sell'
        };
    }

    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return { value: 50, signal: 'neutral', trend: 'neutral' };
        
        let gains = 0;
        let losses = 0;
        
        for (let i = 1; i <= period; i++) {
            const change = prices[i-1] - prices[i];
            if (change > 0) gains += change;
            else losses -= change;
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        return {
            value: rsi.toFixed(2),
            signal: rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : 'neutral',
            trend: rsi > 50 ? 'bullish' : 'bearish'
        };
    }

    calculateMACD(prices) {
        const ema12 = this.exponentialMovingAverage(prices, 12);
        const ema26 = this.exponentialMovingAverage(prices, 26);
        const macdLine = ema12 - ema26;
        
        return {
            value: macdLine.toFixed(6),
            signal: macdLine > 0 ? 'bullish' : 'bearish',
            crossover: macdLine > 0 ? 'above_zero' : 'below_zero',
            trend: macdLine > 0 ? 'uptrend' : 'downtrend'
        };
    }

    calculateMFI(highs, lows, closes, volumes, period = 14) {
        if (closes.length < period + 1) return { value: 50, signal: 'neutral', flow: 'neutral' };
        
        let positiveFlow = 0;
        let negativeFlow = 0;
        
        for (let i = 1; i <= period; i++) {
            const typicalPrice = (highs[i-1] + lows[i-1] + closes[i-1]) / 3;
            const prevTypicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
            const rawMoneyFlow = typicalPrice * volumes[i-1];
            
            if (typicalPrice > prevTypicalPrice) {
                positiveFlow += rawMoneyFlow;
            } else {
                negativeFlow += rawMoneyFlow;
            }
        }
        
        const mfi = 100 - (100 / (1 + (positiveFlow / negativeFlow)));
        
        return {
            value: mfi.toFixed(2),
            signal: mfi > 80 ? 'overbought' : mfi < 20 ? 'oversold' : 'neutral',
            flow: positiveFlow > negativeFlow ? 'positive' : 'negative'
        };
    }

    calculateSupportResistance(highs, lows) {
        const sortedHighs = [...highs].sort((a, b) => b - a);
        const sortedLows = [...lows].sort((a, b) => a - b);
        
        return {
            resistance1: sortedHighs[0],
            resistance2: sortedHighs[1],
            support1: sortedLows[0],
            support2: sortedLows[1]
        };
    }

    calculateEntryPoint(prices, volumes) {
        const currentPrice = prices[0];
        const avgPrice = prices.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
        const avgVolume = volumes.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
        const recentVolume = volumes[0];
        
        // تعديل نقطة الدخول بناءً على حالة السوق
        let volumeMultiplier = 0.995;
        
        switch (this.marketCondition) {
            case 'bull':
                volumeMultiplier = recentVolume > avgVolume * 1.2 ? 1.002 : 1.001; // شراء أعلى قليلاً في السوق الصاعد
                break;
            case 'bear':
                volumeMultiplier = recentVolume > avgVolume * 1.5 ? 0.985 : 0.990; // انتظار انخفاض أكبر في السوق الهابط
                break;
            case 'sideways':
                volumeMultiplier = recentVolume > avgVolume * 1.2 ? 0.995 : 0.998;
                break;
        }
        
        const entryPrice = currentPrice * volumeMultiplier;
        
        return {
            price: entryPrice.toFixed(6),
            confidence: recentVolume > avgVolume * 1.5 ? 'high' : 'medium'
        };
    }

    calculateStopLoss(prices) {
        const currentPrice = prices[0];
        const recentLow = Math.min(...prices.slice(0, 7));
        
        // تعديل وقف الخسارة بناءً على حالة السوق
        let stopLossMultiplier = 0.95;
        
        switch (this.marketCondition) {
            case 'bull':
                stopLossMultiplier = 0.92; // وقف خسارة أوسع في السوق الصاعد
                break;
            case 'bear':
                stopLossMultiplier = 0.97; // وقف خسارة أضيق في السوق الهابط
                break;
            case 'sideways':
                stopLossMultiplier = 0.95;
                break;
        }
        
        const stopLoss = Math.min(currentPrice * stopLossMultiplier, recentLow * 0.98);
        
        return {
            price: stopLoss.toFixed(6),
            percentage: (((currentPrice - stopLoss) / currentPrice) * 100).toFixed(2)
        };
    }

    simpleMovingAverage(prices, period) {
        if (prices.length < period) return prices[0];
        return prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    }

    exponentialMovingAverage(prices, period) {
        if (prices.length < period) return prices[0];
        
        const multiplier = 2 / (period + 1);
        let ema = prices[period - 1];
        
        for (let i = period - 2; i >= 0; i--) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
        }
        
        return ema;
    }

    assignRanks() {
        this.coins.forEach((coin, index) => {
            coin.rank = index + 1;
        });
    }

    updateMarketTrend() {
        const topCoins = this.coins.slice(0, 20);
        const bullishCount = topCoins.filter(coin => 
            coin.analysis.rsi.trend === 'bullish' &&
            coin.analysis.macd.signal === 'bullish'
        ).length;
        
        if (bullishCount > 12) {
            this.marketTrend = 'bullish';
        } else if (bullishCount < 8) {
            this.marketTrend = 'bearish';
        } else {
            this.marketTrend = 'neutral';
        }
        
        const marketStatus = document.getElementById('marketStatus');
        marketStatus.className = `market-indicator ${this.marketTrend}`;
        
        const statusText = {
            bullish: `السوق في اتجاه صاعد 📈 (${this.marketCondition.toUpperCase()})`,
            bearish: `السوق في اتجاه هابط 📉 (${this.marketCondition.toUpperCase()})`,
            neutral: `السوق في حالة تذبذب ⚖️ (${this.marketCondition.toUpperCase()})`
        };
        
        marketStatus.textContent = statusText[this.marketTrend];
    }

    filterCoins() {
        if (this.currentFilter === 'all') {
            this.filteredCoins = this.coins;
        } else {
            const minScore = parseInt(this.currentFilter);
            this.filteredCoins = this.coins.filter(coin => coin.score >= minScore);
        }
        
        this.renderCoins();
    }

    renderCoins() {
        const grid = document.getElementById('coinsGrid');
        grid.innerHTML = '';
        
        if (this.filteredCoins.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 50px;">
                    <i class="fas fa-search" style="font-size: 3rem; opacity: 0.3; margin-bottom: 20px;"></i>
                    <p style="font-size: 1.2rem; opacity: 0.7;">لا توجد عملات تطابق المعايير المحددة</p>
                    <p style="font-size: 1rem; opacity: 0.5;">جاري البحث عن فرص أفضل في السوق ${this.getMarketConditionArabic()}</p>
                </div>
            `;
            return;
        }
        
        this.filteredCoins.forEach((coin, index) => {
            const card = this.createCoinCard(coin, index);
            grid.appendChild(card);
        });
    }

    getMarketConditionArabic() {
        const conditions = {
            'bull': 'الصاعد',
            'bear': 'الهابط',
            'sideways': 'المتذبذب'
        };
        return conditions[this.marketCondition] || 'المختلط';
    }

    createCoinCard(coin, index) {
        const card = document.createElement('div');
        card.className = 'coin-card';
        card.style.animationDelay = `${index * 0.1}s`;
        
        const changeClass = coin.change24h >= 0 ? 'price-positive' : 'price-negative';
        const changeIcon = coin.change24h >= 0

        const changeIcon = coin.change24h >= 0 ? '📈' : '📉';
        
        // تحديد نوع التوصية بناءً على حالة السوق
        let recommendationText = '';
        let recommendationClass = '';
        
        if (this.marketCondition === 'bear' && coin.analysis.bearishAnalysis) {
            const rec = this.getBearishRecommendation(
                coin.analysis.bearishAnalysis.supportDistance,
                coin.analysis.bearishAnalysis.supportStrength,
                coin.analysis.bearishAnalysis.bounceProb
            );
            
            switch (rec) {
                case 'strong_buy_dip':
                    recommendationText = 'شراء قوي عند الانخفاض 🎯';
                    recommendationClass = 'recommendation-strong-buy';
                    break;
                case 'moderate_buy_dip':
                    recommendationText = 'شراء متوسط عند الانخفاض 📊';
                    recommendationClass = 'recommendation-moderate-buy';
                    break;
                default:
                    recommendationText = 'انتظار نقطة دخول أفضل ⏳';
                    recommendationClass = 'recommendation-wait';
            }
        } else if (this.marketCondition === 'bull' && coin.analysis.bullishAnalysis) {
            const rec = this.getBullishRecommendation(
                coin.analysis.bullishAnalysis.momentum,
                coin.analysis.bullishAnalysis.volumeConfirmation,
                coin.analysis.bullishAnalysis.breakoutPotential
            );
            
            switch (rec) {
                case 'strong_momentum_buy':
                    recommendationText = 'شراء زخم قوي 🚀';
                    recommendationClass = 'recommendation-strong-buy';
                    break;
                case 'moderate_momentum_buy':
                    recommendationText = 'شراء زخم متوسط 📈';
                    recommendationClass = 'recommendation-moderate-buy';
                    break;
                default:
                    recommendationText = 'انتظار تأكيد الاتجاه ⏳';
                    recommendationClass = 'recommendation-wait';
            }
        } else if (this.marketCondition === 'sideways' && coin.analysis.sidewaysAnalysis) {
            const rec = this.getSidewaysRecommendation(
                coin.analysis.sidewaysAnalysis.rangePosition,
                coin.analysis.sidewaysAnalysis.breakoutDirection
            );
            
            switch (rec) {
                case 'range_bottom_buy':
                    recommendationText = 'شراء من قاع النطاق 🎯';
                    recommendationClass = 'recommendation-strong-buy';
                    break;
                case 'moderate_range_buy':
                    recommendationText = 'شراء متوسط في النطاق 📊';
                    recommendationClass = 'recommendation-moderate-buy';
                    break;
                default:
                    recommendationText = 'انتظار كسر النطاق ⏳';
                    recommendationClass = 'recommendation-wait';
            }
        } else {
            // التوصية العامة
            if (coin.score >= 80) {
                recommendationText = 'فرصة ممتازة 🌟';
                recommendationClass = 'recommendation-strong-buy';
            } else if (coin.score >= 60) {
                recommendationText = 'فرصة جيدة 👍';
                recommendationClass = 'recommendation-moderate-buy';
            } else {
                recommendationText = 'مراقبة 👀';
                recommendationClass = 'recommendation-watch';
            }
        }

        card.innerHTML = `
            <div class="coin-header">
                <div class="coin-info">
                    <h3>${coin.symbol}</h3>
                    <span class="rank">#${coin.rank}</span>
                </div>
                <div class="score-badge score-${this.getScoreClass(coin.score)}">
                    ${coin.score}
                </div>
            </div>
            
            <div class="price-info">
                <div class="current-price">$${parseFloat(coin.price).toFixed(6)}</div>
                <div class="${changeClass}">
                    ${changeIcon} ${coin.change24h.toFixed(2)}%
                </div>
            </div>
            
            <div class="recommendation ${recommendationClass}">
                ${recommendationText}
            </div>
            
            <div class="market-context">
                <small>تحليل السوق ${this.getMarketConditionArabic()}</small>
            </div>
            
            <div class="analysis-summary">
                ${this.createAnalysisSummary(coin.analysis)}
            </div>
            
            <div class="trading-info">
                <div class="entry-point">
                    <span>نقطة الدخول:</span>
                    <span class="value">$${coin.analysis.entryPoint.price}</span>
                </div>
                <div class="stop-loss">
                    <span>وقف الخسارة:</span>
                    <span class="value">$${coin.analysis.stopLoss.price}</span>
                </div>
            </div>
            
            <div class="volume-info">
                <div class="volume-24h">
                    <span>الحجم 24س:</span>
                    <span class="value">$${this.formatNumber(coin.vol24h)}</span>
                </div>
                <div class="liquidity-flow">
                    <span>تدفق السيولة:</span>
                    <span class="value ${coin.analysis.liquidityFlow.trend === 'increasing' ? 'positive' : 'negative'}">
                        ${coin.analysis.liquidityFlow.percentage}%
                    </span>
                </div>
            </div>
            
            <div class="indicators-grid">
                ${this.createIndicatorsGrid(coin.analysis)}
            </div>
            
            <div class="market-specific-analysis">
                ${this.createMarketSpecificAnalysis(coin.analysis)}
            </div>
            
            <button class="details-btn" onclick="detector.showCoinDetails('${coin.symbol}')">
                تفاصيل أكثر
            </button>
        `;
        
        return card;
    }

    createAnalysisSummary(analysis) {
        const indicators = [
            { name: 'RSI', value: analysis.rsi.value, signal: analysis.rsi.signal },
            { name: 'MACD', signal: analysis.macd.signal },
            { name: 'MA', signal: analysis.movingAverages.signal },
            { name: 'MFI', value: analysis.moneyFlowIndex.value, flow: analysis.moneyFlowIndex.flow }
        ];
        
        return indicators.map(ind => {
            const status = this.getIndicatorStatus(ind);
            return `<span class="indicator ${status.class}">${ind.name}: ${status.text}</span>`;
        }).join('');
    }

    createIndicatorsGrid(analysis) {
        return `
            <div class="indicator-item">
                <span class="indicator-name">RSI</span>
                <span class="indicator-value ${analysis.rsi.signal}">${analysis.rsi.value}</span>
            </div>
            <div class="indicator-item">
                <span class="indicator-name">MACD</span>
                <span class="indicator-value ${analysis.macd.signal}">${analysis.macd.signal === 'bullish' ? '📈' : '📉'}</span>
            </div>
            <div class="indicator-item">
                <span class="indicator-name">حجم</span>
                <span class="indicator-value ${analysis.buyingPower.strength}">${analysis.buyingPower.strength}</span>
            </div>
            <div class="indicator-item">
                <span class="indicator-name">اتجاه</span>
                <span class="indicator-value ${analysis.movingAverages.signal}">${analysis.movingAverages.signal === 'buy' ? '🔼' : '🔽'}</span>
            </div>
        `;
    }

    createMarketSpecificAnalysis(analysis) {
        let content = '';
        
        if (this.marketCondition === 'bear' && analysis.bearishAnalysis) {
            content = `
                <div class="market-analysis bearish">
                    <h4>تحليل السوق الهابط</h4>
                    <div class="analysis-item">
                        <span>قوة الدعم:</span>
                        <span class="${analysis.bearishAnalysis.supportStrength}">${analysis.bearishAnalysis.supportStrength}</span>
                    </div>
                    <div class="analysis-item">
                        <span>المسافة من الدعم:</span>
                        <span>${analysis.bearishAnalysis.supportDistance}%</span>
                    </div>
                    <div class="analysis-item">
                        <span>احتمالية الارتداد:</span>
                        <span class="${analysis.bearishAnalysis.bounceProb}">${analysis.bearishAnalysis.bounceProb}</span>
                    </div>
                </div>
            `;
        } else if (this.marketCondition === 'bull' && analysis.bullishAnalysis) {
            content = `
                <div class="market-analysis bullish">
                    <h4>تحليل السوق الصاعد</h4>
                    <div class="analysis-item">
                        <span>قوة الزخم:</span>
                        <span>${analysis.bullishAnalysis.momentum.toFixed(2)}%</span>
                    </div>
                    <div class="analysis-item">
                        <span>تأكيد الحجم:</span>
                        <span class="${analysis.bullishAnalysis.volumeConfirmation}">${analysis.bullishAnalysis.volumeConfirmation}</span>
                    </div>
                    <div class="analysis-item">
                        <span>إمكانية الاختراق:</span>
                        <span class="${analysis.bullishAnalysis.breakoutPotential}">${analysis.bullishAnalysis.breakoutPotential}</span>
                    </div>
                </div>
            `;
        } else if (this.marketCondition === 'sideways' && analysis.sidewaysAnalysis) {
            content = `
                <div class="market-analysis sideways">
                    <h4>تحليل السوق المتذبذب</h4>
                    <div class="analysis-item">
                        <span>موقع في النطاق:</span>
                        <span>${analysis.sidewaysAnalysis.rangePosition}</span>
                    </div>
                    <div class="analysis-item">
                        <span>اتجاه الكسر المتوقع:</span>
                        <span class="${analysis.sidewaysAnalysis.breakoutDirection}">${analysis.sidewaysAnalysis.breakoutDirection}</span>
                    </div>
                    <div class="analysis-item">
                        <span>نطاق التداول:</span>
                        <span>${analysis.sidewaysAnalysis.tradingRange}%</span>
                    </div>
                </div>
            `;
        }
        
        return content;
    }

    getIndicatorStatus(indicator) {
        if (indicator.signal) {
            switch (indicator.signal) {
                case 'bullish':
                case 'buy':
                    return { class: 'positive', text: '🔼' };
                case 'bearish':
                case 'sell':
                    return { class: 'negative', text: '🔽' };
                case 'overbought':
                    return { class: 'warning', text: '⚠️' };
                case 'oversold':
                    return { class: 'opportunity', text: '💎' };
                default:
                    return { class: 'neutral', text: '➖' };
            }
        }
        
        if (indicator.flow) {
            return { class: indicator.flow === 'positive' ? 'positive' : 'negative', text: indicator.flow === 'positive' ? '💰' : '💸' };
        }
        
        return { class: 'neutral', text: '➖' };
    }

    getScoreClass(score) {
        if (score >= 80) return 'excellent';
        if (score >= 60) return 'good';
        if (score >= 40) return 'average';
        return 'poor';
    }

    formatNumber(num) {
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toFixed(2);
    }

    showCoinDetails(symbol) {
        const coin = this.coins.find(c => c.symbol === symbol);
        if (!coin) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>${coin.symbol} - تحليل مفصل</h2>
                    <button class="close-btn" onclick="this.parentElement.parentElement.parentElement.remove()">×</button>
                </div>
                <div class="modal-body">
                    ${this.createDetailedAnalysis(coin)}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    createDetailedAnalysis(coin) {
        return `
            <div class="detailed-analysis">
                <div class="analysis-section">
                    <h3>معلومات السعر</h3>
                    <div class="price-details">
                        <div class="detail-item">
                            <span>السعر الحالي:</span>
                            <span>$${parseFloat(coin.price).toFixed(6)}</span>
                        </div>
                        <div class="detail-item">
                            <span>التغيير 24 ساعة:</span>
                            <span class="${coin.change24h >= 0 ? 'positive' : 'negative'}">${coin.change24h.toFixed(2)}%</span>
                        </div>
                        <div class="detail-item">
                            <span>الحجم 24 ساعة:</span>
                            <span>$${this.formatNumber(coin.vol24h)}</span>
                        </div>
                    </div>
                </div>
                
                <div class="analysis-section">
                    <h3>المؤشرات الفنية</h3>
                    <div class="indicators-details">
                        <div class="indicator-detail">
                            <h4>RSI (${coin.analysis.rsi.value})</h4>
                            <p>الاتجاه: ${coin.analysis.rsi.trend === 'bullish' ? 'صاعد 📈' : 'هابط 📉'}</p>
                            <p>الإشارة: ${this.getRSISignalText(coin.analysis.rsi.signal)}</p>
                        </div>
                        
                        <div class="indicator-detail">
                            <h4>MACD</h4>
                            <p>القيمة: ${coin.analysis.macd.value}</p>
                            <p>الإشارة: ${coin.analysis.macd.signal === 'bullish' ? 'صاعدة 🔼' : 'هابطة 🔽'}</p>
                            <p>الاتجاه: ${coin.analysis.macd.trend === 'uptrend' ? 'اتجاه صاعد' : 'اتجاه هابط'}</p>
                        </div>
                        
                        <div class="indicator-detail">
                            <h4>المتوسطات المتحركة</h4>
                            <p>MA7: $${coin.analysis.movingAverages.ma7}</p>
                            <p>MA25: $${coin.analysis.movingAverages.ma25}</p>
                            <p>التقاطع: ${coin.analysis.movingAverages.crossover === 'bullish' ? 'صاعد 📈' : 'هابط 📉'}</p>
                            <p>السعر فوق المتوسطات: ${coin.analysis.movingAverages.priceAboveMA ? 'نعم ✅' : 'لا ❌'}</p>
                        </div>
                        
                        <div class="indicator-detail">
                            <h4>مؤشر تدفق الأموال (MFI)</h4>
                            <p>القيمة: ${coin.analysis.moneyFlowIndex.value}</p>
                            <p>التدفق: ${coin.analysis.moneyFlowIndex.flow === 'positive' ? 'إيجابي 💰' : 'سلبي 💸'}</p>
                            <p>الإشارة: ${this.getMFISignalText(coin.analysis.moneyFlowIndex.signal)}</p>
                        </div>
                    </div>
                </div>
                
                <div class="analysis-section">
                    <h3>تحليل السيولة والحجم</h3>
                    <div class="liquidity-details">
                        <div class="detail-item">
                            <span>تدفق السيولة:</span>
                            <span class="${coin.analysis.liquidityFlow.trend === 'increasing' ? 'positive' : 'negative'}">
                                ${coin.analysis.liquidityFlow.percentage}% (${coin.analysis.liquidityFlow.trend === 'increasing' ? 'متزايد' : 'متناقص'})
                            </span>
                        </div>
                        <div class="detail-item">
                            <span>القوة الشرائية:</span>
                            <span class="${coin.analysis.buyingPower.strength}">
                                ${this.getBuyingPowerText(coin.analysis.buyingPower.strength)} (${coin.analysis.buyingPower.percentage}%)
                            </span>
                        </div>
                        <div class="detail-item">
                            <span>التراكم/التوزيع:</span>
                            <span class="${coin.analysis.accumulationDistribution.trend}">
                                ${coin.analysis.accumulationDistribution.trend === 'accumulation' ? 'تراكم 📈' : 'توزيع 📉'} (${coin.analysis.accumulationDistribution.percentage}%)
                            </span>
                        </div>
                    </div>
                </div>
                
                <div class="analysis-section">
                    <h3>مستويات الدعم والمقاومة</h3>
                    <div class="support-resistance">
                        <div class="level-item resistance">
                            <span>مقاومة 1:</span>
                            <span>$${coin.analysis.supportResistance.resistance1.toFixed(6)}</span>
                        </div>
                        <div class="level-item resistance">
                            <span>مقاومة 2:</span>
                            <span>$${coin.analysis.supportResistance.resistance2.toFixed(6)}</span>
                        </div>
                        <div class="level-item support">
                            <span>دعم 1:</span>
                            <span>$${coin.analysis.supportResistance.support1.toFixed(6)}</span>
                        </div>
                        <div class="level-item support">
                            <span>دعم 2:</span>
                            <span>$${coin.analysis.supportResistance.support2.toFixed(6)}</span>
                        </div>
                    </div>
                </div>
                
                <div class="analysis-section">
                    <h3>استراتيجية التداول</h3>
                    <div class="trading-strategy">
                        <div class="strategy-item entry">
                            <h4>نقطة الدخول المقترحة</h4>
                            <p>السعر: $${coin.analysis.entryPoint.price}</p>
                            <p>الثقة: ${coin.analysis.entryPoint.confidence === 'high' ? 'عالية 🎯' : 'متوسطة 📊'}</p>
                        </div>
                        
                        <div class="strategy-item stop-loss">
                            <h4>وقف الخسارة</h4>
                            <p>السعر: $${coin.analysis.stopLoss.price}</p>
                            <p>النسبة: ${coin.analysis.stopLoss.percentage}%</p>
                        </div>
                        
                        <div class="strategy-item score">
                            <h4>النقاط الإجمالية</h4>
                            <p class="score-display score-${this.getScoreClass(coin.score)}">${coin.score}/100</p>
                            <p>${this.getScoreDescription(coin.score)}</p>
                        </div>
                    </div>
                </div>
                
                ${this.createDetailedMarketAnalysis(coin.analysis)}
                
                <div class="analysis-section">
                    <h3>تحذيرات ونصائح</h3>
                    <div class="warnings-tips">
                        ${this.generateWarningsAndTips(coin)}
                    </div>
                </div>
            </div>
        `;
    }

    createDetailedMarketAnalysis(analysis) {
        let content = '<div class="analysis-section"><h3>تحليل حالة السوق الحالية</h3>';
        
        if (this.marketCondition === 'bear' && analysis.bearishAnalysis) {
            content += `
                <div class="market-analysis-detailed bearish">
                    <h4>🐻 تحليل السوق الهابط</h4>
                    <div class="analysis-grid">
                        <div class="analysis-item">
                            <span>قوة الدعم:</span>
                            <span class="value ${analysis.bearishAnalysis.supportStrength}">
                                ${this.getSupportStrengthText(analysis.bearishAnalysis.supportStrength)}
                            </span>
                        </div>
                        <div class="analysis-item">
                            <span>المسافة من الدعم:</span>
                            <span class="value">${analysis.bearishAnalysis.supportDistance}%</span>
                        </div>
                        <div class="analysis-item">
                            <span>احتمالية الارتداد:</span>
                            <span class="value ${analysis.bearishAnalysis.bounceProb}">
                                ${this.getBounceProbText(analysis.bearishAnalysis.bounceProb)}
                            </span>
                        </div>
                        <div class="analysis-item">
                            <span>مخالفة اتجاه السوق:</span>
                            <span class="value ${analysis.bearishAnalysis.marketDivergence}">
                                ${this.getMarketDivergenceText(analysis.bearishAnalysis.marketDivergence)}
                            </span>
                        </div>
                    </div>
                    <div class="strategy-note">
                        <p><strong>استراتيجية السوق الهابط:</strong> التركيز على الشراء عند مستويات الدعم القوية مع وقف خسارة ضيق.</p>
                    </div>
                </div>
            `;
        } else if (this.marketCondition === 'bull' && analysis.bullishAnalysis) {
            content += `
                <div class="market-analysis-detailed bullish">
                    <h4>🐂 تحليل السوق الصاعد</h4>
                    <div class="analysis-grid">
                        <div class="analysis-item">
                            <span>قوة الزخم:</span>
                            <span class="value">${analysis.bullishAnalysis.momentum.toFixed(2)}%</span>
                        </div>
                        <div class="analysis-item">
                            <span>تأكيد الحجم:</span>
                            <span class="value ${analysis.bullishAnalysis.volumeConfirmation}">
                                ${this.getVolumeConfirmationText(analysis.bullishAnalysis.volumeConfirmation)}
                            </span>
                        </div>
                        <div class="analysis-item">
                            <span>إمكانية الاختراق:</span>
                            <span class="value ${analysis.bullishAnalysis.breakoutPotential}">
                                ${this.getBreakoutPotentialText(analysis.bullishAnalysis.breakoutPotential)}
                            </span>
                        </div>
                        <div class="analysis-item">
                            <span>قوة الاتجاه:</span>
                            <span class="value ${analysis.bullishAnalysis.trendStrength}">
                                ${this.getTrendStrengthText(analysis.bullishAnalysis.trendStrength)}
                            </span>
                        </div>
                    </div>
                    <div class="strategy-note">
                        <p><strong>استراتيجية السوق الصاعد:</strong> الاستفادة من الزخم مع مراقبة مستويات المقاومة للخروج المربح.</p>
                    </div>
                </div>
            `;
        } else if (this.marketCondition === 'sideways' && analysis.sidewaysAnalysis) {
            content += `
                <div class="market-analysis-detailed sideways">
                    <h4>⚖️ تحليل السوق المتذبذب</h4>
                    <div class="analysis-grid">
                        <div class="analysis-item">
                            <span>موقع في النطاق:</span>
                            <span class="value">${this.getRangePositionText(analysis.sidewaysAnalysis.rangePosition)}</span>
                        </div>
                        <div class="analysis-item">
                            <span>نطاق التداول:</span>
                            <span class="value">${analysis.sidewaysAnalysis.tradingRange}%</span>
                        </div>
                        <div class="analysis-item">
                            <span>اتجاه الكسر المتوقع:</span>
                            <span class="value ${analysis.sidewaysAnalysis.breakoutDirection}">
                                ${this.getBreakoutDirectionText(analysis.sidewaysAnalysis.breakoutDirection)}
                            </span>
                        </div>
                    </div>
                    <div class="strategy-note">
                        <p><strong>استراتيجية السوق المتذبذب:</strong> التداول ضمن النطاق أو انتظار كسر واضح للنطاق.</p>
                    </div>
                </div>
            `;
        }
        
        content += '</div>';
        return content;
    }

    generateWarningsAndTips(coin) {
        const warnings = [];
        const tips = [];
        
        // تحذيرات عامة
        if (coin.analysis.rsi.signal === 'overbought') {
            warnings.push('⚠️ المؤشر RSI يشير إلى تشبع شرائي - احذر من التصحيح');
        }
        
        if (coin.analysis.moneyFlowIndex.signal === 'overbought') {
            warnings.push('⚠️ مؤشر تدفق الأموال يشير إلى تشبع شرائي');
        }
        
        if (coin.analysis.liquidityFlow.trend === 'decreasing') {
            warnings.push('⚠️ تدفق السيولة في انخفاض - قد يؤثر على الحركة');
        }
        
        // تحذيرات خاصة بحالة السوق
        if (this.marketCondition === 'bear') {
            warnings.push('🐻 السوق في حالة هبوط - استخدم إدارة مخاطر صارمة');
            tips.push('💡 في السوق الهابط، ركز على الشراء عند مستويات الدعم القوية');
        } else if (this.marketCondition === 'bull') {
            tips.push('🐂 السوق في حالة صعود - استفد من الزخم مع مراقبة نقاط الخروج');
        }
        
        // نصائح عامة
        if (coin.analysis.buyingPower.strength === 'high') {
            tips.push('💪 قوة شرائية عالية - إشارة إيجابية للاتجاه');
        }
        
        if (coin.analysis.accumulationDistribution.trend === 'accumulation') {
            tips.push('📈 يحدث تراكم في العملة - إشارة إيجابية طويلة المدى');
        }
        
        tips.push('📊 استخدم دائماً وقف الخسارة المقترح');
        tips.push('💰 لا تستثمر أكثر مما يمكنك تحمل خسارته');
        tips.push('📱 راقب السوق بانتظام وكن مستعداً للتكيف');
        
        let content = '';
        
        if (warnings.length > 0) {
            content += '<div class="warnings"><h4>تحذيرات مهمة:</h4><ul>';
            warnings.forEach(
            warnings.forEach(warning => {
                content += `<li class="warning-item">${warning}</li>`;
            });
            content += '</ul></div>';
        }
        
        if (tips.length > 0) {
            content += '<div class="tips"><h4>نصائح وتوصيات:</h4><ul>';
            tips.forEach(tip => {
                content += `<li class="tip-item">${tip}</li>`;
            });
            content += '</ul></div>';
        }
        
        return content;
    }

    // دوال مساعدة للنصوص
    getRSISignalText(signal) {
        const signals = {
            'overbought': 'تشبع شرائي ⚠️',
            'oversold': 'تشبع بيعي 💎',
            'neutral': 'محايد ➖'
        };
        return signals[signal] || signal;
    }

    getMFISignalText(signal) {
        const signals = {
            'overbought': 'تشبع شرائي ⚠️',
            'oversold': 'تشبع بيعي 💎',
            'neutral': 'محايد ➖'
        };
        return signals[signal] || signal;
    }

    getBuyingPowerText(strength) {
        const strengths = {
            'high': 'قوية جداً 💪',
            'medium': 'متوسطة 📊',
            'low': 'ضعيفة 📉'
        };
        return strengths[strength] || strength;
    }

    getSupportStrengthText(strength) {
        const strengths = {
            'strong': 'قوي جداً 🛡️',
            'medium': 'متوسط 📊',
            'weak': 'ضعيف ⚠️'
        };
        return strengths[strength] || strength;
    }

    getBounceProbText(prob) {
        const probs = {
            'high': 'عالية 🎯',
            'medium': 'متوسطة 📊',
            'low': 'منخفضة ⚠️'
        };
        return probs[prob] || prob;
    }

    getMarketDivergenceText(divergence) {
        const divergences = {
            'positive': 'إيجابية 📈',
            'negative': 'سلبية 📉',
            'neutral': 'محايدة ➖'
        };
        return divergences[divergence] || divergence;
    }

    getVolumeConfirmationText(confirmation) {
        const confirmations = {
            'strong': 'قوي 💪',
            'medium': 'متوسط 📊',
            'weak': 'ضعيف ⚠️'
        };
        return confirmations[confirmation] || confirmation;
    }

    getBreakoutPotentialText(potential) {
        const potentials = {
            'high': 'عالي 🚀',
            'medium': 'متوسط 📊',
            'low': 'منخفض 📉'
        };
        return potentials[potential] || potential;
    }

    getTrendStrengthText(strength) {
        const strengths = {
            'strong': 'قوي 💪',
            'medium': 'متوسط 📊',
            'weak': 'ضعيف 📉'
        };
        return strengths[strength] || strength;
    }

    getRangePositionText(position) {
        const positions = {
            'bottom': 'قاع النطاق 🎯',
            'middle-low': 'أسفل الوسط 📊',
            'middle': 'وسط النطاق ➖',
            'middle-high': 'أعلى الوسط 📈',
            'top': 'قمة النطاق ⚠️'
        };
        return positions[position] || position;
    }

    getBreakoutDirectionText(direction) {
        const directions = {
            'upward': 'صاعد 📈',
            'downward': 'هابط 📉',
            'neutral': 'غير محدد ➖'
        };
        return directions[direction] || direction;
    }

    getScoreDescription(score) {
        if (score >= 90) return 'فرصة استثنائية - إشارات قوية جداً 🌟';
        if (score >= 80) return 'فرصة ممتازة - إشارات إيجابية قوية 🎯';
        if (score >= 70) return 'فرصة جيدة جداً - إشارات إيجابية 📈';
        if (score >= 60) return 'فرصة جيدة - إشارات متوسطة 👍';
        if (score >= 50) return 'فرصة متوسطة - مراقبة مطلوبة 📊';
        if (score >= 40) return 'فرصة ضعيفة - حذر مطلوب ⚠️';
        return 'فرصة ضعيفة جداً - تجنب حالياً ❌';
    }

    // دوال إدارة الفلاتر والإعدادات
    setFilter(filter) {
        this.currentFilter = filter;
        
        // تحديث أزرار الفلتر
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[onclick="detector.setFilter('${filter}')"]`).classList.add('active');
        
        this.filterCoins();
    }

    setMarketCondition(condition) {
        this.marketCondition = condition;
        
        // تحديث أزرار حالة السوق
        document.querySelectorAll('.market-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[onclick="detector.setMarketCondition('${condition}')"]`).classList.add('active');
        
        // إعادة تحليل العملات مع الحالة الجديدة
        this.analyzeCoins();
        this.updateMarketTrend();
        this.renderCoins();
        
        // إظهار رسالة تأكيد
        this.showNotification(`تم تحديث تحليل السوق إلى: ${this.getMarketConditionArabic()}`, 'success');
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // إزالة الإشعار تلقائياً بعد 5 ثوان
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }

    // دالة التحديث التلقائي
    startAutoRefresh() {
        this.autoRefreshInterval = setInterval(() => {
            this.fetchData();
        }, 60000); // تحديث كل دقيقة
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }

    // دالة إدارة الأخطاء المحسنة
    handleError(error, context = '') {
        console.error(`خطأ في ${context}:`, error);
        
        const errorMessage = this.getErrorMessage(error);
        this.showNotification(`خطأ: ${errorMessage}`, 'error');
        
        // إخفاء مؤشر التحميل
        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.style.display = 'none';
        }
        
        // إظهار رسالة خطأ في الشبكة
        const grid = document.getElementById('coinsGrid');
        if (grid && grid.children.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 50px;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #ff6b6b; margin-bottom: 20px;"></i>
                    <h3 style="color: #ff6b6b; margin-bottom: 10px;">حدث خطأ في تحميل البيانات</h3>
                    <p style="opacity: 0.7; margin-bottom: 20px;">${errorMessage}</p>
                    <button onclick="detector.fetchData()" class="retry-btn">
                        <i class="fas fa-redo"></i> إعادة المحاولة
                    </button>
                </div>
            `;
        }
    }

    getErrorMessage(error) {
        if (error.message.includes('fetch')) {
            return 'مشكلة في الاتصال بالإنترنت';
        } else if (error.message.includes('JSON')) {
            return 'خطأ في تحليل البيانات';
        } else if (error.message.includes('rate limit')) {
            return 'تم تجاوز حد الطلبات، يرجى المحاولة لاحقاً';
        } else {
            return 'خطأ غير متوقع، يرجى المحاولة مرة أخرى';
        }
    }

    // دالة حفظ الإعدادات
    saveSettings() {
        const settings = {
            marketCondition: this.marketCondition,
            currentFilter: this.currentFilter,
            autoRefresh: !!this.autoRefreshInterval
        };
        
        localStorage.setItem('cryptoPumpDetectorSettings', JSON.stringify(settings));
    }

    // دالة تحميل الإعدادات
    loadSettings() {
        const savedSettings = localStorage.getItem('cryptoPumpDetectorSettings');
        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);
                this.marketCondition = settings.marketCondition || 'bull';
                this.currentFilter = settings.currentFilter || 'all';
                
                // تطبيق الإعدادات على الواجهة
                this.setMarketCondition(this.marketCondition);
                this.setFilter(this.currentFilter);
                
                if (settings.autoRefresh) {
                    this.startAutoRefresh();
                }
            } catch (error) {
                console.warn('خطأ في تحميل الإعدادات المحفوظة:', error);
            }
        }
    }

    // دالة التنظيف عند إغلاق الصفحة
    cleanup() {
        this.stopAutoRefresh();
        this.saveSettings();
    }
}

// إنشاء مثيل من الكاشف
const detector = new CryptoPumpDetector();

// بدء التطبيق عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    detector.loadSettings();
    detector.fetchData();
    detector.startAutoRefresh();
});

// حفظ الإعدادات عند إغلاق الصفحة
window.addEventListener('beforeunload', () => {
    detector.cleanup();
});

// إضافة مستمعي الأحداث للوحة المفاتيح
document.addEventListener('keydown', (event) => {
    // F5 أو Ctrl+R للتحديث
    if (event.key === 'F5' || (event.ctrlKey && event.key === 'r')) {
        event.preventDefault();
        detector.fetchData();
    }
    
    // Escape لإغلاق النوافذ المنبثقة
    if (event.key === 'Escape') {
        const modals = document.querySelectorAll('.modal-overlay');
        modals.forEach(modal => modal.remove());
    }
});

// إضافة دعم للشاشات اللمسية
let touchStartY = 0;
document.addEventListener('touchstart', (event) => {
    touchStartY = event.touches[0].clientY;
});

document.addEventListener('touchend', (event) => {
    const touchEndY = event.changedTouches[0].clientY;
    const diff = touchStartY - touchEndY;
    
    // إذا كان المستخدم يسحب لأسفل من أعلى الشاشة
    if (diff < -100 && touchStartY < 100) {
        detector.fetchData();
    }
});

// تصدير الكلاس للاستخدام في ملفات أخرى
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CryptoPumpDetector;
}

class CryptoPumpDetector {
    // ... كل الكود الموجود

    // أضف هذه الدوال في النهاية قبل إغلاق الكلاس
    async fetchCoinGeckoData() {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1');
        return await response.json();
    }

    toggleDataSource() {
        this.useOKX = !this.useOKX;
        this.showNotification(
            this.useOKX ? 'تم التبديل إلى OKX API' : 'تم التبديل إلى CoinGecko API',
            'info'
        );
        this.fetchData();
    }

    showRetryButton() {
        // دالة لإظهار زر إعادة المحاولة
        const retryBtn = document.createElement('button');
        retryBtn.textContent = 'إعادة المحاولة';
        retryBtn.onclick = () => this.fetchData();
        document.getElementById('coinsGrid').appendChild(retryBtn);
    }
} // إغلاق الكلاس
