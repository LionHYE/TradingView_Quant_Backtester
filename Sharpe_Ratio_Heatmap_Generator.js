const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const XLSX = require('xlsx');
const readline = require('readline');

// *** NEW: Color interpolation helper functions ***

/**
 * Converts a HEX color string to an RGB object.
 * @param {string} hex - The hex color string (e.g., "#d73027").
 * @returns {{r: number, g: number, b: number}} An object with r, g, b values.
 */
function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

/**
 * Interpolates between two colors.
 * @param {{r,g,b}} color1 - The starting color object.
 * @param {{r,g,b}} color2 - The ending color object.
 * @param {number} factor - The interpolation factor (0 to 1). 0 means color1, 1 means color2.
 * @returns {string} The resulting color as an "rgb(r,g,b)" string.
 */
function interpolateColor(color1, color2, factor) {
    let result = {
        r: Math.round(color1.r + factor * (color2.r - color1.r)),
        g: Math.round(color1.g + factor * (color2.g - color1.g)),
        b: Math.round(color1.b + factor * (color2.b - color1.b)),
    };
    return `rgb(${result.r}, ${result.g}, ${result.b})`;
}

class SharpeHeatmapGenerator {
    constructor() {
        this.trades = [];
        this.periods = [];
        this.inputFolder = 'trade log input';
        this.fileInfo = null;
        this.detectedPnlColumn = null;

        // *** MODIFIED: colorThresholds now act as "stops" for the color gradient ***
        // 您可以自由新增或修改這些顏色停靠點來客製化漸層效果
        this.metricProperties = {
            sharpeRatio: { 
                displayName: 'Sharpe Ratio', 
                higherIsBetter: true, 
                format: v => v.toFixed(3),
                colorThresholds: [
                    { threshold: 2.0, color: '#1a9850', description: '極佳 (>= 2.0)' },  // Deep Green
                    { threshold: 1.0, color: '#66bd63', description: '良好' },          // Green
                    { threshold: 0.5, color: '#a6d96a', description: '尚可' },          // Light Green
                    { threshold: 0.0, color: '#fee08b', description: '勉強' },          // Yellow
                    { threshold: -0.5, color: '#d73027', description: '不佳 (< 0.0)' }    // Red
                ]
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
                ]
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
                ]
            },
            mdd: { 
                displayName: 'Max Drawdown (%)', 
                higherIsBetter: false, 
                format: v => v.toFixed(2),
                colorThresholds: [
                    { threshold: 5,  color: '#1a9850', description: '極佳 (< 5%)' },
                    { threshold: 10, color: '#a6d96a', description: '良好' },
                    { threshold: 20, color: '#fee08b', description: '尚可' },
                    { threshold: 30, color: '#f46d43', description: '警告' },
                    { threshold: 50, color: '#d73027', description: '危險 (> 30%)' }
                ]
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
                ]
            },
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
                
                const dateMatch = detailsPart.match(/(\d{4}-\d{2}-\d{2})$/);
                let tradingDate = null;
                let platformInfo = detailsPart;
                
                if (dateMatch) {
                    tradingDate = dateMatch[1];
                    platformInfo = detailsPart.replace(`_${tradingDate}`, '');
                }
                
                const platformParts = platformInfo.split('_');
                let platform = '';
                let symbol = '';
                let broker = '';
                
                const exchanges = ['BYBIT', 'BINANCE', 'OKX', 'BITGET', 'GATE', 'HUOBI', 'KUCOIN'];
                const exchangeIndex = platformParts.findIndex(part => 
                    exchanges.some(ex => part.toUpperCase().includes(ex))
                );
                
                if (exchangeIndex >= 0) {
                    broker = platformParts.slice(0, exchangeIndex).join(' ');
                    platform = platformParts[exchangeIndex];
                    symbol = platformParts.slice(exchangeIndex + 1).join('_');
                } else {
                    if (platformParts.length >= 3) {
                        broker = platformParts[0];
                        platform = platformParts[1];
                        symbol = platformParts.slice(2).join('_');
                    }
                }
                
                return {
                    originalName: fileName,
                    strategyName: strategyName,
                    broker: broker,
                    platform: platform,
                    symbol: symbol,
                    tradingDate: tradingDate,
                    parsed: true
                };
            }
            
            return {
                originalName: fileName,
                strategyName: nameWithoutExt.replace(/_/g, ' '),
                broker: 'Unknown',
                platform: 'Unknown',
                symbol: 'Unknown',
                tradingDate: null,
                parsed: false
            };
            
        } catch (error) {
            console.log(`⚠️  檔名解析失敗: ${error.message}`);
            return {
                originalName: fileName,
                strategyName: fileName,
                broker: 'Unknown',
                platform: 'Unknown',
                symbol: 'Unknown',
                tradingDate: null,
                parsed: false
            };
        }
    }

    findCSVFile() {
        const inputPath = path.resolve(this.inputFolder);
        
        if (!fs.existsSync(inputPath)) {
            throw new Error(`❌ 找不到 "${this.inputFolder}" 資料夾，請在程式目錄下創建此資料夾`);
        }

        const files = fs.readdirSync(inputPath);
        const csvFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ext === '.csv' || ext === '.xlsx';
        });

        if (csvFiles.length === 0) {
            throw new Error(`❌ 在 "${this.inputFolder}" 資料夾中找不到 CSV 或 Excel 檔案`);
        }

        if (csvFiles.length > 1) {
            console.log(`⚠️  在 "${this.inputFolder}" 資料夾中找到多個檔案:`);
            csvFiles.forEach((file, index) => {
                const parsedInfo = this.parseFileName(file);
                console.log(`   ${index + 1}. ${file}`);
                if (parsedInfo.parsed) {
                    console.log(`      策略: ${parsedInfo.strategyName}`);
                    console.log(`      平台: ${parsedInfo.broker} ${parsedInfo.platform}`);
                    console.log(`      交易對: ${parsedInfo.symbol}`);
                    console.log(`      日期: ${parsedInfo.tradingDate || 'N/A'}`);
                }
            });
            throw new Error('❌ 請確保資料夾中只有一個 CSV 或 Excel 檔案');
        }

        const csvFile = csvFiles[0];
        const fullPath = path.join(inputPath, csvFile);
        const parsedInfo = this.parseFileName(csvFile);
        
        console.log(`✅ 自動找到檔案: ${csvFile}`);
        console.log(`📁 完整路徑: ${fullPath}`);
        
        if (parsedInfo.parsed) {
            console.log('\n📊 檔案資訊解析:');
            console.log(`   🎯 策略名稱: ${parsedInfo.strategyName}`);
            console.log(`   👤 策略創作者: ${parsedInfo.broker}`);
            console.log(`   🏛️  交易所: ${parsedInfo.platform}`);
            console.log(`   💱 交易對: ${parsedInfo.symbol}`);
            console.log(`   📅 交易日期: ${parsedInfo.tradingDate || 'N/A'}`);
        } else {
            console.log('⚠️  無法完全解析檔名格式，將使用預設設定');
        }
        
        return {
            fileName: csvFile,
            fullPath: fullPath,
            extension: path.extname(csvFile).toLowerCase(),
            parsedInfo: parsedInfo
        };
    }

    readCSV(filePath) {
        return new Promise((resolve, reject) => {
            const results = [];
            fs.createReadStream(filePath)
                .pipe(csv({ separator: '\t' }))
                .on('data', (data) => results.push(data))
                .on('end', () => {
                    this.trades = results;
                    if (results.length > 0) {
                       console.log(`✅ 成功讀取 ${results.length} 筆交易紀錄`);
                       console.log('🔍 偵測到的欄位:', Object.keys(results[0]));
                    } else {
                       console.warn('⚠️ 檔案讀取成功，但沒有任何交易紀錄。');
                    }
                    resolve(results);
                })
                .on('error', (error) => {
                    console.error('❌ CSV讀取錯誤:', error.message);
                    reject(error);
                });
        });
    }

    async readExcel(filePath) {
        try {
            const workbook = XLSX.readFile(filePath);
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);
            
            this.trades = data;
            console.log(`✅ 成功讀取 ${data.length} 筆交易紀錄 (來自工作表: ${firstSheetName})`);
            return data;
        } catch (error) {
            throw new Error(`❌ 讀取Excel檔案失敗: ${error.message}`);
        }
    }

    async autoReadFile() {
        this.fileInfo = this.findCSVFile();
        
        if (this.fileInfo.extension === '.xlsx') {
            return await this.readExcel(this.fileInfo.fullPath);
        } else {
            return await this.readCSV(this.fileInfo.fullPath);
        }
    }

    parseDateTime(dateStr) {
        if (!dateStr) return new Date('invalid');

        if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
            return new Date(dateStr);
        }
        
        if (!isNaN(dateStr)) {
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            return new Date(excelEpoch.getTime() + parseFloat(dateStr) * 24 * 60 * 60 * 1000);
        }
        
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            return date;
        }
        
        console.warn(`⚠️  無法解析日期格式: "${dateStr}"`);
        return new Date('invalid');
    }

    calculatePeriods(periodType, periodLength) {
        if (!this.trades || !this.trades.length) {
            throw new Error('❌ 檔案中沒有可分析的交易紀錄');
        }
        const dateColumns = Object.keys(this.trades[0]).filter(key => 
            key.toLowerCase().includes('date') || key.toLowerCase().includes('time') || key.toLowerCase().includes('timestamp') ||
            key.toLowerCase().includes('日期') || key.toLowerCase().includes('時間') || key.toLowerCase().includes('created') ||
            key.toLowerCase().includes('open') || key.toLowerCase().includes('close')
        );
        if (dateColumns.length === 0) {
            throw new Error('❌ 找不到日期欄位');
        }
        const dateColumn = dateColumns[0];
        console.log(`📅 使用日期欄位: ${dateColumn}`);
        const tradesWithDate = this.trades.map(trade => ({
            ...trade,
            parsedDate: this.parseDateTime(trade[dateColumn])
        })).filter(trade => !isNaN(trade.parsedDate.getTime()));
        if (tradesWithDate.length === 0) {
            throw new Error(`❌ 解析日期後沒有任何有效的交易紀錄。`);
        }
        tradesWithDate.sort((a, b) => a.parsedDate - b.parsedDate);
        const startDate = tradesWithDate[0].parsedDate;
        const endDate = tradesWithDate[tradesWithDate.length - 1].parsedDate;
        console.log(`📊 交易期間: ${startDate.toISOString()} 至 ${endDate.toISOString()}`);
        if (this.fileInfo && this.fileInfo.parsedInfo && !this.fileInfo.parsedInfo.tradingDate) {
            const formatDate = (date) => date.toISOString().split('T')[0];
            const dateRange = `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
            this.fileInfo.parsedInfo.tradingDate = dateRange;
            console.log(`ℹ️  未在檔名中找到日期，已從交易數據中自動獲取交易區間: ${dateRange}`);
        }
        let intervalMs;
        switch (periodType.toLowerCase()) {
            case 'day': case 'days': case '日': intervalMs = periodLength * 24 * 60 * 60 * 1000; break;
            case 'week': case 'weeks': case '週': case '周': intervalMs = periodLength * 7 * 24 * 60 * 60 * 1000; break;
            case 'month': case 'months': case '月': intervalMs = periodLength * 30 * 24 * 60 * 60 * 1000; break;
            default: throw new Error('❌ 不支援的週期類型');
        }
        const periods = [];
        let currentStart = new Date(startDate);
        let periodIndex = 1;
        while (currentStart <= endDate) {
            const currentEnd = new Date(currentStart.getTime() + intervalMs);
            const periodTrades = tradesWithDate.filter(trade => trade.parsedDate >= currentStart && trade.parsedDate < currentEnd);
            if (periodTrades.length > 0) {
                periods.push({
                    index: periodIndex,
                    startDate: new Date(currentStart),
                    endDate: new Date(currentEnd),
                    trades: periodTrades
                });
                periodIndex++;
            }
            currentStart = currentEnd;
        }
        this.periods = periods;
        console.log(`📈 共分割為 ${periods.length} 個週期`);
        return periods;
    }

    calculatePeriodStats(periodTrades, initialCapital = 10000) {
        if (!periodTrades || periodTrades.length === 0) {
            const nullStats = {};
            Object.keys(this.metricProperties).forEach(key => nullStats[key] = 0);
            nullStats.numTrades = 0;
            return nullStats;
        }

        const pnlColumns = Object.keys(periodTrades[0]).filter(key => 
            ['p&l', 'pnl', 'profit', 'return', '損益', '獲利', '盈虧', 'pl', 'net', 'realized'].some(k => key.toLowerCase().includes(k))
        );
        if (pnlColumns.length === 0) throw new Error('❌ 找不到損益欄位');
        
        const pnlColumn = pnlColumns.find(col => !col.toLowerCase().includes('%')) || pnlColumns[0];
        if (!this.detectedPnlColumn) {
            this.detectedPnlColumn = pnlColumn;
            console.log(`💰 使用損益欄位: ${this.detectedPnlColumn}`);
        }
        
        const returns = periodTrades.map(trade => {
            const pnlValue = trade[this.detectedPnlColumn];
            return parseFloat(String(pnlValue).replace(/,/g, '')) || 0;
        });

        const numTrades = returns.length;
        const totalReturn = returns.reduce((sum, r) => sum + r, 0);
        const avgReturn = totalReturn / numTrades;
        
        const winningTrades = returns.filter(r => r > 0).length;
        const winRate = (winningTrades / numTrades) * 100;

        const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / numTrades);
        const sharpeRatio = stdDev === 0 ? 0 : avgReturn / stdDev;
        
        const negativeReturns = returns.filter(r => r < 0);
        const downsideDev = negativeReturns.length > 1 ? Math.sqrt(negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length) : 0;
        const sortinoRatio = downsideDev === 0 ? (avgReturn > 0 ? Infinity : 0) : avgReturn / downsideDev;

        let cumulativePnl = 0;
        let peakPnl = 0;
        let maxDrawdown = 0;
        returns.forEach(r => {
            cumulativePnl += r;
            peakPnl = Math.max(peakPnl, cumulativePnl);
            const drawdown = peakPnl - cumulativePnl;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        });
        const mdd = (maxDrawdown / (initialCapital + peakPnl)) * 100;
        const calmarRatio = maxDrawdown === 0 ? (totalReturn > 0 ? Infinity : 0) : totalReturn / maxDrawdown;

        const sortedReturns = [...returns].sort((a, b) => a - b);
        const varIndex = Math.floor(numTrades * 0.05);
        const var95 = sortedReturns[varIndex] || 0;
        const cvarReturns = sortedReturns.slice(0, varIndex + 1);
        const cvar95 = cvarReturns.length > 0 ? cvarReturns.reduce((sum, r) => sum + r, 0) / cvarReturns.length : 0;
        
        const gains = returns.filter(r => r > 0).reduce((sum, r) => sum + r, 0);
        const losses = Math.abs(returns.filter(r => r < 0).reduce((sum, r) => sum + r, 0));
        const omegaRatio = losses === 0 ? (gains > 0 ? Infinity : 1) : gains / losses;

        return {
            numTrades,
            totalReturn,
            sharpeRatio: isNaN(sharpeRatio) ? 0 : sharpeRatio,
            sortinoRatio: isFinite(sortinoRatio) ? sortinoRatio : 0,
            calmarRatio: isFinite(calmarRatio) ? calmarRatio : 0,
            mdd: isNaN(mdd) ? 0 : mdd,
            winRate: isNaN(winRate) ? 0 : winRate,
            omegaRatio: isFinite(omegaRatio) ? omegaRatio : 0,
            var95: isNaN(var95) ? 0 : var95,
            cvar95: isNaN(cvar95) ? 0 : cvar95,
        };
    }

    generateRectangularHeatmapData() {
        if (!this.periods.length) throw new Error('❌ 請先計算時間週期');

        const heatmapData = this.periods.map(period => {
            const stats = this.calculatePeriodStats(period.trades);
            return {
                period: period.index,
                startDate: period.startDate.toISOString().split('T')[0],
                endDate: period.endDate.toISOString().split('T')[0],
                ...stats,
            };
        });

        const cols = 20;
        const totalPeriods = heatmapData.length;
        const rows = Math.ceil(totalPeriods / cols);
        console.log(`📊 熱力圖矩陣大小: ${rows} 行 × ${cols} 列 (總共 ${totalPeriods} 個週期)`);
        const rectangularMatrix = [];
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = row * cols + col;
                if (index < heatmapData.length) {
                    rectangularMatrix.push({ position: index + 1, row: row + 1, col: col + 1, ...heatmapData[index] });
                } else {
                    const emptyCell = { position: index + 1, row: row + 1, col: col + 1, period: null };
                    Object.keys(this.metricProperties).forEach(key => emptyCell[key] = null);
                    rectangularMatrix.push(emptyCell);
                }
            }
        }
        return { heatmapData, rectangularMatrix, dimensions: { rows, cols, totalPeriods } };
    }

    // *** MODIFIED: 生成HTML熱力圖視覺化 (支援平滑漸層顏色) ***
    generateHeatmapHTML(heatmapData, rectangularMatrix, dimensions, chosenMetric) {
        const { cols } = dimensions;
        const strategyInfo = this.fileInfo.parsedInfo;
        const metricInfo = this.metricProperties[chosenMetric];
        
        const generateLegendHTML = (metricInfo) => {
            if (!metricInfo.colorThresholds || metricInfo.colorThresholds.length === 0) {
                return '<p>使用相對顏色標度 (紅: 差 -> 綠: 優)。</p>';
            }
            let legendItems = '';
            const thresholds = metricInfo.higherIsBetter 
                ? [...metricInfo.colorThresholds].sort((a,b) => b.threshold - a.threshold)
                : [...metricInfo.colorThresholds].sort((a,b) => a.threshold - b.threshold);
                
            for (const item of thresholds) {
                legendItems += `<div class="legend-item"><span class="legend-color" style="background-color: ${item.color};"></span>${item.description}</div>`;
            }
            return `<div class="legend">${legendItems}</div>`;
        };

        const getColor = (value) => {
            if (value === null || isNaN(value) || !isFinite(value)) return '#f0f0f0';
            
            // *** NEW: 平滑漸層顏色邏輯 ***
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
                        const color1_rgb = hexToRgb(lowerStop.color);
                        const color2_rgb = hexToRgb(upperStop.color);

                        if (!color1_rgb || !color2_rgb) return '#f0f0f0';

                        return interpolateColor(color1_rgb, color2_rgb, factor);
                    }
                }
                
                return thresholds[thresholds.length - 1].color; // Fallback
            }

            // *** FALLBACK: 原本的相對顏色邏輯 ***
            const validValues = heatmapData.map(d => d[chosenMetric]).filter(v => v !== null && !isNaN(v) && isFinite(v));
            const minValue = Math.min(...validValues);
            const maxValue = Math.max(...validValues);
            let normalized = (value - minValue) / (maxValue - minValue);
            if (maxValue === minValue) normalized = 0.5;
            if (!metricInfo.higherIsBetter) normalized = 1 - normalized;
            const r = Math.round(255 * Math.min(1, 2 * (1 - normalized)));
            const g = Math.round(255 * Math.min(1, 2 * normalized));
            return `rgb(${r}, ${g}, 50)`;
        };

        const html = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <title>${metricInfo.displayName} 熱力圖 - ${strategyInfo.strategyName}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 20px; background-color: #f4f6f9; color: #333; }
        .container { max-width: 1600px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        .header { text-align: center; margin-bottom: 25px; }
        .header h1 { font-size: 28px; color: #1a253c; margin-bottom: 5px; }
        .header h2 { font-size: 20px; color: #5a6ac2; font-weight: 500; }
        .strategy-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; padding: 25px; background: #fafbff; border-radius: 10px; border: 1px solid #e8eaf1; }
        .info-item { text-align: center; }
        .info-label { font-weight: 600; color: #777; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
        .info-value { font-size: 18px; color: #2c3e50; margin-top: 6px; font-weight: 500; }
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
            <h2>${strategyInfo.strategyName}</h2>
        </div>
        <div class="strategy-info">
            <div class="info-item"><div class="info-label">策略創作者</div><div class="info-value">${strategyInfo.broker || 'N/A'}</div></div>
            <div class="info-item"><div class="info-label">交易所</div><div class="info-value">${strategyInfo.platform || 'N/A'}</div></div>
            <div class="info-item"><div class="info-label">交易對</div><div class="info-value">${strategyInfo.symbol || 'N/A'}</div></div>
            <div class="info-item"><div class="info-label">交易日期</div><div class="info-value">${strategyInfo.tradingDate || 'N/A'}</div></div>
        </div>
        <div class="heatmap-container">
            <div class="heatmap">
                ${rectangularMatrix.map(cell => {
                    if (cell.period === null) return `<div class="cell empty"></div>`;
                    const cellValue = cell[chosenMetric];
                    const displayValue = (cellValue !== null && isFinite(cellValue)) ? metricInfo.format(cellValue) : 'N/A';
                    return `
                        <div class="cell" style="background-color: ${getColor(cellValue)};">
                            ${displayValue}
                            <div class="tooltip">
                                <div class="tooltip-grid">
                                    <div class="tooltip-label">週期:</div> <div>${cell.period}</div>
                                    <div class="tooltip-label">日期:</div> <div>${cell.startDate}</div>
                                    <hr style="grid-column: 1 / -1; border-color: #555; margin: 2px 0;">
                                    ${Object.entries(this.metricProperties).map(([key, prop]) => `
                                        <div class="tooltip-label">${prop.displayName}:</div>
                                        <div>${(cell[key] !== null && isFinite(cell[key])) ? prop.format(cell[key]) : 'N/A'}</div>
                                    `).join('')}
                                    <div class="tooltip-label">交易數:</div> <div>${cell.numTrades}</div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        <div class="legend-section">
            <h3>顏色圖例 (${metricInfo.displayName})</h3>
            ${generateLegendHTML(metricInfo)}
        </div>
        <div class="stats-section">
            <div class="stats-grid">
                ${Object.entries(this.metricProperties).map(([key, prop]) => {
                    const values = heatmapData.map(d => d[key]).filter(v => v !== null && isFinite(v));
                    if (values.length === 0) return '';
                    const avgValue = values.reduce((s, v) => s + v, 0) / values.length;
                    return `
                        <div class="stat-card">
                            <div class="stat-value">${prop.format(avgValue)}</div>
                            <div class="stat-label">平均 ${prop.displayName}</div>
                        </div>
                    `;
                }).join('')}
                <div class="stat-card">
                    <div class="stat-value">${heatmapData.reduce((s, d) => s + d.numTrades, 0)}</div>
                    <div class="stat-label">總交易數</div>
                </div>
            </div>
        </div>
        <div style="margin-top: 30px; text-align: center; color: #999; font-size: 12px;">
            <p>熱力圖生成於 ${new Date().toLocaleString('zh-TW')} | 數據來源: ${this.fileInfo.fileName}</p>
        </div>
    </div>
</body>
</html>`;
        return html;
    }

    async generateAllOutputs(periodType = 'day', periodLength = 1, chosenMetric = 'sharpeRatio') {
        try {
            console.log('\n🚀 開始生成多維度策略分析報告...\n');
            await this.autoReadFile();
            this.calculatePeriods(periodType, periodLength);
            
            const { heatmapData, rectangularMatrix, dimensions } = this.generateRectangularHeatmapData();
            if (heatmapData.length === 0) {
                console.warn('⚠️ 沒有足夠的數據來生成報告。');
                return;
            }
            
            const htmlContent = this.generateHeatmapHTML(heatmapData, rectangularMatrix, dimensions, chosenMetric);
            
            const outputDir = 'sharpe_heatmap_output';
            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
            const strategyName = this.fileInfo.parsedInfo.strategyName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
            
            const htmlPath = path.join(outputDir, `${strategyName}_${chosenMetric}_heatmap_${timestamp}.html`);
            fs.writeFileSync(htmlPath, htmlContent, 'utf8');
            
            const csvPath = path.join(outputDir, `${strategyName}_full_stats_${timestamp}.csv`);
            const csvHeader = [
                { id: 'period', title: 'Period' }, { id: 'startDate', title: 'Start Date' }, { id: 'endDate', title: 'End Date' },
                ...Object.entries(this.metricProperties).map(([key, prop]) => ({ id: key, title: prop.displayName })),
                { id: 'numTrades', title: 'Num Trades' }
            ];
            const csvWriter = createCsvWriter({ path: csvPath, header: csvHeader });
            await csvWriter.writeRecords(heatmapData);

            console.log('\n✅ 分析報告生成完成！');
            console.log(`📁 輸出目錄: ${outputDir}`);
            console.log(`🎯 主顯示指標: ${this.metricProperties[chosenMetric].displayName}`);
            console.log('\n📋 輸出檔案:');
            console.log(`   • HTML 熱力圖: ${path.basename(htmlPath)}`);
            console.log(`   • CSV 詳細數據: ${path.basename(csvPath)}`);
            
        } catch (error) {
            console.error('❌ 生成過程發生錯誤:', error.message);
            throw error;
        }
    }

    async interactiveSetup() {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const question = (query) => new Promise(resolve => rl.question(query, resolve));

        try {
            console.log('🎯 多維度策略表現熱力圖生成器');
            console.log('====================================\n');

            const periodType = await question('📅 請選擇週期類型 (day/week/month) [預設: day]: ') || 'day';
            const periodLengthInput = await question('📊 請輸入週期長度 (數字) [預設: 1]: ') || '1';
            const periodLength = parseInt(periodLengthInput) || 1;

            console.log('\n📈 請選擇熱力圖主顯示指標:');
            const metricKeys = Object.keys(this.metricProperties);
            metricKeys.forEach((key, index) => {
                console.log(`   ${index + 1}. ${this.metricProperties[key].displayName} (${key})`);
            });
            const metricChoiceInput = await question(`請輸入選項編號或名稱 [預設: 1 / sharpeRatio]: `) || '1';
            
            let chosenMetric;
            const choiceIndex = parseInt(metricChoiceInput) - 1;
            if (metricKeys[choiceIndex]) {
                chosenMetric = metricKeys[choiceIndex];
            } else if (this.metricProperties[metricChoiceInput]) {
                chosenMetric = metricChoiceInput;
            } else {
                chosenMetric = 'sharpeRatio';
                console.log('無效輸入，將使用預設指標: Sharpe Ratio');
            }

            console.log(`\n⚙️  設定確認:`);
            console.log(`   週期: ${periodLength} ${periodType}`);
            console.log(`   主指標: ${this.metricProperties[chosenMetric].displayName}`);
            
            const confirm = await question('\n🚀 開始生成? (y/N): ');
            if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
                await this.generateAllOutputs(periodType, periodLength, chosenMetric);
            } else {
                console.log('❌ 已取消生成');
            }

        } finally {
            rl.close();
        }
    }
}

async function main() {
    const generator = new SharpeHeatmapGenerator();
    try {
        await generator.interactiveSetup();
    } catch (error) {
        console.error('\n❌ 程式執行失敗:', error.message);
    }
}

if (require.main === module) {
    main();
}

module.exports = SharpeHeatmapGenerator;
