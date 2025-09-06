const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const XLSX = require('xlsx');
const readline = require('readline');

class PortfolioHeatmapGenerator {
    constructor() {
        this.trades = [];
        this.periods = [];
        this.dailyRecords = [];
        this.inputFolder = 'trade log input';
        this.initialCapital = 10000;
        this.commissionRate = 0.0;
        this.positionSizeType = 'fixed'; // 'fixed' or 'percentage'
        this.positionSize = 100;
        this.binSizeInStdDev = 0.1;
        this.pnlDistributionDisplayRangeSD = 5;
        this.detectedPnlColumn = null;
        this.detectedDateColumn = null;
        this.metricProperties = {
            sharpeRatio: {
                displayName: 'Sharpe Ratio',
                higherIsBetter: true,
                format: v => v.toFixed(3),
                colorThresholds: [
                    { threshold: 2.0, color: '#1a9850', description: '極佳 (>= 2.0)' },
                    { threshold: 1.0, color: '#66bd63', description: '良好' },
                    { threshold: 0.5, color: '#a6d96a', description: '尚可' },
                    { threshold: 0.0, color: '#fee08b', description: '勉強' },
                    { threshold: -0.5, color: '#d73027', description: '不佳 (< 0.0)' }
                ],
                radarMax: 3.0
            },
            sortinoRatio: {
                displayName: 'Sortino Ratio',
                higherIsBetter: true,
                format: v => v.toFixed(3),
                colorThresholds: [
                    { threshold: 3.0, color: '#1a9850', description: '極佳 (>= 3.0)' },
                    { threshold: 2.0, color: '#66bd63', description: '良好' },
                    { threshold: 1.0, color: '#a6d96a', description: '尚可' },
                    { threshold: 0.0, color: '#fee08b', description: '勉強' },
                    { threshold: -1.0, color: '#d73027', description: '不佳 (< 0.0)' }
                ],
                radarMax: 4.0
            },
            calmarRatio: {
                displayName: 'Calmar Ratio',
                higherIsBetter: true,
                format: v => v.toFixed(3),
                colorThresholds: [
                    { threshold: 3.0, color: '#1a9850', description: '極佳 (>= 3.0)' },
                    { threshold: 1.0, color: '#66bd63', description: '良好' },
                    { threshold: 0.5, color: '#a6d96a', description: '尚可' },
                    { threshold: 0.0, color: '#fee08b', description: '勉強' },
                    { threshold: -1.0, color: '#d73027', description: '不佳 (< 0.0)' }
                ],
                radarMax: 4.0
            },
            mdd: {
                displayName: 'Max Drawdown (%)',
                higherIsBetter: false,
                format: v => v.toFixed(2),
                colorThresholds: [
                    { threshold: 5, color: '#1a9850', description: '極佳 (< 5%)' },
                    { threshold: 10, color: '#66bd63', description: '良好' },
                    { threshold: 20, color: '#a6d96a', description: '尚可' },
                    { threshold: 30, color: '#fee08b', description: '警告' },
                    { threshold: 50, color: '#d73027', description: '危險 (> 30%)' }
                ],
                radarMax: 50.0,
                radarInvert: true
            },
            winRate: {
                displayName: 'Win Rate (%)',
                higherIsBetter: true,
                format: v => v.toFixed(1),
                colorThresholds: [
                    { threshold: 65, color: '#1a9850', description: '極佳 (>= 65%)' },
                    { threshold: 55, color: '#66bd63', description: '良好' },
                    { threshold: 50, color: '#a6d96a', description: '尚可' },
                    { threshold: 45, color: '#fee08b', description: '勉強' },
                    { threshold: 40, color: '#d73027', description: '不佳 (< 45%)' }
                ],
                radarMax: 100.0
            },
            omegaRatio: {
                displayName: 'Omega Ratio',
                higherIsBetter: true,
                format: v => v.toFixed(3),
                colorThresholds: [
                    { threshold: 2.0, color: '#1a9850', description: '極佳 (>= 2.0)' },
                    { threshold: 1.5, color: '#66bd63', description: '良好' },
                    { threshold: 1.0, color: '#a6d96a', description: '尚可' },
                    { threshold: 0.8, color: '#fee08b', description: '勉強' },
                    { threshold: 0.5, color: '#d73027', description: '不佳 (< 0.8)' }
                ],
                radarMax: 3.0
            },
            var95: {
                displayName: 'VaR 95% (USD)',
                higherIsBetter: false,
                format: v => v.toFixed(2),
                colorThresholds: [
                    { threshold: -50, color: '#1a9850', description: '極佳 (> -50)' },
                    { threshold: -100, color: '#66bd63', description: '良好' },
                    { threshold: -200, color: '#a6d96a', description: '尚可' },
                    { threshold: -500, color: '#fee08b', description: '警告' },
                    { threshold: -1000, color: '#d73027', description: '危險 (< -500)' }
                ],
                radarMax: 1000.0,
                radarInvert: true
            },
            cvar95: {
                displayName: 'CVaR 95% (USD)',
                higherIsBetter: false,
                format: v => v.toFixed(2),
                colorThresholds: [
                    { threshold: -100, color: '#1a9850', description: '極佳 (> -100)' },
                    { threshold: -200, color: '#66bd63', description: '良好' },
                    { threshold: -400, color: '#a6d96a', description: '尚可' },
                    { threshold: -800, color: '#fee08b', description: '警告' },
                    { threshold: -1500, color: '#d73027', description: '危險 (< -800)' }
                ],
                radarMax: 1500.0,
                radarInvert: true
            },
            totalReturn: {
                displayName: 'Total Return (USD)',
                higherIsBetter: true,
                format: v => v.toFixed(2),
                colorThresholds: [
                    { threshold: 1000, color: '#1a9850', description: '極佳 (>= 1000)' },
                    { threshold: 500, color: '#66bd63', description: '良好' },
                    { threshold: 100, color: '#a6d96a', description: '尚可' },
                    { threshold: 0, color: '#fee08b', description: '持平' },
                    { threshold: -500, color: '#d73027', description: '不佳 (< 0)' }
                ],
                radarMax: 2000.0
            },
            annualReturn: {
                displayName: 'Annual Return (%)',
                higherIsBetter: true,
                format: v => v.toFixed(2),
                colorThresholds: [
                    { threshold: 50, color: '#1a9850', description: '極佳 (>= 50%)' },
                    { threshold: 20, color: '#66bd63', description: '良好' },
                    { threshold: 10, color: '#a6d96a', description: '尚可' },
                    { threshold: 0, color: '#fee08b', description: '持平' },
                    { threshold: -10, color: '#d73027', description: '不佳 (< 0%)' }
                ],
                radarMax: 100.0
            }
        };
        this.portfolioInfo = {
            name: "組合策略",
            strategyNames: new Set(),
            brokers: new Set(),
            platforms: new Set(),
            symbols: new Set(),
            sourceFiles: new Set(),
            tradingDateRange: ''
        };
    }

    hexToRgb(hex) {
        let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    interpolateColor(color1, color2, factor) {
        let result = {
            r: Math.round(color1.r + factor * (color2.r - color1.r)),
            g: Math.round(color1.g + factor * (color2.g - color1.g)),
            b: Math.round(color1.b + factor * (color2.b - color1.b)),
        };
        return `rgb(${result.r}, ${result.g}, ${result.b})`;
    }

    parseFileName(fileName) {
        try {
            const nameWithoutExt = path.basename(fileName, path.extname(fileName));
            const parts = nameWithoutExt.split('___');
            if (parts.length >= 2) {
                const strategyPart = parts[0];
                const detailsPart = parts[1];
                let strategyName = strategyPart.replace(/_/g, ' ');
                const platformParts = detailsPart.split('_');
                let platform = '', symbol = '', broker = '';
                const exchanges = ['BYBIT', 'BINANCE', 'OKX', 'BITGET', 'GATE', 'HUOBI', 'KUCOIN', 'BINGX'];
                const exchangeIndex = platformParts.findIndex(part =>
                    exchanges.some(ex => part.toUpperCase().includes(ex))
                );
                if (exchangeIndex >= 0) {
                    broker = platformParts.slice(0, exchangeIndex).join(' ');
                    platform = platformParts[exchangeIndex];
                    symbol = platformParts.slice(exchangeIndex + 1)
                        .join('_')
                        .replace(/_\d{4}-\d{2}-\d{2}$/, '');
                }
                return { originalName: fileName, strategyName, broker, platform, symbol, parsed: true };
            }
            return {
                originalName: fileName,
                strategyName: nameWithoutExt.replace(/_/g, ' '),
                broker: 'N/A',
                platform: 'N/A',
                symbol: 'N/A',
                parsed: false
            };
        } catch (error) {
            console.log(`⚠️  檔名解析失敗: ${error.message}`);
            return { originalName: fileName, strategyName: fileName, broker: 'N/A', platform: 'N/A', symbol: 'N/A', parsed: false };
        }
    }

    findAllFiles() {
        const inputPath = path.resolve(this.inputFolder);
        if (!fs.existsSync(inputPath)) throw new Error(`❌ 找不到 "${this.inputFolder}" 資料夾`);
        const files = fs.readdirSync(inputPath)
            .filter(file => (path.extname(file).toLowerCase() === '.csv' || path.extname(file).toLowerCase() === '.xlsx') && !file.startsWith('~'));
        if (files.length === 0) throw new Error(`❌ 在 "${this.inputFolder}" 中找不到任何 CSV 或 Excel 檔案`);
        console.log(`✅ 在 "${this.inputFolder}" 資料夾中找到 ${files.length} 個檔案:`);
        files.forEach(file => console.log(`   - ${file}`));
        return files.map(file => ({
            fileName: file,
            fullPath: path.join(inputPath, file),
            extension: path.extname(file).toLowerCase()
        }));
    }

    readCSV(filePath) {
        return new Promise((resolve, reject) => {
            const results = [];
            fs.createReadStream(filePath)
                .pipe(csv({ separator: '\t' }))
                .on('data', (data) => results.push(data))
                .on('end', () => resolve(results))
                .on('error', reject);
        });
    }

    async readExcel(filePath) {
        const workbook = XLSX.readFile(filePath);
        console.log(`📋 檔案中的工作表: ${workbook.SheetNames.join(', ')}`);

        let targetSheetName = null;
        const possibleNames = ['交易清單', '交易清单', 'Trade List', 'Trades', 'Trading List'];

        for (const sheetName of workbook.SheetNames) {
            if (possibleNames.some(name => sheetName.includes(name))) {
                targetSheetName = sheetName;
                break;
            }
        }

        if (!targetSheetName) {
            for (const sheetName of workbook.SheetNames) {
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                if (jsonData.length > 0) {
                    const headers = jsonData[0] || [];
                    const hasTradeColumns = headers.some(header =>
                        header && (
                            header.toString().includes('交易') ||
                            header.toString().includes('種類') ||
                            header.toString().toLowerCase().includes('p&l') ||
                            header.toString().includes('損益') ||
                            header.toString().includes('日期/時間')
                        )
                    );
                    if (hasTradeColumns) {
                        targetSheetName = sheetName;
                        console.log(`✅ 找到包含交易數據的工作表: ${targetSheetName}`);
                        break;
                    }
                }
            }
        }

        if (!targetSheetName) {
            targetSheetName = workbook.SheetNames[0];
            console.log(`⚠️ 未找到交易清單工作表，使用第一個工作表: ${targetSheetName}`);
        } else {
            console.log(`✅ 使用工作表: ${targetSheetName}`);
        }

        const worksheet = workbook.Sheets[targetSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '',
            raw: false
        });

        if (jsonData.length < 2) {
            console.log('⚠️ 工作表數據不足');
            return [];
        }

        const headers = jsonData[0];
        console.log(`📊 檢測到的欄位: ${headers.join(', ')}`);

        const trades = [];
        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            const trade = {};
            headers.forEach((header, index) => {
                if (header) {
                    const value = row[index] || '';
                    if (typeof value === 'string' && value.includes(',')) {
                        const potentialNumber = parseFloat(value.replace(/,/g, ''));
                        trade[header] = !isNaN(potentialNumber) ? potentialNumber : value;
                    } else {
                        trade[header] = value;
                    }
                }
            });
            if (trade['交易 #'] || trade['種類'] || trade['P&L USD'] || trade['P&L USDT']) {
                trades.push(trade);
            }
        }
        console.log(`✅ 成功解析 ${trades.length} 筆交易記錄`);
        return trades;
    }

    parseDateTime(dateStr) {
        if (!dateStr) return new Date('invalid');
        if (typeof dateStr === 'string') {
            if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                return new Date(dateStr);
            }
        }
        if (!isNaN(dateStr) && typeof dateStr === 'number') {
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            return new Date(excelEpoch.getTime() + parseFloat(dateStr) * 24 * 60 * 60 * 1000);
        }
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) return date;
        console.warn(`⚠️  無法解析日期格式: "${dateStr}"`);
        return new Date('invalid');
    }

    calculatePositionSize(currentEquity, tradeIndex) {
        if (this.positionSizeType === 'fixed') {
            return this.positionSize;
        } else {
            return currentEquity * (this.positionSize / 100);
        }
    }

    convertTradingViewPnLToActual(tvPnL, tvPnLPercent, positionSize) {
        if (tvPnLPercent && !isNaN(tvPnLPercent)) {
            const percentValue = parseFloat(String(tvPnLPercent).replace(/,/g, '')) || 0;
            return positionSize * (percentValue / 100);
        }
        if (this.positionSizeType === 'fixed') {
            const usdValue = parseFloat(String(tvPnL).replace(/,/g, '')) || 0;
            return usdValue;
        }
        return 0;
    }

    async autoReadAllFilesAndCombine() {
        const filesToProcess = this.findAllFiles();
        let allTrades = [];
        for (const file of filesToProcess) {
            try {
                console.log(`\n🔄 正在讀取檔案: ${file.fileName}...`);
                let tradesFromFile = [];
                if (file.extension === '.xlsx') {
                    tradesFromFile = await this.readExcel(file.fullPath);
                } else {
                    tradesFromFile = await this.readCSV(file.fullPath);
                }
                if (tradesFromFile.length > 0) {
                    console.log(`   - 成功讀取 ${tradesFromFile.length} 筆原始記錄。`);
                    const parsedInfo = this.parseFileName(file.fileName);
                    const exitTradesOnly = tradesFromFile.filter(trade => {
                        const tradeType = trade['種類'];
                        return tradeType && (
                            tradeType.includes('出場') ||
                            tradeType.includes('Close') ||
                            tradeType.includes('Exit') ||
                            tradeType.includes('Stop Loss') ||
                            tradeType.toLowerCase().includes('close')
                        );
                    });
                    console.log(`   - 過濾後，保留 ${exitTradesOnly.length} 筆出場交易。`);
                    const tradesWithInfo = exitTradesOnly.map(trade => ({
                        ...trade,
                        sourceFile: file.fileName,
                        strategyName: parsedInfo.strategyName,
                        broker: parsedInfo.broker,
                        platform: parsedInfo.platform,
                        symbol: parsedInfo.symbol
                    }));
                    allTrades.push(...tradesWithInfo);
                    this.portfolioInfo.strategyNames.add(parsedInfo.strategyName);
                    if (parsedInfo.broker) this.portfolioInfo.brokers.add(parsedInfo.broker);
                    if (parsedInfo.platform) this.portfolioInfo.platforms.add(parsedInfo.platform);
                    if (parsedInfo.symbol) this.portfolioInfo.symbols.add(parsedInfo.symbol);
                    this.portfolioInfo.sourceFiles.add(file.fileName);
                } else {
                    console.log(`   ⚠️ 檔案 ${file.fileName} 為空，已跳過。`);
                }
            } catch (error) {
                console.error(`❌ 讀取檔案 ${file.fileName} 失敗: ${error.message}`);
            }
        }
        if (allTrades.length === 0) {
            throw new Error("❌ 所有檔案都讀取失敗或為空，或過濾後沒有留下任何交易記錄。");
        }
        const firstTrade = allTrades[0];
        const dateColumns = Object.keys(firstTrade).filter(key =>
            ['date', 'time', 'timestamp', '日期', '時間', '日期/時間', 'created', 'open', 'close'].some(k =>
                key.toLowerCase().includes(k.toLowerCase())
            )
        );
        if (dateColumns.length === 0) {
            throw new Error('❌ 在交易數據中找不到日期欄位。');
        }
        this.detectedDateColumn = dateColumns[0];
        console.log(`\n📅 使用日期欄位進行排序: ${this.detectedDateColumn}`);
        this.trades = allTrades.map(trade => ({
            ...trade,
            parsedDate: this.parseDateTime(trade[this.detectedDateColumn])
        })).filter(trade => !isNaN(trade.parsedDate.getTime()));
        this.trades.sort((a, b) => a.parsedDate - b.parsedDate);
        const startDate = this.trades[0].parsedDate.toISOString().split('T')[0];
        const endDate = this.trades[this.trades.length - 1].parsedDate.toISOString().split('T')[0];
        this.portfolioInfo.tradingDateRange = `${startDate} ~ ${endDate}`;
        console.log(`\n📈 所有檔案合併完成！總共 ${this.trades.length} 筆交易紀錄。`);
        console.log(`📊 交易日期範圍: ${this.portfolioInfo.tradingDateRange}`);
    }

    calculatePeriods(periodType, periodLength) {
        if (!this.trades || this.trades.length === 0) throw new Error('❌ 沒有可分析的交易紀錄');
        const startDate = this.trades[0].parsedDate, endDate = this.trades[this.trades.length - 1].parsedDate;
        let intervalMs;
        switch (periodType.toLowerCase()) {
            case 'day': intervalMs = periodLength * 24 * 60 * 60 * 1000; break;
            case 'week': intervalMs = periodLength * 7 * 24 * 60 * 60 * 1000; break;
            case 'month': intervalMs = periodLength * 30 * 24 * 60 * 60 * 1000; break;
            default: throw new Error('❌ 不支援的週期類型');
        }
        const periods = [];
        let currentStart = new Date(startDate);
        let periodIndex = 1;
        while (currentStart <= endDate) {
            const currentEnd = new Date(currentStart.getTime() + intervalMs);
            const periodTrades = this.trades.filter(trade => trade.parsedDate >= currentStart && trade.parsedDate < currentEnd);
            if (periodTrades.length > 0) {
                periods.push({
                    index: periodIndex++,
                    startDate: new Date(currentStart),
                    endDate: new Date(currentEnd),
                    trades: periodTrades
                });
            }
            currentStart = currentEnd;
        }
        this.periods = periods;
        console.log(`\n📊 組合策略共分割為 ${periods.length} 個週期`);
        return periods;
    }

    // === 新增：建構日級序列 ===
    buildDailySeries(trades, initialCapital) {
        if (!trades || trades.length === 0) {
            return {
                dailyRecords: [],
                dailyReturnPctSeries: [],
                dailyReturnUSDSeries: [],
                totalTrades: 0,
                totalDays: 0,
                finalEquity: initialCapital
            };
        }
        let currentEquity = initialCapital;
        const dailyMap = new Map();
        const order = [];
        for (let i = 0; i < trades.length; i++) {
            const trade = trades[i];
            if (!this.detectedPnlColumn) {
                const pnlColumns = Object.keys(trade).filter(key =>
                    ['p&l', 'pnl', 'profit', 'return', '損益', '獲利', '盈虧', 'pl', 'net', 'realized']
                        .some(k => key.toLowerCase().includes(k.toLowerCase()))
                );
                if (pnlColumns.length === 0) throw new Error('❌ 找不到損益欄位');
                this.detectedPnlColumn = pnlColumns.find(col =>
                    col.includes('USD') || col.includes('USDT') || !col.includes('%')
                ) || pnlColumns[0];
                console.log(`💰 使用損益欄位: ${this.detectedPnlColumn}`);
            }
            const dateObj = trade.parsedDate;
            const dateKey = dateObj.toISOString().split('T')[0];
            const equityAtTradeStart = currentEquity;
            const positionSize = this.calculatePositionSize(equityAtTradeStart, i);
            const tvPnLUSD = parseFloat(String(trade[this.detectedPnlColumn] || '0').replace(/,/g, '')) || 0;
            const tvPnLPercent = parseFloat(String(trade['P&L %'] || '0').replace(/,/g, '')) || 0;
            let actualPnL;
            if (tvPnLPercent !== 0) {
                actualPnL = positionSize * (tvPnLPercent / 100);
            } else {
                if (this.positionSizeType === 'fixed') {
                    actualPnL = tvPnLUSD;
                } else {
                    actualPnL = 0;
                }
            }
            const commission = positionSize * this.commissionRate * 2;
            const netPnL = actualPnL - commission;
            currentEquity += netPnL;
            if (!dailyMap.has(dateKey)) {
                dailyMap.set(dateKey, {
                    date: dateKey,
                    startEquity: equityAtTradeStart,
                    endEquity: currentEquity,
                    dailyPnL: netPnL,
                    tradeCount: 1
                });
                order.push(dateKey);
            } else {
                const rec = dailyMap.get(dateKey);
                rec.endEquity = currentEquity;
                rec.dailyPnL += netPnL;
                rec.tradeCount += 1;
            }
        }
        const dailyRecords = order.map(k => {
            const r = dailyMap.get(k);
            const dailyReturnPct = r.startEquity > 0 ? (r.endEquity - r.startEquity) / r.startEquity : 0;
            return {
                date: r.date,
                startEquity: r.startEquity,
                endEquity: r.endEquity,
                dailyPnL: r.dailyPnL,
                tradeCount: r.tradeCount,
                dailyReturnPct
            };
        });
        const dailyReturnPctSeries = dailyRecords.map(r => r.dailyReturnPct);
        const dailyReturnUSDSeries = dailyRecords.map(r => r.dailyPnL);
        return {
            dailyRecords,
            dailyReturnPctSeries,
            dailyReturnUSDSeries,
            totalTrades: trades.length,
            totalDays: dailyRecords.length,
            finalEquity: dailyRecords.length ? dailyRecords[dailyRecords.length - 1].endEquity : initialCapital
        };
    }

    // === 修改：改為日級 KPI 計算 ===
    calculatePeriodStats(periodTrades, initialCapital) {
        if (!periodTrades || periodTrades.length === 0) {
            const nullStats = {};
            Object.keys(this.metricProperties).forEach(key => nullStats[key] = 0);
            nullStats.numTrades = 0;
            nullStats.numDays = 0;
            return nullStats;
        }
        periodTrades.sort((a, b) => a.parsedDate - b.parsedDate);
        const {
            dailyRecords,
            dailyReturnPctSeries,
            dailyReturnUSDSeries,
            totalTrades,
            totalDays,
            finalEquity
        } = this.buildDailySeries(periodTrades, initialCapital);
        if (totalDays === 0) {
            const nullStats = {};
            Object.keys(this.metricProperties).forEach(key => nullStats[key] = 0);
            nullStats.numTrades = totalTrades;
            nullStats.numDays = 0;
            return nullStats;
        }
        const avgReturnPct = dailyReturnPctSeries.reduce((s, r) => s + r, 0) / totalDays;
        const stdDevPct = Math.sqrt(
            dailyReturnPctSeries.reduce((s, r) => s + Math.pow(r - avgReturnPct, 2), 0) / totalDays
        );
        const sharpeRatio = stdDevPct === 0 ? 0 : (avgReturnPct / stdDevPct);
        const negativeReturns = dailyReturnPctSeries.filter(r => r < 0);
        const downsideDev = negativeReturns.length > 0
            ? Math.sqrt(negativeReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / negativeReturns.length)
            : 0;
        const sortinoRatio = downsideDev === 0 ? (avgReturnPct > 0 ? Infinity : 0) : avgReturnPct / downsideDev;
        const gains = dailyReturnUSDSeries.filter(r => r > 0).reduce((s, r) => s + r, 0);
        const lossesAbs = Math.abs(dailyReturnUSDSeries.filter(r => r < 0).reduce((s, r) => s + r, 0));
        const omegaRatio = lossesAbs === 0 ? (gains > 0 ? Infinity : 1) : gains / lossesAbs;
        const sortedDailyUSD = [...dailyReturnUSDSeries].sort((a, b) => a - b);
        const varIndex = Math.floor(sortedDailyUSD.length * 0.05);
        const var95 = sortedDailyUSD[varIndex] || 0;
        const cvarSlice = sortedDailyUSD.slice(0, varIndex + 1);
        const cvar95 = cvarSlice.length > 0
            ? cvarSlice.reduce((s, r) => s + r, 0) / cvarSlice.length
            : 0;
        let peak = dailyRecords[0].endEquity;
        let maxDrawdownValue = 0;
        dailyRecords.forEach(rec => {
            if (rec.endEquity > peak) peak = rec.endEquity;
            const dd = peak - rec.endEquity;
            if (dd > maxDrawdownValue) maxDrawdownValue = dd;
        });
        const peakEquity = peak;
        const mdd = peakEquity > 0 ? (maxDrawdownValue / peakEquity) * 100 : 0;
        const winningDays = dailyRecords.filter(r => r.dailyPnL > 0).length;
        const winRate = (winningDays / totalDays) * 100;
        const totalReturn = finalEquity - initialCapital;
        const startDate = dailyRecords[0].date;
        const endDate = dailyRecords[dailyRecords.length - 1].date;
        const startDateObj = new Date(startDate + 'T00:00:00Z');
        const endDateObj = new Date(endDate + 'T23:59:59Z');
        const durationInMs = endDateObj - startDateObj;
        const durationInYears = durationInMs / (1000 * 60 * 60 * 24 * 365.25);
        let annualReturn = 0;
        if (durationInYears > 0 && initialCapital > 0) {
            if (finalEquity > 0) {
                annualReturn = (Math.pow(finalEquity / initialCapital, 1 / durationInYears) - 1) * 100;
            } else {
                annualReturn = -100;
            }
        }
        const calmarRatio = mdd > 0 ? annualReturn / mdd : (totalReturn > 0 ? Infinity : 0);
        return {
            numTrades: totalTrades,
            numDays: totalDays,
            totalReturn,
            annualReturn: isNaN(annualReturn) ? 0 : annualReturn,
            sharpeRatio: isNaN(sharpeRatio) ? 0 : sharpeRatio,
            sortinoRatio: isFinite(sortinoRatio) ? sortinoRatio : 0,
            calmarRatio: isFinite(calmarRatio) ? calmarRatio : 0,
            mdd: isNaN(mdd) ? 0 : mdd,
            winRate: isNaN(winRate) ? 0 : winRate,
            omegaRatio: isFinite(omegaRatio) ? omegaRatio : 0,
            var95: isNaN(var95) ? 0 : var95,
            cvar95: isNaN(cvar95) ? 0 : cvar95
        };
    }

    generateRectangularHeatmapData() {
        if (!this.periods.length) throw new Error('❌ 請先計算時間週期');
        const heatmapData = this.periods.map(period => ({
            period: period.index,
            startDate: period.startDate.toISOString().split('T')[0],
            endDate: period.endDate.toISOString().split('T')[0],
            ...this.calculatePeriodStats(period.trades, this.initialCapital)
        }));
        const cols = 20;
        const totalPeriods = heatmapData.length;
        const rows = Math.ceil(totalPeriods / cols);
        console.log(`📊 熱力圖矩陣大小: ${rows} 行 × ${cols} 列`);
        const rectangularMatrix = [];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = row * cols + col;
                const cellData = index < heatmapData.length ? heatmapData[index] : { period: null };
                const emptyCell = {};
                if (cellData.period === null) {
                    Object.keys(this.metricProperties).forEach(key => emptyCell[key] = null);
                    emptyCell.numTrades = null;
                    emptyCell.numDays = null;
                }
                rectangularMatrix.push({
                    position: index + 1,
                    row: row + 1,
                    col: col + 1,
                    ...cellData,
                    ...emptyCell
                });
            }
        }
        return { heatmapData, rectangularMatrix, dimensions: { rows, cols, totalPeriods } };
    }

    generateEquityCurveData() {
        if (!this.trades || this.trades.length === 0) return [];
        let equity = this.initialCapital;
        const equityData = [{
            x: this.trades[0].parsedDate.getTime() - 1,
            y: this.initialCapital
        }];
        for (let i = 0; i < this.trades.length; i++) {
            const trade = this.trades[i];
            const positionSize = this.calculatePositionSize(equity, i);
            const tvPnLUSD = parseFloat(String(trade[this.detectedPnlColumn]).replace(/,/g, '')) || 0;
            const tvPnLPercent = parseFloat(String(trade['P&L %'] || '').replace(/,/g, '')) || 0;
            let actualPnL;
            if (tvPnLPercent !== 0) {
                actualPnL = positionSize * (tvPnLPercent / 100);
            } else {
                if (this.positionSizeType === 'fixed') {
                    actualPnL = tvPnLUSD;
                } else {
                    actualPnL = 0;
                }
            }
            const commission = positionSize * this.commissionRate * 2;
            const netPnL = actualPnL - commission;
            equity += netPnL;
            equityData.push({
                x: trade.parsedDate.getTime(),
                y: parseFloat(equity.toFixed(2))
            });
        }
        return equityData;
    }

    generatePnLDistributionData() {
        if (!this.trades || this.trades.length === 0) return [];
        let currentEquity = this.initialCapital;
        const returns = [];
        for (let i = 0; i < this.trades.length; i++) {
            const trade = this.trades[i];
            const positionSize = this.calculatePositionSize(currentEquity, i);
            const tvPnLUSD = parseFloat(String(trade[this.detectedPnlColumn] || '0').replace(/,/g, '')) || 0;
            const tvPnLPercent = parseFloat(String(trade['P&L %'] || '0').replace(/,/g, '')) || 0;
            let actualPnL;
            if (tvPnLPercent !== 0) {
                actualPnL = positionSize * (tvPnLPercent / 100);
            } else {
                if (this.positionSizeType === 'fixed') {
                    actualPnL = tvPnLUSD;
                } else {
                    actualPnL = 0;
                }
            }
            const commission = positionSize * this.commissionRate * 2;
            const netPnL = actualPnL - commission;
            returns.push(netPnL);
            if (this.positionSizeType === 'percentage') {
                currentEquity += netPnL;
            }
        }
        if (returns.length === 0) return [];
        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        console.log(`📊 PnL分佈統計: 平均=${mean.toFixed(2)}, 標準差=${stdDev.toFixed(2)}`);
        console.log(`📊 使用區間大小: ${this.binSizeInStdDev} 標準差`);
        if (stdDev < 1e-6) {
            console.log('⚠️ 標準差極小，PnL分佈集中在單點。');
            return [{
                range: `${mean.toFixed(1)}`,
                rangeLabel: `$${mean.toFixed(1)}`,
                binStart: mean,
                binEnd: mean,
                binCenter: mean,
                count: returns.length,
                percentage: '100.0',
                standardDeviations: 0
            }];
        }
        const binSizeInValue = stdDev * this.binSizeInStdDev;
        const minStdDev = Math.floor((Math.min(...returns) - mean) / stdDev / this.binSizeInStdDev) * this.binSizeInStdDev;
        const maxStdDev = Math.ceil((Math.max(...returns) - mean) / stdDev / this.binSizeInStdDev) * this.binSizeInStdDev;
        const bins = [];
        for (let stdDevPos = minStdDev; stdDevPos <= maxStdDev; stdDevPos += this.binSizeInStdDev) {
            const binStart = mean + (stdDevPos * stdDev);
            const binEnd = mean + ((stdDevPos + this.binSizeInStdDev) * stdDev);
            const binCenter = (binStart + binEnd) / 2;
            let rangeLabel;
            if (Math.abs(binCenter) >= 1000) {
                rangeLabel = `$${(binCenter / 1000).toFixed(1)}K`;
            } else if (Math.abs(binCenter) >= 100) {
                rangeLabel = `$${binCenter.toFixed(0)}`;
            } else {
                rangeLabel = `$${binCenter.toFixed(1)}`;
            }
            bins.push({
                range: `${binStart.toFixed(1)} ~ ${binEnd.toFixed(1)}`,
                rangeLabel: rangeLabel,
                binStart: binStart,
                binEnd: binEnd,
                binCenter: binCenter,
                count: 0,
                percentage: 0,
                standardDeviations: stdDevPos + (this.binSizeInStdDev / 2)
            });
        }
        returns.forEach(pnl => {
            const stdDevFromMean = (pnl - mean) / stdDev;
            let binIndex = Math.floor((stdDevFromMean - minStdDev) / this.binSizeInStdDev);
            if (binIndex >= bins.length) binIndex = bins.length - 1;
            if (binIndex < 0) binIndex = 0;
            if (bins[binIndex]) {
                bins[binIndex].count++;
            }
        });
        const totalTrades = returns.length;
        if (totalTrades > 0) {
            bins.forEach(bin => {
                bin.percentage = ((bin.count / totalTrades) * 100).toFixed(1);
            });
        }
        bins.sort((a, b) => a.binCenter - b.binCenter);
        console.log(`📊 生成了 ${bins.length} 個區間 (包含空區間)`);
        if (bins.length > 0) {
            console.log(`📊 金額範圍: $${bins[0].binStart.toFixed(1)} ~ $${bins[bins.length - 1].binEnd.toFixed(1)}`);
        }
        return bins;
    }

    // === 新增：日期差（天） ===
    diffDays(dateStrA, dateStrB) {
        const a = new Date(dateStrA + 'T00:00:00Z');
        const b = new Date(dateStrB + 'T00:00:00Z');
        return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
    }

    // === 新增：由日級權益生成 Drawdown 事件 ===
    generateDrawdownEventsFromDaily(dailyRecords) {
        if (!dailyRecords || dailyRecords.length === 0) return [];
        let peakEquity = dailyRecords[0].endEquity;
        let peakDate = dailyRecords[0].date;
        let currentDrawdown = null;
        const events = [];
        for (let i = 0; i < dailyRecords.length; i++) {
            const rec = dailyRecords[i];
            const eq = rec.endEquity;
            const date = rec.date;
            if (eq > peakEquity) {
                if (currentDrawdown) {
                    events.push({
                        ...currentDrawdown,
                        endDate: date,
                        recovered: false,
                        recoveryEquity: eq,
                        fullDurationDays: this.diffDays(currentDrawdown.startDate, date)
                    });
                    currentDrawdown = null;
                }
                peakEquity = eq;
                peakDate = date;
            } else if (eq < peakEquity) {
                if (!currentDrawdown) {
                    currentDrawdown = {
                        startDate: peakDate,
                        peakEquity: peakEquity,
                        troughEquity: eq,
                        troughDate: date
                    };
                } else {
                    if (eq < currentDrawdown.troughEquity) {
                        currentDrawdown.troughEquity = eq;
                        currentDrawdown.troughDate = date;
                    }
                }
            } else {
                if (currentDrawdown) {
                    events.push({
                        startDate: currentDrawdown.startDate,
                        peakEquity: currentDrawdown.peakEquity,
                        troughEquity: currentDrawdown.troughEquity,
                        troughDate: currentDrawdown.troughDate,
                        endDate: date,
                        recovered: true,
                        recoveryEquity: eq,
                        depthUSD: currentDrawdown.peakEquity - currentDrawdown.troughEquity,
                        depthPct: (currentDrawdown.peakEquity - currentDrawdown.troughEquity) / currentDrawdown.peakEquity * 100,
                        toTroughDays: this.diffDays(currentDrawdown.startDate, currentDrawdown.troughDate),
                        fullDurationDays: this.diffDays(currentDrawdown.startDate, date)
                    });
                    currentDrawdown = null;
                }
            }
        }
        if (currentDrawdown) {
            events.push({
                startDate: currentDrawdown.startDate,
                peakEquity: currentDrawdown.peakEquity,
                troughEquity: currentDrawdown.troughEquity,
                troughDate: currentDrawdown.troughDate,
                endDate: dailyRecords[dailyRecords.length - 1].date,
                recovered: false,
                recoveryEquity: dailyRecords[dailyRecords.length - 1].endEquity,
                depthUSD: currentDrawdown.peakEquity - currentDrawdown.troughEquity,
                depthPct: (currentDrawdown.peakEquity - currentDrawdown.troughEquity) / currentDrawdown.peakEquity * 100,
                toTroughDays: this.diffDays(currentDrawdown.startDate, currentDrawdown.troughDate),
                fullDurationDays: this.diffDays(currentDrawdown.startDate, dailyRecords[dailyRecords.length - 1].date)
            });
        }
        events.forEach(ev => {
            if (typeof ev.depthUSD === 'undefined') {
                ev.depthUSD = ev.peakEquity - ev.troughEquity;
                ev.depthPct = (ev.depthUSD / ev.peakEquity) * 100;
                ev.toTroughDays = this.diffDays(ev.startDate, ev.troughDate);
                ev.fullDurationDays = this.diffDays(ev.startDate, ev.endDate);
            }
        });
        return events;
    }

    // === 新增：Drawdown 分佈資料 ===
    generateDrawdownDistributionData(drawdownEvents) {
        if (!drawdownEvents || drawdownEvents.length === 0) return [];
        const depths = drawdownEvents.map(ev => -Math.abs(ev.depthUSD));
        const mean = depths.reduce((s, v) => s + v, 0) / depths.length;
        const variance = depths.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / depths.length;
        const stdDev = Math.sqrt(variance);
        console.log(`📊 Drawdown分佈統計: 平均=${mean.toFixed(2)}, 標準差=${stdDev.toFixed(2)}`);
        if (stdDev < 1e-9) {
            return [{
                range: `${mean.toFixed(2)}`,
                rangeLabel: `-$${Math.abs(mean).toFixed(1)}`,
                binStart: mean,
                binEnd: mean,
                binCenter: mean,
                count: depths.length,
                percentage: '100.0',
                standardDeviations: 0
            }];
        }
        const binSizeInValue = stdDev * this.binSizeInStdDev;
        const minStdDev = Math.floor((Math.min(...depths) - mean) / stdDev / this.binSizeInStdDev) * this.binSizeInStdDev;
        const maxStdDev = Math.ceil((Math.max(...depths) - mean) / stdDev / this.binSizeInStdDev) * this.binSizeInStdDev;
        const bins = [];
        for (let stdPos = minStdDev; stdPos <= maxStdDev; stdPos += this.binSizeInStdDev) {
            const binStart = mean + (stdPos * stdDev);
            const binEnd = mean + ((stdPos + this.binSizeInStdDev) * stdDev);
            const binCenter = (binStart + binEnd) / 2;
            let labelAbs = Math.abs(binCenter);
            let rangeLabel;
            if (labelAbs >= 1000) {
                rangeLabel = `-$${(labelAbs / 1000).toFixed(1)}K`;
            } else if (labelAbs >= 100) {
                rangeLabel = `-$${labelAbs.toFixed(0)}`;
            } else {
                rangeLabel = `-$${labelAbs.toFixed(1)}`;
            }
            bins.push({
                range: `${binStart.toFixed(1)} ~ ${binEnd.toFixed(1)}`,
                rangeLabel,
                binStart,
                binEnd,
                binCenter,
                count: 0,
                percentage: 0,
                standardDeviations: stdPos + (this.binSizeInStdDev / 2)
            });
        }
        depths.forEach(val => {
            const stdFromMean = (val - mean) / stdDev;
            let idx = Math.floor((stdFromMean - minStdDev) / this.binSizeInStdDev);
            if (idx >= bins.length) idx = bins.length - 1;
            if (idx < 0) idx = 0;
            if (bins[idx]) bins[idx].count++;
        });
        const total = depths.length;
        if (total > 0) {
            bins.forEach(bin => {
                bin.percentage = ((bin.count / total) * 100).toFixed(1);
            });
        }
        bins.sort((a, b) => a.binCenter - b.binCenter);
        return bins;
    }

    generateRadarChartData(overallStats) {
        const radarMetrics = ['sharpeRatio', 'var95', 'calmarRatio', 'sortinoRatio', 'omegaRatio', 'mdd'];
        const radarData = radarMetrics.map(metricKey => {
            const metric = this.metricProperties[metricKey];
            let value = overallStats[metricKey];
            if (!isFinite(value) || isNaN(value)) {
                value = 0;
            }
            let normalizedValue;
            if (metric.radarInvert) {
                normalizedValue = Math.max(0, metric.radarMax - Math.abs(value));
            } else {
                normalizedValue = Math.max(0, Math.min(value, metric.radarMax));
            }
            const percentage = (normalizedValue / metric.radarMax) * 100;
            return {
                label: metric.displayName,
                value: percentage,
                rawValue: value,
                formattedValue: metric.format(value)
            };
        });
        return radarData;
    }

    generateHeatmapHTML(heatmapData, rectangularMatrix, dimensions, chosenMetric, overallStats, equityCurveData, pnlDistributionData, radarData, drawdownDistributionData) {
        const { cols } = dimensions;
        const metricInfo = this.metricProperties[chosenMetric];
        const portfolioName = Array.from(this.portfolioInfo.strategyNames).join(' + ') || '組合策略';
        const brokers = Array.from(this.portfolioInfo.brokers).join(', ') || 'N/A';
        const platforms = Array.from(this.portfolioInfo.platforms).join(', ') || 'N/A';
        const symbols = Array.from(this.portfolioInfo.symbols).join(', ') || 'N/A';
        const positionModeDesc = this.positionSizeType === 'fixed'
            ? `固定金額: $${this.positionSize} USDT`
            : `滾倉模式: ${this.positionSize}% (隨獲利增加下注金額)`;
        
        const getColor = (value) => {
            if (value === null || isNaN(value) || !isFinite(value)) return '#3a3a3a';
            if (metricInfo.colorThresholds && metricInfo.colorThresholds.length > 1) {
                const thresholds = metricInfo.higherIsBetter
                    ? [...metricInfo.colorThresholds].sort((a, b) => b.threshold - a.threshold)
                    : [...metricInfo.colorThresholds].sort((a, b) => a.threshold - b.threshold);
                if (metricInfo.higherIsBetter) {
                    if (value >= thresholds[0].threshold) return thresholds[0].color;
                    if (value <= thresholds[thresholds.length - 1].threshold) return thresholds[thresholds.length - 1].color;
                } else {
                    if (value <= thresholds[0].threshold) return thresholds[0].color;
                    if (value >= thresholds[thresholds.length - 1].threshold) return thresholds[thresholds.length - 1].color;
                }
                for (let i = 0; i < thresholds.length - 1; i++) {
                    const upperStop = thresholds[i];
                    const lowerStop = thresholds[i + 1];
                    const inRange = metricInfo.higherIsBetter
                        ? (value < upperStop.threshold && value >= lowerStop.threshold)
                        : (value > upperStop.threshold && value <= lowerStop.threshold);
                    if (inRange) {
                        const range = upperStop.threshold - lowerStop.threshold;
                        if (range === 0) return upperStop.color;
                        const factor = (value - lowerStop.threshold) / range;
                        const color1_rgb = this.hexToRgb(lowerStop.color);
                        const color2_rgb = this.hexToRgb(upperStop.color);
                        if (!color1_rgb || !color2_rgb) return '#3a3a3a';
                        return this.interpolateColor(color1_rgb, color2_rgb, factor);
                    }
                }
                return thresholds[thresholds.length - 1].color;
            }
            const validValues = heatmapData
                .map(d => d[chosenMetric])
                .filter(v => v !== null && !isNaN(v) && isFinite(v));
            const minValue = Math.min(...validValues);
            const maxValue = Math.max(...validValues);
            let normalized = (value - minValue) / (maxValue - minValue);
            if (maxValue === minValue) normalized = 0.5;
            if (!metricInfo.higherIsBetter) normalized = 1 - normalized;
            const r = Math.round(255 * Math.min(1, 2 * (1 - normalized)));
            const g = Math.round(255 * Math.min(1, 2 * normalized));
            return `rgb(${r}, ${g}, 50)`;
        };
    
        const generateLegendHTML = (metricInfo) => {
            if (!metricInfo.colorThresholds || metricInfo.colorThresholds.length === 0) return '';
            let legendItems = '';
            const thresholds = metricInfo.higherIsBetter
                ? [...metricInfo.colorThresholds].sort((a, b) => b.threshold - a.threshold)
                : [...metricInfo.colorThresholds].sort((a, b) => a.threshold - b.threshold);
            for (const item of thresholds) {
                legendItems += `<div class="legend-item"><span class="legend-color" style="background-color: ${item.color};"></span>${item.description}</div>`;
            }
            return `<div class="legend-section"><h3>顏色圖例 (${metricInfo.displayName})</h3><div class="legend">${legendItems}</div></div>`;
        };
    
        return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
    <meta charset="UTF-8">
    <title>${portfolioName} 組合策略分析報告</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background: #000000; color: #e0e0e0; line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 30px; background: linear-gradient(145deg, #1a1a1a 0%, #000000 100%); min-height: 100vh; box-shadow: 0 0 50px rgba(0,0,0,0.5); border-radius: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    h1, h2 { color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    h1 { font-size: 32px; margin-bottom: 8px; background: linear-gradient(45deg, #64b5f6, #42a5f5, #2196f3); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    h2 { font-size: 24px; margin-top: 40px; padding-bottom: 12px; border-bottom: 2px solid rgba(100, 181, 246, 0.3); position: relative; }
    h2::after { content: ''; position: absolute; bottom: -2px; left: 0; width: 60px; height: 2px; background: linear-gradient(45deg, #64b5f6, #2196f3); }
    .header h2 { font-size: 18px; color: #64b5f6; font-weight: 500; border-bottom: none; margin-top: 0; }
    .strategy-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; padding: 25px; background: linear-gradient(145deg, #1a1a1a 0%, #0f0f0f 100%); border-radius: 15px; border: 1px solid rgba(100, 181, 246, 0.2); box-shadow: inset 0 1px 0 rgba(255,255,255,0.1); }
    .info-item { text-align: center; }
    .info-label { font-weight: 600; color: #9e9e9e; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .info-value { font-size: 18px; color: #ffffff; margin-top: 6px; font-weight: 500; word-break: break-word; }
    .position-info { background: linear-gradient(145deg, #1e3a5f 0%, #1a2332 100%); border: 2px solid rgba(100, 181, 246, 0.4); margin-bottom: 25px; padding: 20px; border-radius: 12px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    .position-info h3 { margin: 0 0 12px 0; color: #64b5f6; font-size: 18px; }
    .position-details { font-size: 14px; color: #e0e0e0; line-height: 1.6; }
    .chart-half { padding: 25px 25px 70px 25px; background: linear-gradient(145deg, #1a1a1a 0%, #0f0f0f 100%); border-radius: 15px; height: 470px; border: 1px solid rgba(100, 181, 246, 0.2); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    .chart-full { padding: 25px 25px 70px 25px; background: linear-gradient(145deg, #1a1a1a 0%, #0f0f0f 100%); border-radius: 15px; height: 470px; border: 1px solid rgba(100, 181, 246, 0.2); box-shadow: 0 4px 12px rgba(0,0,0,0.2); width: 100%; }
    .charts-row { display: grid; gap: 25px; margin-top: 25px; }
    .charts-row.two-col { grid-template-columns: 1fr 1fr; }
    .charts-row.one-col { grid-template-columns: 1fr; }
    .chart-title { margin-top: 0; font-size: 20px; text-align: center; color: #64b5f6; margin-bottom: 20px; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .heatmap-container { overflow-x: auto; padding: 20px; background: linear-gradient(145deg, #1a1a1a 0%, #0f0f0f 100%); border-radius: 15px; margin-bottom: 20px; border: 1px solid rgba(100, 181, 246, 0.2); }
    .heatmap { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 4px; min-width: ${cols * 50}px; }
    .cell { aspect-ratio: 1.2; min-width: 45px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: white; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; position: relative; text-shadow: 1px 1px 2px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1); }
    .cell:hover { transform: scale(1.15) translateZ(10px); z-index: 10; box-shadow: 0 8px 25px rgba(0,0,0,0.4), 0 0 0 2px rgba(100, 181, 246, 0.5); }
    .cell.empty { background: linear-gradient(145deg, #3a3a3a 0%, #2a2a2a 100%); border: 1px solid rgba(255,255,255,0.05); }
    .tooltip { visibility: hidden; position: absolute; background: linear-gradient(145deg, rgba(0,0,0,0.95) 0%, rgba(20,20,30,0.95) 100%); color: white; padding: 12px; border-radius: 8px; font-size: 12px; pointer-events: none; z-index: 1000; white-space: nowrap; transform: translate(-50%, -110%); top: 0; left: 50%; opacity: 0; transition: all 0.3s ease; border: 1px solid rgba(100, 181, 246, 0.3); box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    .tooltip-grid { display: grid; grid-template-columns: auto auto; gap: 6px 15px; }
    .tooltip-label { font-weight: 600; color: #64b5f6; }
    .cell:hover .tooltip { visibility: visible; opacity: 1; }
    .legend-section { margin-top: 30px; padding: 20px; background: linear-gradient(145deg, #1a1a1a 0%, #0f0f0f 100%); border-radius: 12px; border: 1px solid rgba(100, 181, 246, 0.2); }
    .legend-section h3 { margin-top: 0; text-align: center; font-size: 16px; color: #ffffff; }
    .legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; }
    .legend-item { display: flex; align-items: center; font-size: 13px; color: #e0e0e0; }
    .legend-color { width: 16px; height: 16px; border-radius: 4px; margin-right: 8px; border: 1px solid rgba(255,255,255,0.2); }
    .stats-section { margin-top: 25px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
    .stat-card { background: linear-gradient(145deg, #1a1a1a 0%, #0f0f0f 100%); padding: 25px; border-radius: 12px; text-align: center; border: 1px solid rgba(100, 181, 246, 0.2); transition: transform 0.2s ease, box-shadow 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.3); }
    .stat-value { font-size: 28px; font-weight: 700; color: #64b5f6; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .stat-label { font-size: 13px; color: #b0b0b0; margin-top: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .footer { margin-top: 40px; text-align: center; color: #888; font-size: 12px; padding-top: 20px; border-top: 1px solid rgba(100, 181, 246, 0.2); }
    .radar-container { position: relative; height: 380px; display: flex; align-items: center; justify-content: center; }
    @media (max-width: 1200px) {
        .charts-row.two-col { grid-template-columns: 1fr; }
        .chart-half, .chart-full { height: 460px; }
    }
    @media (max-width: 768px) {
        .strategy-info { grid-template-columns: 1fr; }
        .stats-grid { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
        .heatmap { min-width: ${cols * 35}px; }
        .cell { min-width: 30px; font-size: 10px; }
    }
    </style>
    </head>
    <body>
    <div class="container">
        <div class="header"><h1>${portfolioName} 的回測報告</h1></div>
        <div class="position-info">
            <h3>📊 下注設定 & 費用配置</h3>
            <div class="position-details">
                <strong>下注模式:</strong> ${positionModeDesc}<br>
                <strong>手續費率:</strong> ${(this.commissionRate * 100).toFixed(3)}% (雙向)<br>
                <strong>初始資金:</strong> $${this.initialCapital.toLocaleString()} USDT
            </div>
        </div>
        <div class="strategy-info">
            <div class="info-item"><div class="info-label">策略創作者</div><div class="info-value">${brokers}</div></div>
            <div class="info-item"><div class="info-label">交易所</div><div class="info-value">${platforms}</div></div>
            <div class="info-item"><div class="info-label">交易對</div><div class="info-value">${symbols}</div></div>
            <div class="info-item"><div class="info-label">交易日期</div><div class="info-value">${this.portfolioInfo.tradingDateRange}</div></div>
        </div>
    
        <div class="charts-row two-col">
            <div class="chart-half">
                <h2 class="chart-title">PnL 分佈 (PnL Distribution)</h2>
                <canvas id="pnlDistributionChart" style="height: 380px;"></canvas>
            </div>
            <div class="chart-half">
                <h2 class="chart-title">總體績效評估 (Performance Radar)</h2>
                <div class="radar-container">
                    <canvas id="radarChart" style="height: 380px; width: 380px;"></canvas>
                </div>
            </div>
        </div>
    
        <div class="charts-row one-col">
            <div class="chart-full">
                <h2 class="chart-title">回撤分佈 (Drawdown Distribution)</h2>
                <canvas id="drawdownDistributionChart" style="height: 380px;"></canvas>
            </div>
        </div>
    
        <div class="charts-row one-col">
            <div class="chart-full">
                <h2 class="chart-title">權益曲線 (Equity Curve)</h2>
                <canvas id="equityCurveChart" style="height: 380px;"></canvas>
            </div>
        </div>
    
        <h2>週期性表現熱力圖 (${metricInfo.displayName})</h2>
        <div class="heatmap-container">
            <div class="heatmap">${
                rectangularMatrix.map(cell => {
                    if (cell.period === null) return `<div class="cell empty"></div>`;
                    const cellValue = cell[chosenMetric];
                    const displayValue = (cellValue !== null && isFinite(cellValue)) ? metricInfo.format(cellValue) : 'N/A';
                    return `<div class="cell" style="background-color: ${getColor(cellValue)};">
                        ${displayValue}
                        <div class="tooltip">
                            <div class="tooltip-grid">
                                <div class="tooltip-label">週期:</div><div>${cell.period}</div>
                                <div class="tooltip-label">日期:</div><div>${cell.startDate}</div>
                                <hr style="grid-column: 1 / -1; border-color: rgba(100,181,246,0.3); margin: 4px 0;">
                                ${
                                    Object.entries(this.metricProperties).map(([key, prop]) =>
                                        `<div class="tooltip-label">${prop.displayName}:</div><div>${(cell[key] !== null && isFinite(cell[key])) ? prop.format(cell[key]) : 'N/A'}</div>`
                                    ).join('')
                                }
                                <div class="tooltip-label">交易數:</div><div>${cell.numTrades ?? 'N/A'}</div>
                                <div class="tooltip-label">日數:</div><div>${cell.numDays ?? 'N/A'}</div>
                            </div>
                        </div>
                    </div>`;
                }).join('')
            }</div>
        </div>
        ${generateLegendHTML(metricInfo)}
        
        <h2>總體績效指標 (Overall Performance)</h2>
        <div class="stats-section">
            <div class="stats-grid">
                ${
                    Object.entries(this.metricProperties).map(([key, prop]) => {
                        const value = overallStats[key];
                        return `<div class="stat-card"><div class="stat-value">${(value !== null && isFinite(value)) ? prop.format(value) : 'N/A'}</div><div class="stat-label">${prop.displayName}</div></div>`;
                    }).join('')
                }
                <div class="stat-card"><div class="stat-value">${overallStats.numTrades}</div><div class="stat-label">Total Trades</div></div>
                <div class="stat-card"><div class="stat-value">${overallStats.numDays ?? '-'}</div><div class="stat-label">Total Days</div></div>
            </div>
        </div>
            
        <div class="footer">
            <p>報告生成於 ${new Date().toLocaleString('zh-TW')} | 數據來源: ${Array.from(this.portfolioInfo.sourceFiles).join(', ')} | 回測分析工具創作者: LionAlgo</p>
        </div>
    </div>
    <script>
    const equityData = ${JSON.stringify(equityCurveData)};
    const pnlDistributionData = ${JSON.stringify(pnlDistributionData)};
    const drawdownDistributionData = ${JSON.stringify(drawdownDistributionData)};
    const radarData = ${JSON.stringify(radarData)};
    const initialCapital = ${this.initialCapital};
            
    Chart.defaults.color = '#e0e0e0';
    Chart.defaults.borderColor = 'rgba(100, 181, 246, 0.2)';
    Chart.defaults.backgroundColor = 'rgba(100, 181, 246, 0.1)';
            
    // Equity Curve
    const equityCtx = document.getElementById('equityCurveChart').getContext('2d');
    const equityGradient = equityCtx.createLinearGradient(0, 0, 0, 380);
    equityGradient.addColorStop(0, 'rgba(100, 181, 246, 0.3)');
    equityGradient.addColorStop(1, 'rgba(100, 181, 246, 0.05)');
    new Chart(equityCtx, {
        type: 'line',
        data: {
            datasets: [{
                label: '權益 (Equity)',
                data: equityData,
                borderColor: '#64b5f6',
                backgroundColor: equityGradient,
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 6,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#64b5f6',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#64b5f6',
                    bodyColor: '#ffffff',
                    borderColor: '#64b5f6',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const equity = context.parsed.y;
                            const profitUSD = equity - initialCapital;
                            const profitPercent = initialCapital !== 0 ? (profitUSD / initialCapital) * 100 : 0;
                            return \`權益: $\${equity.toFixed(2)} (盈虧: $\${profitUSD.toFixed(2)} / \${profitPercent.toFixed(2)}%)\`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day', tooltipFormat: 'yyyy-MM-dd HH:mm', displayFormats: { day: 'yyyy-MM-dd' } },
                    title: { display: true, text: '日期', color: '#e0e0e0' },
                    grid: { color: 'rgba(100, 181, 246, 0.1)' },
                    ticks: { color: '#b0b0b0' }
                },
                y: {
                    title: { display: true, text: '權益 (USDT)', color: '#e0e0e0' },
                    grid: { color: 'rgba(100, 181, 246, 0.1)' },
                    ticks: {
                        color: '#b0b0b0',
                        callback: function(value) { return '$' + value.toLocaleString(); }
                    }
                }
            },
            interaction: { intersect: false, mode: 'index' }
        }
    });
            
    // PnL Distribution
    const pnlCtx = document.getElementById('pnlDistributionChart').getContext('2d');
    const createDistributionColors = (binsData) => {
        return binsData.map(bin => {
            const stdDev = bin.standardDeviations;
            const normalizedValue = Math.max(-2, Math.min(2, stdDev));
            const ratio = (normalizedValue + 2) / 4;
            let hue;
            if (ratio < 0.5) {
                hue = ratio * 120;
            } else {
                hue = 60 + (ratio - 0.5) * 120;
            }
            return \`hsl(\${hue}, 75%, 55%)\`;
        });
    };
    new Chart(pnlCtx, {
        type: 'bar',
        data: {
            labels: pnlDistributionData.map(bin => bin.rangeLabel),
            datasets: [{
                label: '交易數量',
                data: pnlDistributionData.map(bin => bin.count),
                backgroundColor: createDistributionColors(pnlDistributionData),
                borderColor: createDistributionColors(pnlDistributionData).map(c => c),
                borderWidth: 1,
                borderRadius: 1,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#64b5f6',
                    bodyColor: '#ffffff',
                    borderColor: '#64b5f6',
                    borderWidth: 1,
                    callbacks: {
                        title: function(context) {
                            const binData = pnlDistributionData[context[0].dataIndex];
                            return \`PnL區間: \${binData.rangeLabel}\`;
                        },
                        label: function(context) {
                            const binData = pnlDistributionData[context.dataIndex];
                            const stdDevLabel = binData.standardDeviations >= 0
                                ? \`+\${binData.standardDeviations.toFixed(1)}σ\`
                                : \`\${binData.standardDeviations.toFixed(1)}σ\`;
                            return [
                                \`交易數量: \${binData.count}\`,
                                \`佔比: \${binData.percentage}%\`,
                                \`精確區間: \${binData.range} USDT\`,
                                \`標準差位置: \${stdDevLabel}\`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(100, 181, 246, 0.1)' },
                    ticks: {
                        maxRotation: 45,
                        color: '#b0b0b0',
                        callback: function(value, index) {
                            const bin = pnlDistributionData[index];
                            return bin ? bin.rangeLabel : '';
                        }
                    }
                },
                y: {
                    title: { display: true, text: '交易數量', color: '#e0e0e0' },
                    beginAtZero: true,
                    grid: { color: 'rgba(100, 181, 246, 0.1)' },
                    ticks: { stepSize: 1, color: '#b0b0b0' }
                }
            }
        }
    });
    
    // Drawdown Distribution
    const ddCtx = document.getElementById('drawdownDistributionChart').getContext('2d');
    const createDDColors = (binsData) => {
        return binsData.map(bin => {
            const stdDev = bin.standardDeviations;
            const normalizedValue = Math.max(-2, Math.min(2, stdDev));
            const ratio = (normalizedValue + 2) / 4;
            let hue;
            if (ratio < 0.5) {
                hue = ratio * 120;
            } else {
                hue = 60 + (ratio - 0.5) * 120;
            }
            return \`hsl(\${hue}, 75%, 55%)\`;
        });
    };
    new Chart(ddCtx, {
        type: 'bar',
        data: {
            labels: drawdownDistributionData.map(bin => bin.rangeLabel),
            datasets: [{
                label: '回撤事件數量',
                data: drawdownDistributionData.map(bin => bin.count),
                backgroundColor: createDDColors(drawdownDistributionData),
                borderColor: createDDColors(drawdownDistributionData),
                borderWidth: 1,
                borderRadius: 1,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#64b5f6',
                    bodyColor: '#ffffff',
                    borderColor: '#64b5f6',
                    borderWidth: 1,
                    callbacks: {
                        title: function(context) {
                            const binData = drawdownDistributionData[context[0].dataIndex];
                            return \`回撤區間: \${binData.rangeLabel}\`;
                        },
                        label: function(context) {
                            const binData = drawdownDistributionData[context.dataIndex];
                            const stdDevLabel = binData.standardDeviations >= 0
                                ? \`+\${binData.standardDeviations.toFixed(1)}σ\`
                                : \`\${binData.standardDeviations.toFixed(1)}σ\`;
                            return [
                                \`事件數: \${binData.count}\`,
                                \`佔比: \${binData.percentage}%\`,
                                \`精確區間: \${binData.range} USD\`,
                                \`標準差位置: \${stdDevLabel}\`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(100, 181, 246, 0.1)' },
                    ticks: {
                        maxRotation: 45,
                        color: '#b0b0b0',
                        callback: function(value, index) {
                            const bin = drawdownDistributionData[index];
                            return bin ? bin.rangeLabel : '';
                        }
                    }
                },
                y: {
                    title: { display: true, text: '回撤事件數量', color: '#e0e0e0' },
                    beginAtZero: true,
                    grid: { color: 'rgba(100, 181, 246, 0.1)' },
                    ticks: { stepSize: 1, color: '#b0b0b0' }
                }
            }
        }
    });
    
    // Radar
    const radarCtx = document.getElementById('radarChart').getContext('2d');
    new Chart(radarCtx, {
        type: 'radar',
        data: {
            labels: radarData.map(item => item.label),
            datasets: [{
                label: '績效評分',
                data: radarData.map(item => item.value),
                backgroundColor: 'rgba(100, 181, 246, 0.2)',
                borderColor: '#64b5f6',
                borderWidth: 3,
                pointBackgroundColor: '#64b5f6',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#64b5f6',
                    bodyColor: '#ffffff',
                    borderColor: '#64b5f6',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const dataIndex = context.dataIndex;
                            const metric = radarData[dataIndex];
                            return [
                                \`評分: \${context.parsed.r.toFixed(1)}%\`,
                                \`實際值: \${metric.formattedValue}\`
                            ];
                        }
                    }
                }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    min: 0,
                    ticks: { display: false, stepSize: 20, color: 'transparent', backdropColor: 'transparent' },
                    grid: { color: 'rgba(100, 181, 246, 0.2)' },
                    angleLines: { color: 'rgba(100, 181, 246, 0.2)' },
                    pointLabels: { color: '#e0e0e0', font: { size: 12, weight: 'bold' } }
                }
            }
        }
    });
    </script>
    </body>
    </html>
        `;
    }

    generateFolderSummary(portfolioName, positionModeStr, overallStats, totalPeriods, pnlDistributionData, drawdownDistributionData, equityCurveData) {
        const brokers = Array.from(this.portfolioInfo.brokers).join(', ') || 'N/A';
        const platforms = Array.from(this.portfolioInfo.platforms).join(', ') || 'N/A';
        const symbols = Array.from(this.portfolioInfo.symbols).join(', ') || 'N/A';
        const sourceFiles = Array.from(this.portfolioInfo.sourceFiles);

        let pnlChart = 'PnL 分布數據無法生成。\n';
        if (pnlDistributionData && pnlDistributionData.length > 0) {
            const pnlLines = [];
            const maxCount = Math.max(...pnlDistributionData.map(b => b.count));
            const maxBarWidth = 40;
            pnlLines.push('區間 (USD)'.padEnd(22) + '交易數'.padStart(8) + '佔比'.padStart(10) + '  分佈圖');
            pnlLines.push('─'.repeat(21) + ' ' + '─'.repeat(7) + ' ' + '─'.repeat(9) + '  ' + '─'.repeat(maxBarWidth));
            pnlDistributionData.forEach(bin => {
                const rangeStr = `${bin.binStart.toFixed(1)} ~ ${bin.binEnd.toFixed(1)}`.padEnd(21);
                const countStr = `${bin.count}`.padStart(7);
                const percentStr = `(${(bin.percentage)}%)`.padStart(9);
                const barRatio = maxCount > 0 ? bin.count / maxCount : 0;
                const barLength = Math.max(1, Math.round(barRatio * maxBarWidth));
                const bar = bin.count > 0 ? '█'.repeat(barLength) : '';
                pnlLines.push(`${rangeStr} ${countStr} ${percentStr}  ${bar}`);
            });
            pnlChart = pnlLines.join('\n');
        }

        let drawdownChart = 'Drawdown 分布數據無法生成。\n';
        if (drawdownDistributionData && drawdownDistributionData.length > 0) {
            const ddLines = [];
            const maxCountDD = Math.max(...drawdownDistributionData.map(b => b.count));
            const maxBarWidthDD = 40;
            ddLines.push('區間 (USD)'.padEnd(22) + '事件數'.padStart(8) + '佔比'.padStart(10) + '  分佈圖');
            ddLines.push('─'.repeat(21) + ' ' + '─'.repeat(7) + ' ' + '─'.repeat(9) + '  ' + '─'.repeat(maxBarWidthDD));
            drawdownDistributionData.forEach(bin => {
                const rangeStr = `${bin.binStart.toFixed(1)} ~ ${bin.binEnd.toFixed(1)}`.padEnd(21);
                const countStr = `${bin.count}`.padStart(7);
                const percentStr = `(${bin.percentage}%)`.padStart(9);
                const barRatio = maxCountDD > 0 ? bin.count / maxCountDD : 0;
                const barLength = Math.max(1, Math.round(barRatio * maxBarWidthDD));
                const bar = bin.count > 0 ? '█'.repeat(barLength) : '';
                ddLines.push(`${rangeStr} ${countStr} ${percentStr}  ${bar}`);
            });
            drawdownChart = ddLines.join('\n');
        }

        let equitySummary = '權益曲線數據無法生成。\n';
        if (equityCurveData && equityCurveData.length > 0) {
            const startEquity = this.initialCapital;
            const endEquity = equityCurveData[equityCurveData.length - 1].y;
            const peakEquity = Math.max(...equityCurveData.map(p => p.y));
            const lowestEquity = Math.min(...equityCurveData.map(p => p.y));
            const totalProfit = endEquity - startEquity;
            const totalProfitPercent = (totalProfit / startEquity) * 100;
            equitySummary = `
起始資金: $${startEquity.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
結束資金: $${endEquity.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
最高點:   $${peakEquity.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
最低點:   $${lowestEquity.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
總淨利:   $${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${totalProfitPercent.toFixed(2)}%)`.trim();
        }

        return `
📊 策略資訊
─────────────────────────────────────────────────────────────
策略名稱: ${portfolioName}
策略創作者: ${brokers}
交易所: ${platforms}
交易對: ${symbols}
交易日期: ${this.portfolioInfo.tradingDateRange}

💰 下注設定
─────────────────────────────────────────────────────────────
下注模式: ${positionModeStr}
初始資金: $${this.initialCapital.toLocaleString()} USDT
手續費率: ${(this.commissionRate * 100).toFixed(3)}% (雙向)

📈 總體績效 (日級 KPI)
─────────────────────────────────────────────────────────────
總交易數:     ${overallStats.numTrades}
總日數:       ${overallStats.numDays ?? '-'}
總回報:       $${overallStats.totalReturn.toFixed(2)} USDT
年化回報率:   ${overallStats.annualReturn.toFixed(2)}%
夏普比率:     ${overallStats.sharpeRatio.toFixed(3)}
索提諾比率:   ${overallStats.sortinoRatio.toFixed(3)}
卡瑪比率:     ${overallStats.calmarRatio.toFixed(3)}
最大回撤:     ${overallStats.mdd.toFixed(2)}%
勝率(盈利日): ${overallStats.winRate.toFixed(1)}%
歐米茄比率:   ${overallStats.omegaRatio.toFixed(3)}
VaR 95%:      $${overallStats.var95.toFixed(2)} USDT
CVaR 95%:     $${overallStats.cvar95.toFixed(2)} USDT

📉 權益曲線摘要
─────────────────────────────────────────────────────────────
${equitySummary}

📈 PnL 分布 (基於單筆交易損益)
─────────────────────────────────────────────────────────────
${pnlChart}

📉 回撤分布 (基於回撤事件深度 USD)
─────────────────────────────────────────────────────────────
${drawdownChart}

📋 分析週期
─────────────────────────────────────────────────────────────
總週期數: ${totalPeriods}
週期類型: 日週期 (每日)

📁 包含檔案
─────────────────────────────────────────────────────────────
• HTML 報告: 互動式熱力圖 / PnL / Drawdown / Radar / Equity
• CSV 數據: 各週期詳細績效指標
• 權益曲線: 資金變化軌跡數據
• 本摘要檔: 快速瀏覽報告重點

📂 原始數據來源
─────────────────────────────────────────────────────────────
${sourceFiles.map((file, index) => `${index + 1}. ${file}`).join('\n')}

⚠️  重要說明
─────────────────────────────────────────────────────────────
• 本報告 KPI 已改為「日級」計算 (每日聚合)。
• 回撤事件基於每日權益終值 (endEquity) 偵測。
• 已考慮手續費成本 (${(this.commissionRate * 100).toFixed(3)}% 雙向)。
• ${this.positionSizeType === 'fixed' ? '使用固定下注金額模式。' : '使用滾倉複利模式。'}
• 過去績效不代表未來表現，請謹慎評估風險。

報告生成時間: ${new Date().toLocaleString('zh-TW')}
回測分析工具創作者: LionAlgo`.trim();
    }

    async generateAllOutputs(periodType = 'day', periodLength = 1, chosenMetric = 'sharpeRatio') {
        try {
            console.log('\n🚀 開始生成組合策略分析報告...');
            await this.autoReadAllFilesAndCombine();
            this.calculatePeriods(periodType, periodLength);
            // 為整體統計建立日級資料
            const dailyBuildAll = this.buildDailySeries(this.trades, this.initialCapital);
            this.dailyRecords = dailyBuildAll.dailyRecords;

            const { heatmapData, rectangularMatrix, dimensions } = this.generateRectangularHeatmapData();
            const overallStats = this.calculatePeriodStats(this.trades, this.initialCapital);

            console.log('\n📊 總體績效統計 (日級 KPI):');
            Object.entries(this.metricProperties).forEach(([key, prop]) => {
                const value = overallStats[key];
                if (value !== null && isFinite(value)) {
                    console.log(`   ${prop.displayName}: ${prop.format(value)}`);
                }
            });
            console.log(`   總交易數: ${overallStats.numTrades}`);
            console.log(`   總日數: ${overallStats.numDays ?? '-'}`);

            const equityCurveData = this.generateEquityCurveData();
            const radarData = this.generateRadarChartData(overallStats);
            const fullPnlDistributionData = this.generatePnLDistributionData();

            const htmlPnlDistributionData = fullPnlDistributionData.filter(bin =>
                Math.abs(bin.standardDeviations) <= this.pnlDistributionDisplayRangeSD
            );
            console.log(`🎨 HTML PnL 圖表將顯示 ${htmlPnlDistributionData.length} 個區間 (範圍: ±${this.pnlDistributionDisplayRangeSD} SD)`);

            // Drawdown
            const drawdownEvents = this.generateDrawdownEventsFromDaily(this.dailyRecords);
            console.log(`📉 共偵測到 ${drawdownEvents.length} 個回撤事件`);
            const fullDrawdownDistribution = this.generateDrawdownDistributionData(drawdownEvents);
            const htmlDrawdownDistributionData = fullDrawdownDistribution.filter(bin =>
                Math.abs(bin.standardDeviations) <= this.pnlDistributionDisplayRangeSD
            );
            console.log(`🎨 HTML Drawdown 圖表顯示 ${htmlDrawdownDistributionData.length} 個區間 (±${this.pnlDistributionDisplayRangeSD} SD)`);

            const portfolioName = Array.from(this.portfolioInfo.strategyNames).join('_') || '組合策略';
            const outputFolderName = `${portfolioName} 回測報告`;
            if (!fs.existsSync(outputFolderName)) {
                fs.mkdirSync(outputFolderName, { recursive: true });
                console.log(`📁 已創建輸出資料夾: ${outputFolderName}`);
            } else {
                console.log(`📁 使用現有資料夾: ${outputFolderName}`);
            }
            const dateStr = new Date().toISOString().split('T')[0];
            const positionModeStr = this.positionSizeType === 'fixed' ? `固定${this.positionSize}U` : `滾倉${this.positionSize}%`;
            const htmlFileName = `${portfolioName}_組合策略熱力圖_${positionModeStr}_${dateStr}.html`;
            const csvFileName = `${portfolioName}_組合策略數據_${positionModeStr}_${dateStr}.csv`;
            const equityCSVFileName = `${portfolioName}_權益曲線_${positionModeStr}_${dateStr}.csv`;
            const htmlFilePath = path.join(outputFolderName, htmlFileName);
            const csvFilePath = path.join(outputFolderName, csvFileName);
            const equityCSVFilePath = path.join(outputFolderName, equityCSVFileName);

            const htmlContent = this.generateHeatmapHTML(
                heatmapData,
                rectangularMatrix,
                dimensions,
                chosenMetric,
                overallStats,
                equityCurveData,
                htmlPnlDistributionData,
                radarData,
                htmlDrawdownDistributionData
            );
            fs.writeFileSync(htmlFilePath, htmlContent, 'utf8');
            console.log(`✅ HTML 熱力圖報告已生成: ${htmlFilePath}`);

            const csvData = heatmapData.map(period => ({
                週期: period.period,
                開始日期: period.startDate,
                結束日期: period.endDate,
                交易數: period.numTrades,
                日數: period.numDays,
                總回報_USD: period.totalReturn.toFixed(2),
                年化回報率_百分比: period.annualReturn.toFixed(2),
                夏普比率: period.sharpeRatio.toFixed(3),
                索提諾比率: period.sortinoRatio.toFixed(3),
                卡瑪比率: period.calmarRatio.toFixed(3),
                最大回撤_百分比: period.mdd.toFixed(2),
                勝率_百分比: period.winRate.toFixed(1),
                歐米茄比率: period.omegaRatio.toFixed(3),
                VaR_95_USD: period.var95.toFixed(2),
                CVaR_95_USD: period.cvar95.toFixed(2)
            }));
            if (csvData.length > 0) {
                const csvWriter = createCsvWriter({
                    path: csvFilePath,
                    header: Object.keys(csvData[0]).map(key => ({ id: key, title: key })),
                    encoding: 'utf8'
                });
                await csvWriter.writeRecords(csvData);
                console.log(`✅ CSV 數據檔案已生成: ${csvFilePath}`);
            }

            const equityCSVData = equityCurveData.map(point => ({
                時間戳: new Date(point.x).toISOString(),
                日期: new Date(point.x).toISOString().split('T')[0],
                時間: new Date(point.x).toTimeString().split(' ')[0],
                權益_USD: point.y,
                盈虧_USD: (point.y - this.initialCapital).toFixed(2),
                盈虧_百分比: (((point.y - this.initialCapital) / this.initialCapital) * 100).toFixed(2)
            }));
            if (equityCSVData.length > 0) {
                const equityCSVWriter = createCsvWriter({
                    path: equityCSVFilePath,
                    header: Object.keys(equityCSVData[0]).map(key => ({ id: key, title: key })),
                    encoding: 'utf8'
                });
                await equityCSVWriter.writeRecords(equityCSVData);
                console.log(`✅ 權益曲線 CSV 已生成: ${equityCSVFilePath}`);
            }

            const summaryContent = this.generateFolderSummary(
                portfolioName,
                positionModeStr,
                overallStats,
                heatmapData.length,
                fullPnlDistributionData,
                fullDrawdownDistribution,
                equityCurveData
            );
            const summaryFilePath = path.join(outputFolderName, 'README.txt');
            fs.writeFileSync(summaryFilePath, summaryContent, 'utf8');
            console.log(`📄 資料夾摘要已生成: ${summaryFilePath}`);

            console.log('\n🎉 所有檔案生成完成！');
            console.log(`📁 輸出資料夾: ${outputFolderName}`);
            console.log(`📋 包含檔案:`);
            console.log(`   ├── ${htmlFileName} (互動式熱力圖報告)`);
            console.log(`   ├── ${csvFileName} (週期績效數據)`);
            console.log(`   ├── ${equityCSVFileName} (權益曲線數據)`);
            console.log(`   └── README.txt (資料夾摘要)`);

            if (process.platform === 'win32') {
                try {
                    const { exec } = require('child_process');
                    exec(`explorer "${path.resolve(outputFolderName)}"`, (error) => {
                        if (error) {
                            console.log('📁 請手動開啟輸出資料夾查看結果');
                        } else {
                            console.log('📁 已自動開啟輸出資料夾');
                        }
                    });
                } catch (error) {
                    console.log('📁 請手動開啟輸出資料夾查看結果');
                }
            }

            return {
                htmlFilePath,
                csvFilePath,
                equityCSVFilePath,
                summaryFilePath,
                outputFolder: outputFolderName,
                overallStats,
                totalPeriods: heatmapData.length
            };

        } catch (error) {
            console.error(`❌ 生成報告時發生錯誤: ${error.message}`);
            throw error;
        }
    }

    async promptUserSettings() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const question = (prompt) => new Promise((resolve) => { rl.question(prompt, resolve); });
        try {
            console.log('\n🔧 組合策略回測設定');
            console.log('═'.repeat(50));

            console.log('\n💰 下注模式選擇:');
            console.log('1. 固定金額模式 (每筆交易使用相同金額)');
            console.log('2. 滾倉模式 (使用當前權益的百分比，複利效應)');
            const modeChoice = await question('請選擇下注模式 (1-2): ');

            if (modeChoice === '2') {
                this.positionSizeType = 'percentage';
                const percentInput = await question('請輸入每筆交易使用權益的百分比 (例: 10 代表 10%): ');
                this.positionSize = parseFloat(percentInput) || 10;
                console.log(`✅ 已設定為滾倉模式，每筆交易使用 ${this.positionSize}% 權益`);
            } else {
                this.positionSizeType = 'fixed';
                const amountInput = await question('請輸入每筆交易的固定金額 (USDT): ');
                this.positionSize = parseFloat(amountInput) || 100;
                console.log(`✅ 已設定為固定金額模式，每筆交易 $${this.positionSize} USDT`);
            }

            const capitalInput = await question(`請輸入初始資金 (USDT, 預設 ${this.initialCapital}): `);
            if (capitalInput.trim()) {
                this.initialCapital = parseFloat(capitalInput) || this.initialCapital;
            }
            console.log(`✅ 初始資金設定為 $${this.initialCapital.toLocaleString()} USDT`);

            const feeInput = await question(`請輸入手續費率 (%, 預設 ${this.commissionRate * 100}): `);
            if (feeInput.trim()) {
                this.commissionRate = (parseFloat(feeInput) || 0) / 100;
            }
            console.log(`✅ 手續費率設定為 ${(this.commissionRate * 100).toFixed(3)}% (雙向)`);

            console.log('\n📅 時間分割週期設定:');
            console.log('1. 日週期 (每日一個週期)');
            console.log('2. 週週期 (每週一個週期)');
            console.log('3. 月週期 (每月一個週期)');
            console.log('4. 自訂週期 (自訂天數)');
            const periodChoice = await question('請選擇時間週期 (1-4, 預設: 1): ');
            let periodType = 'day';
            let periodLength = 1;
            switch (periodChoice) {
                case '2': periodType = 'week'; periodLength = 1; console.log('✅ 已設定為週週期'); break;
                case '3': periodType = 'month'; periodLength = 1; console.log('✅ 已設定為月週期'); break;
                case '4':
                    const customDays = await question('請輸入自訂天數: ');
                    periodType = 'day';
                    periodLength = parseInt(customDays) || 1;
                    console.log(`✅ 已設定為 ${periodLength} 天週期`);
                    break;
                default:
                    console.log('✅ 已設定為日週期');
            }

            console.log('\n📊 選擇熱力圖主要指標:');
            const metricOptions = Object.entries(this.metricProperties);
            metricOptions.forEach(([key, prop], index) => {
                console.log(`${index + 1}. ${prop.displayName}`);
            });
            const metricChoice = await question(`請選擇指標 (1-${metricOptions.length}, 預設: Sharpe Ratio): `);
            const chosenMetricIndex = parseInt(metricChoice) - 1;
            const chosenMetric = (chosenMetricIndex >= 0 && chosenMetricIndex < metricOptions.length)
                ? metricOptions[chosenMetricIndex][0]
                : 'sharpeRatio';
            console.log(`✅ 已選擇指標: ${this.metricProperties[chosenMetric].displayName}`);

            console.log('\n📈 PnL / Drawdown 分布圖設定:');
            const binSizeInput = await question(`請輸入分佈圖區間大小 (標準差倍數, 預設 ${this.binSizeInStdDev}): `);
            if (binSizeInput.trim()) {
                const parsedBinSize = parseFloat(binSizeInput);
                if (!isNaN(parsedBinSize) && parsedBinSize > 0) {
                    this.binSizeInStdDev = parsedBinSize;
                }
            }
            console.log(`✅ 分佈圖區間大小設定為 ${this.binSizeInStdDev} 標準差`);

            const rangeInput = await question(`請輸入圖表顯示的標準差範圍 (例如 5 代表 ±5 SD，預設 ${this.pnlDistributionDisplayRangeSD}): `);
            if (rangeInput.trim()) {
                const parsedRange = parseFloat(rangeInput);
                if (!isNaN(parsedRange) && parsedRange > 0) {
                    this.pnlDistributionDisplayRangeSD = parsedRange;
                }
            }
            console.log(`✅ 分佈圖顯示範圍設定為 ±${this.pnlDistributionDisplayRangeSD} 標準差`);

            rl.close();
            console.log('\n🚀 開始生成分析報告...');
            return await this.generateAllOutputs(periodType, periodLength, chosenMetric);

        } catch (error) {
            rl.close();
            throw error;
        }
    }
}

// 主程式執行
async function main() {
    try {
        console.log('🎯 組合策略深度分析工具 v3.0 (日級KPI + Drawdown Distribution)');
        console.log('🔧 創作者: LionAlgo');
        console.log('📅 支援 TradingView 回測數據轉實際下注分析');
        console.log('═'.repeat(60));
        const generator = new PortfolioHeatmapGenerator();
        const args = process.argv.slice(2);
        if (args.length > 0) {
            if (args[0] === 'fixed') {
                generator.positionSizeType = 'fixed';
                generator.positionSize = parseFloat(args[1]) || 100;
            } else if (args[0] === 'percentage') {
                generator.positionSizeType = 'percentage';
                generator.positionSize = parseFloat(args[1]) || 10;
            }
            if (args[2]) generator.initialCapital = parseFloat(args[2]);
            if (args[3]) generator.commissionRate = parseFloat(args[3]) / 100;
            const chosenMetric = args[4] || 'sharpeRatio';
            console.log('⚡ 快速模式執行中...');
            await generator.generateAllOutputs('day', 1, chosenMetric);
        } else {
            await generator.promptUserSettings();
        }
    } catch (error) {
        console.error(`\n❌ 程式執行失敗: ${error.message}`);
        console.error('\n🔍 請檢查:');
        console.error('1. "trade log input" 資料夾是否存在');
        console.error('2. 資料夾中是否有 CSV 或 Excel 檔案');
        console.error('3. 檔案格式是否正確 (包含交易數據)');
        console.error('4. 檔名是否符合解析格式');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = PortfolioHeatmapGenerator;
