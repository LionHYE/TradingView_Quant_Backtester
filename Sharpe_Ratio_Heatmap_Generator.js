const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const XLSX = require('xlsx');
const readline = require('readline');

// --- Color interpolation helper functions (保持不變) ---
function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}
function interpolateColor(color1, color2, factor) {
    let result = { r: Math.round(color1.r + factor * (color2.r - color1.r)), g: Math.round(color1.g + factor * (color2.g - color1.g)), b: Math.round(color1.b + factor * (color2.b - color1.b)) };
    return `rgb(${result.r}, ${result.g}, ${result.b})`;
}

class PortfolioHeatmapGenerator {
    constructor() {
        this.trades = [];
        this.periods = [];
        this.inputFolder = 'trade log input';
        this.portfolioInfo = {
            name: "組合策略",
            strategyNames: new Set(),
            brokers: new Set(),
            platforms: new Set(),
            symbols: new Set(),
            sourceFiles: new Set(),
            tradingDateRange: ''
        };
        this.detectedPnlColumn = null;
        this.detectedDateColumn = null;
        this.metricProperties = {
            sharpeRatio: { displayName: 'Sharpe Ratio', higherIsBetter: true, format: v => v.toFixed(3), colorThresholds: [ { threshold: 2.0, color: '#1a9850', description: '極佳 (>= 2.0)' }, { threshold: 1.0, color: '#66bd63', description: '良好' }, { threshold: 0.5, color: '#a6d96a', description: '尚可' }, { threshold: 0.0, color: '#fee08b', description: '勉強' }, { threshold: -0.5, color: '#d73027', description: '不佳 (< 0.0)' } ] },
            sortinoRatio: { displayName: 'Sortino Ratio', higherIsBetter: true, format: v => v.toFixed(3), colorThresholds: [ { threshold: 3.0, color: '#1a9850', description: '極佳 (>= 3.0)' }, { threshold: 2.0, color: '#66bd63', description: '良好' }, { threshold: 1.0, color: '#a6d96a', description: '尚可' }, { threshold: 0.0, color: '#fee08b', description: '勉強' }, { threshold: -1.0, color: '#d73027', description: '不佳 (< 0.0)' } ] },
            calmarRatio: { displayName: 'Calmar Ratio', higherIsBetter: true, format: v => v.toFixed(3), colorThresholds: [ { threshold: 3.0, color: '#1a9850', description: '極佳 (>= 3.0)' }, { threshold: 1.0, color: '#66bd63', description: '良好' }, { threshold: 0.5, color: '#a6d96a', description: '尚可' }, { threshold: 0.0, color: '#fee08b', description: '勉強' }, { threshold: -1.0, color: '#d73027', description: '不佳 (< 0.0)' } ] },
            mdd: { displayName: 'Max Drawdown (%)', higherIsBetter: false, format: v => v.toFixed(2), colorThresholds: [ { threshold: 5,  color: '#1a9850', description: '極佳 (< 5%)' }, { threshold: 10, color: '#a6d96a', description: '良好' }, { threshold: 20, color: '#fee08b', description: '尚可' }, { threshold: 30, color: '#f46d43', description: '警告' }, { threshold: 50, color: '#d73027', description: '危險 (> 30%)' } ] },
            winRate: { displayName: 'Win Rate (%)', higherIsBetter: true, format: v => v.toFixed(1), colorThresholds: [ { threshold: 65, color: '#1a9850', description: '極佳 (>= 65%)' }, { threshold: 55, color: '#66bd63', description: '良好' }, { threshold: 50, color: '#a6d96a', description: '尚可' }, { threshold: 45, color: '#fee08b', description: '勉強' }, { threshold: 40, color: '#d73027', description: '不佳 (< 45%)' } ] },
            omegaRatio: { displayName: 'Omega Ratio', higherIsBetter: true, format: v => v.toFixed(3) },
            var95: { displayName: 'VaR 95%', higherIsBetter: false, format: v => v.toFixed(2) },
            cvar95: { displayName: 'CVaR 95%', higherIsBetter: false, format: v => v.toFixed(2) },
            totalReturn: { displayName: 'Total Return', higherIsBetter: true, format: v => v.toFixed(2) },
        };
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
                const exchanges = ['BYBIT', 'BINANCE', 'OKX', 'BITGET', 'GATE', 'HUOBI', 'KUCOIN'];
                const exchangeIndex = platformParts.findIndex(part => exchanges.some(ex => part.toUpperCase().includes(ex)));
                
                if (exchangeIndex >= 0) {
                    broker = platformParts.slice(0, exchangeIndex).join(' ');
                    platform = platformParts[exchangeIndex];
                    symbol = platformParts.slice(exchangeIndex + 1).join('_').replace(/_\d{4}-\d{2}-\d{2}$/, '');
                }
                
                return { originalName: fileName, strategyName, broker, platform, symbol, parsed: true };
            }
            return { originalName: fileName, strategyName: nameWithoutExt.replace(/_/g, ' '), broker: 'N/A', platform: 'N/A', symbol: 'N/A', parsed: false };
        } catch (error) {
            console.log(`⚠️  檔名解析失敗: ${error.message}`);
            return { originalName: fileName, strategyName: fileName, broker: 'N/A', platform: 'N/A', symbol: 'N/A', parsed: false };
        }
    }

    findAllFiles() {
        const inputPath = path.resolve(this.inputFolder);
        if (!fs.existsSync(inputPath)) throw new Error(`❌ 找不到 "${this.inputFolder}" 資料夾`);
        const files = fs.readdirSync(inputPath).filter(file => (path.extname(file).toLowerCase() === '.csv' || path.extname(file).toLowerCase() === '.xlsx') && !file.startsWith('~'));
        if (files.length === 0) throw new Error(`❌ 在 "${this.inputFolder}" 中找不到任何 CSV 或 Excel 檔案`);
        console.log(`✅ 在 "${this.inputFolder}" 資料夾中找到 ${files.length} 個檔案:`);
        files.forEach(file => console.log(`   - ${file}`));
        return files.map(file => ({ fileName: file, fullPath: path.join(inputPath, file), extension: path.extname(file).toLowerCase() }));
    }

    readCSV(filePath) {
        return new Promise((resolve, reject) => {
            const results = [];
            fs.createReadStream(filePath).pipe(csv({ separator: '\t' })).on('data', (data) => results.push(data)).on('end', () => resolve(results)).on('error', reject);
        });
    }

    async readExcel(filePath) {
        const workbook = XLSX.readFile(filePath);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        return XLSX.utils.sheet_to_json(worksheet);
    }
    
    parseDateTime(dateStr) {
        if (!dateStr) return new Date('invalid');
        if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) return new Date(dateStr);
        if (!isNaN(dateStr)) {
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            return new Date(excelEpoch.getTime() + parseFloat(dateStr) * 24 * 60 * 60 * 1000);
        }
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) return date;
        console.warn(`⚠️  無法解析日期格式: "${dateStr}"`);
        return new Date('invalid');
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
                    const parsedInfo = this.parseFileName(file.fileName);
                    allTrades.push(...tradesFromFile);

                    this.portfolioInfo.strategyNames.add(parsedInfo.strategyName);
                    if(parsedInfo.broker) this.portfolioInfo.brokers.add(parsedInfo.broker);
                    if(parsedInfo.platform) this.portfolioInfo.platforms.add(parsedInfo.platform);
                    if(parsedInfo.symbol) this.portfolioInfo.symbols.add(parsedInfo.symbol);
                    this.portfolioInfo.sourceFiles.add(file.fileName);

                    console.log(`   ✅ 成功讀取並合併 ${tradesFromFile.length} 筆交易.`);
                } else {
                    console.log(`   ⚠️ 檔案 ${file.fileName} 為空，已跳過。`);
                }
            } catch (error) {
                console.error(`❌ 讀取檔案 ${file.fileName} 失敗: ${error.message}`);
            }
        }

        if (allTrades.length === 0) throw new Error("❌ 所有檔案都讀取失敗或為空。");

        const firstTrade = allTrades[0];
        const dateColumns = Object.keys(firstTrade).filter(key => ['date', 'time', 'timestamp', '日期', '時間', 'created', 'open', 'close'].some(k => key.toLowerCase().includes(k)));
        if (dateColumns.length === 0) throw new Error('❌ 在交易數據中找不到日期欄位。');
        this.detectedDateColumn = dateColumns[0];
        console.log(`\n📅 使用日期欄位進行排序: ${this.detectedDateColumn}`);

        this.trades = allTrades.map(trade => ({...trade, parsedDate: this.parseDateTime(trade[this.detectedDateColumn])})).filter(trade => !isNaN(trade.parsedDate.getTime()));
        this.trades.sort((a, b) => a.parsedDate - b.parsedDate);
        
        const startDate = this.trades[0].parsedDate.toISOString().split('T')[0];
        const endDate = this.trades[this.trades.length - 1].parsedDate.toISOString().split('T')[0];
        this.portfolioInfo.tradingDateRange = `${startDate} ~ ${endDate}`;
        
        console.log(`\n📈 所有檔案合併完成！總共 ${this.trades.length} 筆交易紀錄。`);
    }

    calculatePeriods(periodType, periodLength) {
        if (!this.trades || this.trades.length === 0) throw new Error('❌ 沒有可分析的交易紀錄');
        const startDate = this.trades[0].parsedDate, endDate = this.trades[this.trades.length - 1].parsedDate;
        let intervalMs;
        switch (periodType.toLowerCase()) {
            case 'day': case 'days': case '日': intervalMs = periodLength * 24 * 60 * 60 * 1000; break;
            case 'week': case 'weeks': case '週': case '周': intervalMs = periodLength * 7 * 24 * 60 * 60 * 1000; break;
            case 'month': case 'months': case '月': intervalMs = periodLength * 30 * 24 * 60 * 60 * 1000; break;
            default: throw new Error('❌ 不支援的週期類型');
        }
        const periods = []; let currentStart = new Date(startDate), periodIndex = 1;
        while (currentStart <= endDate) {
            const currentEnd = new Date(currentStart.getTime() + intervalMs);
            const periodTrades = this.trades.filter(trade => trade.parsedDate >= currentStart && trade.parsedDate < currentEnd);
            if (periodTrades.length > 0) periods.push({ index: periodIndex++, startDate: new Date(currentStart), endDate: new Date(currentEnd), trades: periodTrades });
            currentStart = currentEnd;
        }
        this.periods = periods;
        console.log(`\n📈 組合策略共分割為 ${periods.length} 個週期`);
        return periods;
    }

    calculatePeriodStats(periodTrades, initialCapital = 10000) {
        if (!periodTrades || periodTrades.length === 0) { const nullStats = {}; Object.keys(this.metricProperties).forEach(key => nullStats[key] = 0); nullStats.numTrades = 0; return nullStats; }
        if (!this.detectedPnlColumn) {
             const pnlColumns = Object.keys(periodTrades[0]).filter(key => ['p&l', 'pnl', 'profit', 'return', '損益', '獲利', '盈虧', 'pl', 'net', 'realized'].some(k => key.toLowerCase().includes(k)));
            if (pnlColumns.length === 0) throw new Error('❌ 找不到損益欄位');
            this.detectedPnlColumn = pnlColumns.find(col => !col.toLowerCase().includes('%')) || pnlColumns[0];
            console.log(`💰 使用損益欄位: ${this.detectedPnlColumn}`);
        }
        const returns = periodTrades.map(trade => parseFloat(String(trade[this.detectedPnlColumn]).replace(/,/g, '')) || 0);
        const numTrades = returns.length; const totalReturn = returns.reduce((sum, r) => sum + r, 0); const avgReturn = totalReturn / numTrades; const winningTrades = returns.filter(r => r > 0).length; const winRate = (winningTrades / numTrades) * 100; const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / numTrades); const sharpeRatio = stdDev === 0 ? 0 : avgReturn / stdDev; const negativeReturns = returns.filter(r => r < 0); const downsideDev = negativeReturns.length > 1 ? Math.sqrt(negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length) : 0; const sortinoRatio = downsideDev === 0 ? (avgReturn > 0 ? Infinity : 0) : avgReturn / downsideDev; let cumulativePnl = 0, peakPnl = 0, maxDrawdown = 0; returns.forEach(r => { cumulativePnl += r; peakPnl = Math.max(peakPnl, cumulativePnl); maxDrawdown = Math.max(maxDrawdown, peakPnl - cumulativePnl); }); const mdd = (maxDrawdown / (initialCapital + peakPnl)) * 100; const calmarRatio = maxDrawdown === 0 ? (totalReturn > 0 ? Infinity : 0) : totalReturn / maxDrawdown; const sortedReturns = [...returns].sort((a, b) => a - b); const varIndex = Math.floor(numTrades * 0.05); const var95 = sortedReturns[varIndex] || 0; const cvarReturns = sortedReturns.slice(0, varIndex + 1); const cvar95 = cvarReturns.length > 0 ? cvarReturns.reduce((sum, r) => sum + r, 0) / cvarReturns.length : 0; const gains = returns.filter(r => r > 0).reduce((sum, r) => sum + r, 0); const losses = Math.abs(returns.filter(r => r < 0).reduce((sum, r) => sum + r, 0)); const omegaRatio = losses === 0 ? (gains > 0 ? Infinity : 1) : gains / losses;
        return { numTrades, totalReturn, sharpeRatio: isNaN(sharpeRatio) ? 0 : sharpeRatio, sortinoRatio: isFinite(sortinoRatio) ? sortinoRatio : 0, calmarRatio: isFinite(calmarRatio) ? calmarRatio : 0, mdd: isNaN(mdd) ? 0 : mdd, winRate: isNaN(winRate) ? 0 : winRate, omegaRatio: isFinite(omegaRatio) ? omegaRatio : 0, var95: isNaN(var95) ? 0 : var95, cvar95: isNaN(cvar95) ? 0 : cvar95 };
    }

    generateRectangularHeatmapData() {
        if (!this.periods.length) throw new Error('❌ 請先計算時間週期');
        const heatmapData = this.periods.map(period => ({ period: period.index, startDate: period.startDate.toISOString().split('T')[0], endDate: period.endDate.toISOString().split('T')[0], ...this.calculatePeriodStats(period.trades) }));
        const cols = 20; const totalPeriods = heatmapData.length; const rows = Math.ceil(totalPeriods / cols); console.log(`📊 熱力圖矩陣大小: ${rows} 行 × ${cols} 列`);
        const rectangularMatrix = [];
        for (let row = 0; row < rows; row++) { for (let col = 0; col < cols; col++) { const index = row * cols + col; const cellData = index < heatmapData.length ? heatmapData[index] : { period: null }; const emptyCell = {}; if (cellData.period === null) Object.keys(this.metricProperties).forEach(key => emptyCell[key] = null); rectangularMatrix.push({ position: index + 1, row: row + 1, col: col + 1, ...cellData, ...emptyCell }); } }
        return { heatmapData, rectangularMatrix, dimensions: { rows, cols, totalPeriods } };
    }
    
    generateHeatmapHTML(heatmapData, rectangularMatrix, dimensions, chosenMetric) {
        const { cols } = dimensions;
        const metricInfo = this.metricProperties[chosenMetric];
        
        const portfolioName = Array.from(this.portfolioInfo.strategyNames).join(' + ') || '組合策略';
        const brokers = Array.from(this.portfolioInfo.brokers).join(', ') || 'N/A';
        const platforms = Array.from(this.portfolioInfo.platforms).join(', ') || 'N/A';
        const symbols = Array.from(this.portfolioInfo.symbols).join(', ') || 'N/A';
        
        const getColor = (value) => { if (value === null || isNaN(value) || !isFinite(value)) return '#f0f0f0'; if (metricInfo.colorThresholds && metricInfo.colorThresholds.length > 1) { const thresholds = metricInfo.higherIsBetter ? [...metricInfo.colorThresholds].sort((a, b) => b.threshold - a.threshold) : [...metricInfo.colorThresholds].sort((a, b) => a.threshold - b.threshold); if (metricInfo.higherIsBetter) { if (value >= thresholds[0].threshold) return thresholds[0].color; if (value <= thresholds[thresholds.length - 1].threshold) return thresholds[thresholds.length - 1].color; } else { if (value <= thresholds[0].threshold) return thresholds[0].color; if (value >= thresholds[thresholds.length - 1].threshold) return thresholds[thresholds.length - 1].color; } for (let i = 0; i < thresholds.length - 1; i++) { const upperStop = thresholds[i], lowerStop = thresholds[i + 1]; const inRange = metricInfo.higherIsBetter ? (value < upperStop.threshold && value >= lowerStop.threshold) : (value > upperStop.threshold && value <= lowerStop.threshold); if (inRange) { const range = upperStop.threshold - lowerStop.threshold; if (range === 0) return upperStop.color; const factor = (value - lowerStop.threshold) / range; const color1_rgb = hexToRgb(lowerStop.color), color2_rgb = hexToRgb(upperStop.color); if (!color1_rgb || !color2_rgb) return '#f0f0f0'; return interpolateColor(color1_rgb, color2_rgb, factor); } } return thresholds[thresholds.length - 1].color; } const validValues = heatmapData.map(d => d[chosenMetric]).filter(v => v !== null && !isNaN(v) && isFinite(v)); const minValue = Math.min(...validValues), maxValue = Math.max(...validValues); let normalized = (value - minValue) / (maxValue - minValue); if (maxValue === minValue) normalized = 0.5; if (!metricInfo.higherIsBetter) normalized = 1 - normalized; const r = Math.round(255 * Math.min(1, 2 * (1 - normalized))), g = Math.round(255 * Math.min(1, 2 * normalized)); return `rgb(${r}, ${g}, 50)`; };
        const generateLegendHTML = (metricInfo) => { if (!metricInfo.colorThresholds || metricInfo.colorThresholds.length === 0) return '<p>使用相對顏色標度 (紅: 差 -> 綠: 優)。</p>'; let legendItems = ''; const thresholds = metricInfo.higherIsBetter ? [...metricInfo.colorThresholds].sort((a,b) => b.threshold - a.threshold) : [...metricInfo.colorThresholds].sort((a,b) => a.threshold - b.threshold); for (const item of thresholds) legendItems += `<div class="legend-item"><span class="legend-color" style="background-color: ${item.color};"></span>${item.description}</div>`; return `<div class="legend">${legendItems}</div>`; };

        const html = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <title>${metricInfo.displayName} 熱力圖 - ${portfolioName}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 20px; background-color: #f4f6f9; color: #333; }
        .container { max-width: 1600px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        .header { text-align: center; /* <<< 這行確保標題和副標題置中 */ margin-bottom: 25px; }
        .header h1 { font-size: 28px; color: #1a253c; margin-bottom: 5px; }
        .header h2 { font-size: 20px; color: #5a6ac2; font-weight: 500; }
        .strategy-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; padding: 25px; background: #fafbff; border-radius: 10px; border: 1px solid #e8eaf1; }
        .info-item { text-align: center; }
        .info-label { font-weight: 600; color: #777; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
        .info-value { font-size: 18px; color: #2c3e50; margin-top: 6px; font-weight: 500; word-break: break-word; }
        .heatmap-container { overflow-x: auto; padding-bottom: 10px; }
        .heatmap { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 3px; min-width: ${cols * 45}px; }
        .cell { aspect-ratio: 1; min-width: 40px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: white; border-radius: 4px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; position: relative; text-shadow: 1px 1px 2px rgba(0,0,0,0.4); }
        .cell:hover { transform: scale(1.15); z-index: 10; box-shadow: 0 6px 12px rgba(0,0,0,0.3); }
        .cell.empty { background-color: #e9ecef; }
        .tooltip { visibility: hidden; position: absolute; background: rgba(0,0,0,0.85); color: white; padding: 10px; border-radius: 6px; font-size: 12px; pointer-events: none; z-index: 1000; white-space: nowrap; transform: translate(-50%, -110%); top: 0; left: 50%; opacity: 0; transition: opacity 0.2s, visibility 0.2s; }
        .tooltip-grid { display: grid; grid-template-columns: auto auto; gap: 4px 12px; }
        .tooltip-label { font-weight: 600; color: #a0a0a0; }
        .cell:hover .tooltip { visibility: visible; opacity: 1; }
        .legend-section { margin-top: 30px; padding: 15px; background-color: #f8f9fa; border-radius: 8px; }
        .legend-section h3 { margin-top: 0; text-align: center; font-size: 16px; color: #333; }
        .legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; }
        .legend-item { display: flex; align-items: center; font-size: 13px; }
        .legend-color { width: 15px; height: 15px; border-radius: 3px; margin-right: 8px; border: 1px solid rgba(0,0,0,0.1); }
        .stats-section { margin-top: 40px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; }
        .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border: 1px solid #e8eaf1; }
        .stat-value { font-size: 26px; font-weight: 700; color: #2c3e50; }
        .stat-label { font-size: 13px; color: #667; margin-top: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${metricInfo.displayName} 熱力圖分析</h1>
            <h2>${portfolioName}</h2>
        </div>
        
        <div class="strategy-info">
            <div class="info-item"><div class="info-label">策略創作者</div><div class="info-value">${brokers}</div></div>
            <div class="info-item"><div class="info-label">交易所</div><div class="info-value">${platforms}</div></div>
            <div class="info-item"><div class="info-label">交易對</div><div class="info-value">${symbols}</div></div>
            <div class="info-item"><div class="info-label">交易日期</div><div class="info-value">${this.portfolioInfo.tradingDateRange}</div></div>
        </div>
        
        <div class="heatmap-container">
             <div class="heatmap">${rectangularMatrix.map(cell => { if (cell.period === null) return `<div class="cell empty"></div>`; const cellValue = cell[chosenMetric]; const displayValue = (cellValue !== null && isFinite(cellValue)) ? metricInfo.format(cellValue) : 'N/A'; return `<div class="cell" style="background-color: ${getColor(cellValue)};">${displayValue}<div class="tooltip"><div class="tooltip-grid"><div class="tooltip-label">週期:</div> <div>${cell.period}</div><div class="tooltip-label">日期:</div> <div>${cell.startDate}</div><hr style="grid-column: 1 / -1; border-color: #555; margin: 2px 0;">${Object.entries(this.metricProperties).map(([key, prop]) => `<div class="tooltip-label">${prop.displayName}:</div><div>${(cell[key] !== null && isFinite(cell[key])) ? prop.format(cell[key]) : 'N/A'}</div>`).join('')}<div class="tooltip-label">交易數:</div> <div>${cell.numTrades}</div></div></div></div>`; }).join('')}</div>
        </div>
        
        <div class="legend-section">
            <h3>顏色圖例 (${metricInfo.displayName})</h3>
            ${generateLegendHTML(metricInfo)}
        </div>

        <div class="stats-section">
             <div class="stats-grid">${Object.entries(this.metricProperties).map(([key, prop]) => { const values = heatmapData.map(d => d[key]).filter(v => v !== null && isFinite(v)); if (values.length === 0) return ''; const avgValue = values.reduce((s, v) => s + v, 0) / values.length; return `<div class="stat-card"><div class="stat-value">${prop.format(avgValue)}</div><div class="stat-label">平均 ${prop.displayName}</div></div>`; }).join('')}<div class="stat-card"><div class="stat-value">${heatmapData.reduce((s, d) => s + d.numTrades, 0)}</div><div class="stat-label">總交易數</div></div></div>
        </div>

        <div style="margin-top: 30px; text-align: center; color: #999; font-size: 12px;">
            <p>熱力圖生成於 ${new Date().toLocaleString('zh-TW')} | 數據來源: ${Array.from(this.portfolioInfo.sourceFiles).join(', ')}</p>
        </div>
    </div>
</body>
</html>`;
        return html;
    }

    async generateAllOutputs(periodType = 'day', periodLength = 1, chosenMetric = 'sharpeRatio') {
        try {
            console.log('\n🚀 開始生成組合策略分析報告...\n');
            await this.autoReadAllFilesAndCombine();
            this.calculatePeriods(periodType, periodLength);
            
            const { heatmapData, rectangularMatrix, dimensions } = this.generateRectangularHeatmapData();
            if (heatmapData.length === 0) { console.warn('⚠️ 沒有足夠的數據來生成報告。'); return; }
            
            const htmlContent = this.generateHeatmapHTML(heatmapData, rectangularMatrix, dimensions, chosenMetric);
            
            const outputDir = 'sharpe_heatmap_output';
            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
            const baseName = "Combined_Portfolio";
            
            const htmlPath = path.join(outputDir, `${baseName}_${chosenMetric}_heatmap_${timestamp}.html`);
            fs.writeFileSync(htmlPath, htmlContent, 'utf8');
            
            const csvPath = path.join(outputDir, `${baseName}_full_stats_${timestamp}.csv`);
            const csvHeader = [ { id: 'period', title: 'Period' }, { id: 'startDate', title: 'Start Date' }, { id: 'endDate', title: 'End Date' }, ...Object.entries(this.metricProperties).map(([key, prop]) => ({ id: key, title: prop.displayName })), { id: 'numTrades', title: 'Num Trades' } ];
            const csvWriter = createCsvWriter({ path: csvPath, header: csvHeader });
            await csvWriter.writeRecords(heatmapData);

            console.log('\n✅ 組合分析報告生成完成！');
            console.log(`📁 輸出目錄: ${outputDir}`);
            console.log(`🎯 主顯示指標: ${this.metricProperties[chosenMetric].displayName}`);
            console.log('\n📋 輸出檔案:');
            console.log(`   • HTML 熱力圖: ${path.basename(htmlPath)}`);
            console.log(`   • CSV 詳細數據: ${path.basename(csvPath)}`);
        } catch (error) {
            console.error('❌ 生成過程發生錯誤:', error.message);
        }
    }

    async interactiveSetup() {
         const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const question = (query) => new Promise(resolve => rl.question(query, resolve));
        try {
            console.log('🎯 組合策略表現熱力圖生成器');
            console.log('====================================\n');
            const periodType = await question('📅 請選擇週期類型 (day/week/month) [預設: day]: ') || 'day';
            const periodLengthInput = await question('📊 請輸入週期長度 (數字) [預設: 1]: ') || '1';
            const periodLength = parseInt(periodLengthInput) || 1;
            console.log('\n📈 請選擇熱力圖主顯示指標:');
            const metricKeys = Object.keys(this.metricProperties);
            metricKeys.forEach((key, index) => { console.log(`   ${index + 1}. ${this.metricProperties[key].displayName} (${key})`); });
            const metricChoiceInput = await question(`請輸入選項編號或名稱 [預設: 1 / sharpeRatio]: `) || '1';
            let chosenMetric;
            const choiceIndex = parseInt(metricChoiceInput) - 1;
            if (metricKeys[choiceIndex]) { chosenMetric = metricKeys[choiceIndex]; } else if (this.metricProperties[metricChoiceInput]) { chosenMetric = metricChoiceInput; } else { chosenMetric = 'sharpeRatio'; console.log('無效輸入，將使用預設指標: Sharpe Ratio'); }
            console.log(`\n⚙️  設定確認:`);
            console.log(`   週期: ${periodLength} ${periodType}`);
            console.log(`   主指標: ${this.metricProperties[chosenMetric].displayName}`);
            const confirm = await question('\n🚀 開始生成? (y/N): ');
            if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
                await this.generateAllOutputs(periodType, periodLength, chosenMetric);
            } else { console.log('❌ 已取消生成'); }
        } finally { rl.close(); }
    }
}

async function main() {
    const generator = new PortfolioHeatmapGenerator();
    try {
        await generator.interactiveSetup();
    } catch (error) {
        console.error('\n❌ 程式執行失敗:', error.message);
    }
}

if (require.main === module) {
    main();
}

module.exports = PortfolioHeatmapGenerator;
