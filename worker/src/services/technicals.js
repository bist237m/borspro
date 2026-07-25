// src/services/technicals.js
// Tüm indikatörleri hesaplar.
// Scanner'daki indicators.js + signalEngine.js mantığının worker versiyonu.

// ── TEMEL HESAPLAMALAR ────────────────────────────────────

function sma(arr, len) {
  if (arr.length < len) return null;
  return arr.slice(-len).reduce((a, b) => a + b, 0) / len;
}

function ema(arr, len) {
  if (arr.length < len) return null;
  const k = 2 / (len + 1);
  let val = arr.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < arr.length; i++) val = arr[i] * k + val * (1 - k);
  return val;
}

function emaArray(arr, len) {
  const res = new Array(arr.length).fill(null);
  if (arr.length < len) return res;
  const k = 2 / (len + 1);
  let val = arr.slice(0, len).reduce((a, b) => a + b, 0) / len;
  res[len - 1] = val;
  for (let i = len; i < arr.length; i++) { val = arr[i] * k + val * (1 - k); res[i] = val; }
  return res;
}

function wma(arr, len) {
  if (arr.length < len) return null;
  const slice = arr.slice(-len);
  let num = 0, den = 0;
  slice.forEach((v, i) => { num += (v ?? 0) * (i + 1); den += (i + 1); });
  return num / den;
}

export function calcRSI(closes, len = 14) {
  if (closes.length < len + 1) return null;
  const ch = closes.map((c, i) => i === 0 ? 0 : c - closes[i - 1]);
  let g = 0, l = 0;
  for (let i = 1; i <= len; i++) {
    if (ch[i] > 0) g += ch[i]; else l += Math.abs(ch[i]);
  }
  g /= len; l /= len;
  for (let i = len + 1; i < ch.length; i++) {
    g = (g * (len - 1) + (ch[i] > 0 ? ch[i] : 0)) / len;
    l = (l * (len - 1) + (ch[i] < 0 ? Math.abs(ch[i]) : 0)) / len;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

export function calcMACD(closes) {
  if (closes.length < 35) return null;
  const fast = emaArray(closes, 12);
  const slow = emaArray(closes, 26);
  const line = closes.map((_, i) =>
    fast[i] !== null && slow[i] !== null ? fast[i] - slow[i] : null
  );
  const vals   = line.filter(v => v !== null);
  const sigArr = emaArray(vals, 9);
  const lastM  = vals[vals.length - 1];
  const prevM  = vals[vals.length - 2];
  const lastS  = sigArr[sigArr.length - 1];
  const prevS  = sigArr[sigArr.length - 2];
  return {
    macd: lastM, signal: lastS,
    histogram: lastM - lastS,
    bullishCross: prevM <= prevS && lastM > lastS,
    bearishCross: prevM >= prevS && lastM < lastS,
  };
}

export function calcMACross(closes) {
  if (closes.length < 202) return null;
  const f  = sma(closes, 50);
  const s  = sma(closes, 200);
  const fp = sma(closes.slice(0, -1), 50);
  const sp = sma(closes.slice(0, -1), 200);
  if (!f || !s || !fp || !sp) return null;
  return {
    type: fp <= sp && f > s ? "golden_cross"
        : fp >= sp && f < s ? "death_cross"
        : "none",
    ma50: f, ma200: s,
  };
}

export function calcIFT(closes, highs, lows, volumes) {
  const ift = x => (Math.exp(2 * x) - 1) / (Math.exp(2 * x) + 1);
  const wmaLen = 9;
  if (closes.length < 30) return null;

  // CCI serisi
  const cciSeries = closes.map((_, i) => {
    if (i < 4) return 0;
    const tp = Array.from({ length: 5 }, (_, j) => (closes[i-j] + highs[i-j] + lows[i-j]) / 3);
    const m  = tp.reduce((a, b) => a + b, 0) / 5;
    const d  = tp.reduce((a, b) => a + Math.abs(b - m), 0) / 5;
    return d === 0 ? 0 : 0.1 * (((highs[i] + lows[i] + closes[i]) / 3 - m) / (0.015 * d)) / 4;
  });

  // RSI serisi
  const rsiArr    = closes.map((_, i) => calcRSI(closes.slice(0, i + 1), 5));
  const rsiSeries = rsiArr.map(v => v !== null ? 0.1 * (v - 50) : 0);

  // Stoch serisi
  const stochSeries = closes.map((_, i) => {
    if (i < 4) return 0;
    const hh = Math.max(...highs.slice(i - 4, i + 1));
    const ll = Math.min(...lows.slice(i - 4, i + 1));
    return hh === ll ? 0 : 0.1 * (((closes[i] - ll) / (hh - ll)) * 100 - 50);
  });

  // MFI serisi
  const hlc3      = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const mfiSeries = closes.map((_, i) => {
    if (i < 5) return 0;
    let pos = 0, neg = 0;
    for (let j = i - 4; j <= i; j++) {
      const ch = j > 0 ? hlc3[j] - hlc3[j - 1] : 0;
      if (ch > 0) pos += (volumes[j] || 1) * hlc3[j];
      else if (ch < 0) neg += (volumes[j] || 1) * hlc3[j];
    }
    return neg === 0 ? 0.1 * 50 : 0.1 * (100 - 100 / (1 + pos / neg) - 50);
  });

  const iftCCI   = wma(cciSeries,   wmaLen); const INV1 = iftCCI   !== null ? ift(iftCCI)   : null;
  const iftRSI   = wma(rsiSeries,   wmaLen); const INV2 = iftRSI   !== null ? ift(iftRSI)   : null;
  const iftSTOCH = wma(stochSeries, wmaLen); const INV3 = iftSTOCH !== null ? ift(iftSTOCH) : null;
  const iftMFI   = wma(mfiSeries,   wmaLen); const INV4 = iftMFI   !== null ? ift(iftMFI)   : null;

  const vals = [INV1, INV2, INV3, INV4].filter(v => v !== null);
  const avg  = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

  return {
    cci: INV1, rsi: INV2, stoch: INV3, mfi: INV4, avg,
    signal: avg === null ? "neutral" : avg > 0.5 ? "overbought" : avg < -0.5 ? "oversold" : "neutral",
  };
}

// ── SİNYAL TESPİT ────────────────────────────────────────
export function detectAllSignals(bars) {
  const closes  = bars.map(b => Number(b.close));
  const highs   = bars.map(b => Number(b.high));
  const lows    = bars.map(b => Number(b.low));
  const volumes = bars.map(b => Number(b.volume || 1));

  const signals = [];

  // RSI
  const rsiVal = calcRSI(closes);
  if (rsiVal !== null) {
    if (rsiVal < 30) signals.push({ type: "RSI_OVERSOLD",   value: rsiVal, dir: "bullish", strength: rsiVal < 20 ? "strong" : "moderate" });
    if (rsiVal > 70) signals.push({ type: "RSI_OVERBOUGHT", value: rsiVal, dir: "bearish", strength: rsiVal > 80 ? "strong" : "moderate" });
  }

  // MACD
  const macdR = calcMACD(closes);
  if (macdR?.bullishCross) signals.push({ type: "MACD_BULLISH_CROSS", value: macdR.macd, dir: "bullish", strength: "moderate" });
  if (macdR?.bearishCross) signals.push({ type: "MACD_BEARISH_CROSS", value: macdR.macd, dir: "bearish", strength: "moderate" });

  // MA Cross
  const cross = calcMACross(closes);
  if (cross?.type === "golden_cross") signals.push({ type: "GOLDEN_CROSS", value: cross.ma50, dir: "bullish", strength: "strong" });
  if (cross?.type === "death_cross")  signals.push({ type: "DEATH_CROSS",  value: cross.ma50, dir: "bearish", strength: "strong" });

  // IFT
  const ift = calcIFT(closes, highs, lows, volumes);
  if (ift?.signal === "oversold")   signals.push({ type: "IFT_OVERSOLD",   value: ift.avg, dir: "bullish", strength: Math.abs(ift.avg) > 0.7 ? "strong" : "moderate" });
  if (ift?.signal === "overbought") signals.push({ type: "IFT_OVERBOUGHT", value: ift.avg, dir: "bearish", strength: Math.abs(ift.avg) > 0.7 ? "strong" : "moderate" });

  return { signals, rsi: rsiVal, macd: macdR, cross, ift };
}

// ── YORUM ─────────────────────────────────────────────────
const COMMENTS = {
  RSI_OVERSOLD:       (v) => `RSI ${v.toFixed(1)} ile aşırı satım bölgesinde. Teknik geri dönüş potansiyeli var.`,
  RSI_OVERBOUGHT:     (v) => `RSI ${v.toFixed(1)} ile aşırı alım bölgesinde. Kar realizasyonu baskısı oluşabilir.`,
  MACD_BULLISH_CROSS: ()  => `MACD sinyal hattını yukarı kesti. Momentum pozitife döndü.`,
  MACD_BEARISH_CROSS: ()  => `MACD sinyal hattını aşağı kesti. Düşüş momentumu başladı.`,
  GOLDEN_CROSS:       (v) => `Golden Cross oluştu (MA50: ${v.toFixed(2)}). Uzun vadeli yükseliş sinyali.`,
  DEATH_CROSS:        (v) => `Death Cross oluştu (MA50: ${v.toFixed(2)}). Uzun vadeli düşüş uyarısı.`,
  IFT_OVERSOLD:       (v) => `IFT COMBO ${v.toFixed(3)} — 4 indikatör aşırı satımı teyit ediyor.`,
  IFT_OVERBOUGHT:     (v) => `IFT COMBO ${v.toFixed(3)} — 4 indikatör aşırı alımı teyit ediyor.`,
};

export function buildComment(signals) {
  return signals.map(s => (COMMENTS[s.type] || (() => s.type))(s.value)).join(" | ");
}

export function calcScore(signals) {
  const w = { strong: 30, moderate: 15 };
  return Math.min(signals.reduce((s, sig) => s + (w[sig.strength] || 10), 0), 100);
}
