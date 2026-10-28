/* Calendar V3.1 – Month-cell festival wallpaper only (never events / Sheet / GCal).
 * Dates are COMPUTED for any year: Easter (Anonymous Gregorian), lunar festivals
 * (1900–2100 bitmask table), 冬至 (Meeus Dec solstice → Asia/Hong_Kong civil day).
 * Exactly 10: 元旦, 農曆年初一, 情人節, 復活節, 端午節, 中秋節, 平安夜, 聖誕節, 冬至, 除夕夜.
 */
(function (root) {
  'use strict';

  /** One-line flip: set false to drop Dec 31 除夕夜 from the wallpaper. */
  const INCLUDE_DEC31_NYE = true;

  // Standard Chinese lunar year bitmasks, index 0 = 1900 … 200 = 2100.
  const LUNAR_INFO = [0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,0x0a2e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252,0x0d520];

  const pad = n => String(n).padStart(2, '0');
  const ymd = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const fromYmd = s => { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  const addDays = (s, n) => { const dt = fromYmd(s); dt.setUTCDate(dt.getUTCDate() + n); return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); };

  const leapMonth = y => LUNAR_INFO[y - 1900] & 0xf;
  const leapDays = y => { const m = leapMonth(y); return m ? ((LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29) : 0; };
  const monthDays = (y, m) => (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29;
  const yearDays = y => { let sum = 348; for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0; return sum + leapDays(y); };

  /** Lunar (ly, lm, ld) → Gregorian ymd. leap=true = that year's leap month. Base: 1900-01-31 = lunar 1900-1-1. */
  function lunarToSolar(ly, lm, ld, leap) {
    if (ly < 1900 || ly > 2100) return null;
    let offset = 0;
    for (let y = 1900; y < ly; y++) offset += yearDays(y);
    for (let m = 1; m < lm; m++) { offset += monthDays(ly, m); if (leapMonth(ly) === m) offset += leapDays(ly); }
    if (leap) { if (leapMonth(ly) !== lm) return null; offset += monthDays(ly, lm); }
    offset += ld - 1;
    return addDays('1900-01-31', offset);
  }

  /** Anonymous Gregorian computus → Easter Sunday ymd. */
  function easterSunday(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(y, month, day);
  }

  /** Winter solstice (solar longitude 270°) as Asia/Hong_Kong civil date (Meeus ch.27). */
  function winterSolstice(y) {
    const Y = (y - 2000) / 1000;
    const JDE0 = 2451900.05952 + 365242.74049 * Y - 0.06223 * Y * Y - 0.00823 * Y * Y * Y + 0.00032 * Y * Y * Y * Y;
    const T = (JDE0 - 2451545.0) / 36525.0;
    const W = 35999.373 * T - 2.47;
    const dL = 1 + 0.0334 * Math.cos(W * Math.PI / 180) + 0.0007 * Math.cos(2 * W * Math.PI / 180);
    const terms = [[485,324.96,1934.136],[203,337.23,32964.467],[199,342.08,20.186],[182,27.85,445267.112],[156,73.14,45036.886],[136,171.33,22518.443],[77,222.92,65928.934],[74,296.72,3034.906],[70,243.58,9037.513],[58,119.81,33718.147],[52,297.17,150.678],[50,21.02,2281.226],[45,247.54,29929.562],[44,325.15,31555.956],[29,60.93,4443.417],[18,155.12,67555.328],[17,288.79,4562.452],[16,198.04,62894.029],[14,199.76,31436.921],[12,95.39,14577.848],[12,287.11,31931.756],[12,320.81,34777.259],[9,227.73,1222.114],[8,15.45,16859.074]];
    let S = 0; for (let i = 0; i < terms.length; i++) S += terms[i][0] * Math.cos((terms[i][1] + terms[i][2] * T) * Math.PI / 180);
    const JDE = JDE0 + 0.00001 * S / dL;
    const ms = (JDE - 2440587.5) * 86400000 + 8 * 3600000; // TT≈UTC + 8h → HK civil
    const dt = new Date(ms);
    return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  /** Wallpaper styles: soft pink-blue theme, faint emoji motif, readable text. */
  const STYLES = {
    newyear:   { name: '元旦',     emoji: '🎉', bg: '#e8f0ff', ink: '#3d4f9a', motif: 'rgba(90,109,190,.14)' },
    cny:       { name: '農曆年初一', emoji: '🧧', bg: '#ffe8e8', ink: '#a03030', motif: 'rgba(196,60,60,.16)' },
    valentine: { name: '情人節',   emoji: '💕', bg: '#ffe6f0', ink: '#b04070', motif: 'rgba(214,80,130,.14)' },
    easter:    { name: '復活節',   emoji: '🐣', bg: '#eefae8', ink: '#3d7a30', motif: 'rgba(90,150,70,.14)' },
    duanwu:    { name: '端午節',   emoji: '🐉', bg: '#e6f7f2', ink: '#2a7a68', motif: 'rgba(40,140,120,.14)' },
    midautumn: { name: '中秋節',   emoji: '🌕', bg: '#fff4e0', ink: '#9a6a10', motif: 'rgba(200,140,40,.16)' },
    xmasEve:   { name: '平安夜',   emoji: '🎄', bg: '#e8f6ee', ink: '#2a6a40', motif: 'rgba(50,130,80,.14)' },
    xmas:      { name: '聖誕節',   emoji: '🎅', bg: '#ffe9e9', ink: '#a03030', motif: 'rgba(180,50,50,.14)' },
    dongzhi:   { name: '冬至',     emoji: '🥟', bg: '#eef2fa', ink: '#3d4f9a', motif: 'rgba(90,109,190,.14)' },
    nye:       { name: '除夕夜',   emoji: '🎆', bg: '#f3e8ff', ink: '#6a3a9a', motif: 'rgba(120,70,180,.14)' }
  };

  /** All festival wallpapers that fall in Gregorian year `y` (and spill from adjacent lunar years). */
  function festivalsForYear(y) {
    const out = {};
    const put = (date, key) => { if (date && date.slice(0, 4) === String(y)) out[date] = STYLES[key]; };
    put(ymd(y, 1, 1), 'newyear');
    put(ymd(y, 2, 14), 'valentine');
    put(easterSunday(y), 'easter');
    put(ymd(y, 12, 24), 'xmasEve');
    put(ymd(y, 12, 25), 'xmas');
    if (INCLUDE_DEC31_NYE) put(ymd(y, 12, 31), 'nye');
    put(winterSolstice(y), 'dongzhi');
    // Lunar festivals may fall in year y-1's lunar calendar → still check ly = y-1 and y
    for (let ly = y - 1; ly <= y; ly++) {
      if (ly < 1900 || ly > 2100) continue;
      put(lunarToSolar(ly, 1, 1, false), 'cny');
      put(lunarToSolar(ly, 5, 5, false), 'duanwu');
      put(lunarToSolar(ly, 8, 15, false), 'midautumn');
    }
    return out;
  }

  const cache = {};
  function festivalOn(date) {
    if (!date || date.length < 10) return null;
    const y = +date.slice(0, 4);
    if (!cache[y]) cache[y] = festivalsForYear(y);
    return cache[y][date] || null;
  }

  const api = { INCLUDE_DEC31_NYE, lunarToSolar, easterSunday, winterSolstice, festivalsForYear, festivalOn, STYLES, VERSION: 'V3.1' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CalFestivals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
