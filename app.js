/* ================== CONFIG ================== */
const SHEET_ID = '1gYOJBl6KFgodDhgRwW3z2hGcR8ytGLmbkA1FKPOhF1U';
const SHEET_NAME = 'data';
// Column mapping note:
// A: Timestamp, B: deviceId, C: devEui, D: EC, E: pH, F: N, G: P, H: K, I: MOI, J: WIFI_RSSI (not used yet), K: RSSI, L: SNR, M: VBAT_mV, N: VBAT_percent
// We now use column N (index 13 after zero-based) for battery percentage.
const COLS = { ts: 0, device: 1, devEui: 2, ec: 3, ph: 4, n: 5, p: 6, k: 7, moi: 8, rssi: 10, snr: 11, batMv: 12, batPercent: 13 };

/* ================== Helpers ================== */
function sqlQuote(s) { return `'${String(s).replace(/'/g, "''")}'`; }
function gvizURL({ limit = 100, startDate = null, endDate = null, device = null } = {}) {
  const where = [];
  if (startDate) where.push(`A >= datetime ${sqlQuote(startDate + ' 00:00:00')}`);
  if (endDate) where.push(`A <= datetime ${sqlQuote(endDate + ' 23:59:59')}`);
  if (device) where.push(`B = ${sqlQuote(device)}`);
  const whereClause = where.length ? ` where ${where.join(' and ')}` : '';
  const limitClause = (limit && Number.isFinite(limit)) ? ` limit ${limit}` : '';
  // Select includes all columns up to N (VBAT_percent). Column J (WIFI_RSSI) is included but not used yet.
  const query = `select A,B,C,D,E,F,G,H,I,J,K,L,M,N${whereClause} order by A desc${limitClause}`;
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(SHEET_NAME)}&tqx=out:json&tq=${encodeURIComponent(query)}`;
}
function parseGviz(text) {
  const start = text.indexOf('(') + 1;
  const end = text.lastIndexOf(')');
  const json = JSON.parse(text.slice(start, end));
  const rows = (json.table.rows || []).map(r => (r.c.map(cell => cell ? cell.v : null)));
  return { rows };
}
function parseDateToken(v) {
  if (typeof v === 'string' && v.startsWith('Date(')) {
    const m = /Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(v);
    if (m) { const [_, y, mo, d, h, mi, s] = m.map(Number); return new Date(y, mo, d, h, mi, s); }
  }
  if (v instanceof Date) return v;
  return v ? new Date(v) : null;
}
function fmtTime(d) { return d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : '–'; }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function uniq(arr) { return [...new Set(arr)]; }

/* ================== Feedback / Toast ================== */
function showToast(msg, { timeout = 2600 } = {}) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  stack.appendChild(div);
  setTimeout(() => { div.classList.add('out'); setTimeout(() => div.remove(), 400); }, timeout);
  const live = document.getElementById('filterAnnouncer');
  if (live) { live.textContent = msg; }
}
function formatDateRange() {
  const s = startDateFilter.value || 'ไม่ระบุ';
  const e = endDateFilter.value || 'ไม่ระบุ';
  return `${s} – ${e}`;
}

/* ================== Router ================== */
const PAGES = ['dashboard', 'analytics', 'data'];
const PAGE_TITLES = { dashboard: 'Dashboard', analytics: 'Analytics', data: 'Data Table' };

function navigate(page) {
  if (!PAGES.includes(page)) page = 'dashboard';

  // Update page visibility
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    // Re-trigger animation
    p.style.animation = 'none';
  });
  const target = document.getElementById(`page-${page}`);
  if (target) {
    target.style.animation = '';
    target.classList.add('active');
  }

  // Update sidebar nav
  document.querySelectorAll('.sidebar .nav-item[data-page]').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Update bottom bar
  document.querySelectorAll('.bottom-bar .tab-item[data-page]').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Update topbar title
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[page] || 'Dashboard';

  // Update document title
  document.title = `Coffee Smart Farm — ${PAGE_TITLES[page] || 'Dashboard'}`;

  // Close mobile sidebar if open
  closeMobileSidebar();

  // Scroll to top of content
  const content = document.querySelector('.content-area');
  if (content) content.scrollTop = 0;

  // If navigating to analytics, ensure chart resizes properly
  if (page === 'analytics' && CHART) {
    setTimeout(() => CHART.resize(), 50);
  }
}

function getPageFromHash() {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  return PAGES.includes(hash) ? hash : 'dashboard';
}

function initRouter() {
  // Listen for hash changes
  window.addEventListener('hashchange', () => {
    navigate(getPageFromHash());
  });

  // Initial navigation
  const initial = getPageFromHash();
  if (!window.location.hash) {
    window.location.hash = '#/dashboard';
  }
  navigate(initial);
}

/* ================== Mobile Sidebar ================== */
function openMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.add('mobile-open');
  if (overlay) overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('visible');
  document.body.style.overflow = '';
}

/* ================== State / Refs ================== */
let CHART, cache = [], timer;
const ddDevice = document.getElementById('deviceFilter');
const ddPoints = document.getElementById('pointFilter');
// Removed refresh select; fixed interval
const REFRESH_SEC = 10;
const startDateFilter = document.getElementById('startDateFilter');
const endDateFilter = document.getElementById('endDateFilter');
const elUpdated = document.getElementById('updated');
const elEC = document.getElementById('ec'); const elPH = document.getElementById('ph');
const elN = document.getElementById('n'); const elP = document.getElementById('p'); const elK = document.getElementById('k');
const elMOI = document.getElementById('moi');
// Header battery icon elements
const elBAT = document.getElementById('bat');
const elBatFill = document.getElementById('batteryFill');
// KPI numeric-only battery value
const elBatteryValue = document.getElementById('batteryValue');
const elRSSI = document.getElementById('rssi'); const elSNR = document.getElementById('snr'); const elDev = document.getElementById('dev');
const summaryGrid = document.getElementById('summaryGrid');
const tbody = document.getElementById('tableBody');
// Advisor device controls
const elAdvisorDeviceName = document.getElementById('advisorDeviceName');
const ddAdvisorDevice = document.getElementById('advisorDevice');

/* ================== Theme ================== */
function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
function setTheme(theme) { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('smfarm-theme', theme); applyChartTheme(theme); updateThemeIcon(theme); }
function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const sunIcon = btn.querySelector('.icon-sun');
  const moonIcon = btn.querySelector('.icon-moon');
  if (theme === 'dark') {
    if (sunIcon) sunIcon.style.display = 'none';
    if (moonIcon) moonIcon.style.display = 'inline';
  } else {
    if (sunIcon) sunIcon.style.display = 'inline';
    if (moonIcon) moonIcon.style.display = 'none';
  }
  const label = theme === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด';
  btn.setAttribute('aria-label', label);
}
function applyChartTheme(theme) { if (!CHART) return; const legendColor = theme === 'dark' ? '#e5e5e5' : '#111111'; const tickColor = theme === 'dark' ? '#c9c9c9' : '#444'; const gridColor = theme === 'dark' ? '#262626' : '#ececec'; CHART.options.plugins.legend.labels.color = legendColor; CHART.options.scales.x.ticks.color = tickColor; CHART.options.scales.y.ticks.color = tickColor; CHART.options.scales.x.grid.color = gridColor; CHART.options.scales.y.grid.color = gridColor; CHART.update('none'); }

/* ================== Fetch & Build ================== */
async function fetchSheet({ limit, startDate, endDate, device } = {}) {
  const res = await fetch(gvizURL({ limit, startDate, endDate, device }), { cache: 'no-store' }); const text = await res.text(); const { rows } = parseGviz(text); cache = rows.map(r => ({
    ts: parseDateToken(r[0]), device: r[1] ?? '', devEui: r[2] ?? '', 
    // รับค่าจริงตาม Google Sheet โดยไม่แปลงหน่วย
    ec: toNum(r[3]), 
    ph: toNum(r[4]),
    n: toNum(r[5]),
    p: toNum(r[6]),
    k: toNum(r[7]),
    moi: toNum(r[8]), 
    // r[9] is WIFI_RSSI
    wifiRssi: toNum(r[9]),
    rssi: toNum(r[10]), 
    snr: toNum(r[11]),
    // Battery percent from column N (r[13]); column M (r[12]) is mV. If missing, value will be null.
    bat: toNum(r[13]),
  })).filter(r => {
    // กรองให้แสดงเฉพาะเวลา 00:01, 06:01, 12:01, 18:01 และ 00:03, 06:03, 12:03, 18:03
    if (!r.ts) return false;
    const d = new Date(r.ts);
    const hours = d.getHours();
    const minutes = d.getMinutes();
    // ตรวจสอบว่าเป็นเวลาที่ต้องการหรือไม่
    return (minutes === 1 || minutes === 3) && (hours === 0 || hours === 6 || hours === 12 || hours === 18);
  }).filter((r, index, arr) => {
    // กรองให้แสดงเฉพาะค่าแรกของแต่ละ device ในแต่ละช่วงเวลา (date + hour + minute)
    if (!r.ts || !r.device) return true;
    const key = `${r.device}-${dayjs(r.ts).format('YYYY-MM-DD-HH-mm')}`;
    // หาว่าเป็น record แรกที่มี key นี้หรือไม่
    const firstIndex = arr.findIndex(item => {
      if (!item.ts || !item.device) return false;
      return `${item.device}-${dayjs(item.ts).format('YYYY-MM-DD-HH-mm')}` === key;
    });
    return index === firstIndex;
  }); elUpdated.textContent = 'updated ' + (cache[0] ? fmtTime(cache[0].ts) : '-');
  const devices = uniq(cache.map(d => d.device).filter(Boolean));
  // Sort devices by name first, then by number
  devices.sort((a, b) => {
    // Extract name and number parts
    const aMatch = a.match(/^(.+?)-?(\d+)$/) || [null, a, '0'];
    const bMatch = b.match(/^(.+?)-?(\d+)$/) || [null, b, '0'];
    const aName = aMatch[1].toLowerCase();
    const bName = bMatch[1].toLowerCase();
    const aNum = parseInt(aMatch[2]) || 0;
    const bNum = parseInt(bMatch[2]) || 0;

    // First sort by name
    if (aName !== bName) {
      return aName.localeCompare(bName);
    }
    // Then by number
    return aNum - bNum;
  });

  // Determine latest device from most recent row
  const latestDev = cache.find(r => r && r.device)?.device || '';
  // Keep main filter independent: default remains "ทั้งหมด" unless user has selected
  const mainSelected = ddDevice.value || '';
  ddDevice.innerHTML = `<option value="">ทั้งหมด (${devices.length})</option>` + devices.map(x => `<option ${x === mainSelected ? 'selected' : ''} value="${x}">${x}</option>`).join('');
  ddDevice.value = mainSelected; // preserve user's choice or All
  // Also populate export device selector
  const exportDeviceSelect = document.getElementById('exportDevice');
  if (exportDeviceSelect) {
    const currentExportDevice = exportDeviceSelect.value;
    exportDeviceSelect.innerHTML = `<option value="">ทั้งหมด (${devices.length})</option>` + devices.map(x => `<option ${x === currentExportDevice ? 'selected' : ''} value="${x}">${x}</option>`).join('');
  }
  // Populate advisor device selector (independent, default to latest device if empty)
  if (ddAdvisorDevice) {
    const advSelected = ddAdvisorDevice.value || latestDev;
    ddAdvisorDevice.innerHTML = `<option value="">ทั้งหมด (${devices.length})</option>` + devices.map(x => `<option ${x === advSelected ? 'selected' : ''} value="${x}">${x}</option>`).join('');
    ddAdvisorDevice.value = advSelected;
  }
}
function filterRows(deviceOverride = null) { const device = deviceOverride != null ? deviceOverride : ddDevice.value; const startDate = startDateFilter.value; const endDate = endDateFilter.value; let filtered = cache.slice(); if (device) filtered = filtered.filter(r => r.device === device); if (startDate || endDate) { filtered = filtered.filter(r => { if (!r.ts) return false; const rowDate = dayjs(r.ts).format('YYYY-MM-DD'); if (startDate && rowDate < startDate) return false; if (endDate && rowDate > endDate) return false; return true; }); } return filtered; }
function updateKPIs(latest) {
  const NIL = '–';
  if (!latest) {
    [elEC, elPH, elN, elP, elK, elMOI].forEach(el => el.textContent = NIL);
    if (elBAT) elBAT.textContent = NIL;
    if (elBatteryValue) elBatteryValue.textContent = NIL;
    elRSSI.textContent = elSNR.textContent = elDev.textContent = NIL;
    if (elBatFill) { elBatFill.style.width = '0%'; elBatFill.className = 'battery-fill missing'; }
    return;
  }
  // แสดงค่าตามที่ได้รับจาก Google Sheet โดยตรง
  elEC.textContent = latest.ec != null ? latest.ec.toFixed(1) : NIL;
  elPH.textContent = latest.ph != null ? latest.ph.toFixed(1) : NIL;
  elN.textContent = latest.n != null ? latest.n.toFixed(1) : NIL;
  elP.textContent = latest.p != null ? latest.p.toFixed(1) : NIL;
  elK.textContent = latest.k != null ? latest.k.toFixed(1) : NIL;
  elMOI.textContent = latest.moi ?? NIL;
  if (latest.bat != null) {
    const pct = Math.max(0, Math.min(100, latest.bat));
    const txt = `${Math.round(pct)}%`;
    if (elBAT) elBAT.textContent = txt;            // header icon text
    if (elBatteryValue) elBatteryValue.textContent = txt; // KPI numeric
    if (elBatFill) {
      elBatFill.className = 'battery-fill';
      elBatFill.style.width = pct + '%';
      if (pct < 15) {
        elBatFill.classList.add('low', 'blink');
      } else if (pct < 50) {
        elBatFill.classList.add('mid');
      } else {
        // high -> default green
      }
    }
  } else {
    if (elBAT) elBAT.textContent = NIL;
    if (elBatteryValue) elBatteryValue.textContent = NIL;
    if (elBatFill) {
      elBatFill.className = 'battery-fill missing';
      elBatFill.style.width = '8%';
    }
  }
  elRSSI.textContent = (latest.rssi ?? NIL);
  elSNR.textContent = (latest.snr ?? NIL);
  elDev.textContent = latest.device || NIL;
}
function updateSummary(rows) {
  // Base metrics order
  let metrics = ['ec', 'ph', 'n', 'p', 'k', 'moi', 'bat'];
  // If mobile viewport (<=640px) omit battery summary card per requirement
  try {
    if (window.matchMedia && window.matchMedia('(max-width:640px)').matches) {
      metrics = metrics.filter(m => m !== 'bat');
    }
  } catch { }
  summaryGrid.innerHTML = '';
  if (!rows.length) {
    summaryGrid.innerHTML = '<div class="card" style="color:var(--muted)">ไม่มีข้อมูลในช่วงที่เลือก</div>';
    return;
  }
  metrics.forEach(metric => {
    const values = rows.map(r => r[metric]).filter(v => v !== null && !isNaN(v));
    if (!values.length) return;
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const isBat = metric === 'bat';
    const fmtVal = v => isBat ? `${v.toFixed(2)}%` : v.toFixed(2);
    summaryGrid.insertAdjacentHTML('beforeend', `<div class="card"><div class="t">${metric.toUpperCase()}</div><div style=\"font-size:14px; margin-top:4px;\">Avg: <span class=\"v\">${fmtVal(avg)}</span></div><div class=\"t\">Min: ${fmtVal(min)}</div><div class=\"t\">Max: ${fmtVal(max)}</div></div>`);
  });
}
function updateTable(rows) {
  tbody.innerHTML = rows.slice(0, 60).map(r => `\
    <tr>
      <td>${fmtTime(r.ts)}</td>
      <td>${r.device || ''}</td>
      <td>${r.ec != null ? r.ec.toFixed(1) : ''}</td>
      <td>${r.ph != null ? r.ph.toFixed(1) : ''}</td>
      <td>${r.n != null ? r.n.toFixed(1) : ''}</td>
      <td>${r.p != null ? r.p.toFixed(1) : ''}</td>
      <td>${r.k != null ? r.k.toFixed(1) : ''}</td>
      <td>${r.moi != null ? r.moi.toFixed(1) : ''}</td>
      <td>${r.bat != null ? Math.round(r.bat) + '%' : ''}</td>
    </tr>`).join('');
}
// ตรวจสอบว่าข้อมูลเป็นของวันนี้หรือไม่
function isShowingTodayData() {
  const today = dayjs().format('YYYY-MM-DD');
  const startDate = startDateFilter.value;
  const endDate = endDateFilter.value;
  
  // ถ้าทั้งสองวันตรงกับวันนี้ หรือเลือก "วันนี้"
  return (startDate === today && endDate === today) || 
         (startDate === today && !endDate) ||
         (!startDate && endDate === today);
}

function makeChart(ctx) { const colors = { ec: '#1f77b4', ph: '#e45756', n: '#f2af58', p: '#72b7b2', k: '#4c78a8', moi: '#54a24b', bat: '#b279a2' }; return new Chart(ctx, { type: 'line', data: { labels: [], datasets: [{ label: 'EC', borderColor: colors.ec, backgroundColor: colors.ec, data: [], tension: .25 }, { label: 'pH', borderColor: colors.ph, backgroundColor: colors.ph, data: [], tension: .25 }, { label: 'N', borderColor: colors.n, backgroundColor: colors.n, data: [], tension: .25 }, { label: 'P', borderColor: colors.p, backgroundColor: colors.p, data: [], tension: .25 }, { label: 'K', borderColor: colors.k, backgroundColor: colors.k, data: [], tension: .25 }, { label: 'MOI', borderColor: colors.moi, backgroundColor: colors.moi, data: [], tension: .25 }, { label: 'BAT', borderColor: colors.bat, backgroundColor: colors.bat, data: [], tension: .25 },] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false }, plugins: { legend: { labels: { color: '#111', usePointStyle: true, pointStyle: 'circle', pointRadius: 4, boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { title: function (context) { const dataIndex = context[0].dataIndex; const timeLabel = CHART.data.meta && CHART.data.meta[dataIndex] ? CHART.data.meta[dataIndex] : context[0].label; const deviceLabel = CHART.data.devices && CHART.data.devices[dataIndex] ? `Device: ${CHART.data.devices[dataIndex]}` : ''; return deviceLabel ? `${timeLabel}\n${deviceLabel}` : timeLabel; } } } }, scales: { x: { ticks: { color: '#444' }, grid: { color: '#ececec' } }, y: { ticks: { color: '#444' }, grid: { color: '#ececec' } } } } }); }
function updateChart(rows) { 
  // ตรวจสอบว่าเป็นข้อมูลวันนี้หรือไม่เพื่อเลือกรูปแบบการแสดงผล
  const isTodayData = isShowingTodayData();
  
  // ถ้าเป็นข้อมูลวันนี้ แสดงเวลา (HH:mm) แทนวันที่
  // ถ้าไม่ใช่ แสดงวันที่ (DD/MM/YY) ตามปกติ
  const labels = rows.map(r => {
    if (isTodayData) {
      return dayjs(r.ts).format('HH:mm'); // แสดงเฉพาะเวลา
    } else {
      return dayjs(r.ts).format('DD/MM/YY'); // แสดงวันที่ตามปกติ
    }
  }).reverse();
  
  const timeLabels = rows.map(r => dayjs(r.ts).format('DD/MM/YYYY HH:mm:ss')).reverse(); 
  const deviceLabels = rows.map(r => r.device || 'Unknown').reverse(); 
  const pick = k => rows.map(r => r[k]).reverse(); 
  
  CHART.data.labels = labels; 
  CHART.data.meta = timeLabels; 
  CHART.data.devices = deviceLabels; 
  CHART.data.datasets[0].data = pick('ec'); 
  CHART.data.datasets[1].data = pick('ph'); 
  CHART.data.datasets[2].data = pick('n'); 
  CHART.data.datasets[3].data = pick('p'); 
  CHART.data.datasets[4].data = pick('k'); 
  CHART.data.datasets[5].data = pick('moi'); 
  CHART.data.datasets[6].data = pick('bat'); 
  CHART.update('none'); 
}

/* ================== Export ================== */
function exportCSVRange(startISO, endISO) {
  const device = document.getElementById('exportDevice').value; // Get device from export modal
  let rows = cache.slice();
  if (device) rows = rows.filter(r => r.device === device);
  const start = startISO ? dayjs(startISO) : null;
  const end = endISO ? dayjs(endISO) : null;
  if (start || end) {
    rows = rows.filter(r => {
      if (!r.ts) return false;
      const t = dayjs(r.ts);
      if (start && t.isBefore(start)) return false;
      if (end && t.isAfter(end)) return false;
      return true;
    });
  }
  const header = ['Time', 'Device', 'EC', 'pH', 'N', 'P', 'K', 'MOI(%)', 'BAT(%)'];
  const lines = [header.join(',')].concat(rows.map(r => [
    fmtTime(r.ts), r.device || '', 
    r.ec != null ? r.ec.toFixed(1) : '', 
    r.ph != null ? r.ph.toFixed(1) : '', 
    r.n != null ? r.n.toFixed(1) : '', 
    r.p != null ? r.p.toFixed(1) : '', 
    r.k != null ? r.k.toFixed(1) : '', 
    r.moi != null ? r.moi.toFixed(1) : '', 
    (r.bat != null ? r.bat.toFixed(1) : '')
  ].map(v => { const s = (v ?? '').toString(); return s.includes(',') ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const dev = device || 'all';
  const sn = startISO ? dayjs(startISO).format('YYYY-MM-DD_HH-mm') : (startDateFilter.value || 'start');
  const en = endISO ? dayjs(endISO).format('YYYY-MM-DD_HH-mm') : (endDateFilter.value || 'end');
  a.download = `smfarm-${dev}-${sn}_to_${en}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ================== Refresh ================== */
async function refresh() { const baseLimit = Number(ddPoints.value || 100); const startDate = startDateFilter.value || null; const endDate = endDateFilter.value || 
  null; const hasRange = !!(startDate || endDate); const allDevicesSelected = !ddDevice.value; 
  // ดึงข้อมูลทั้งหมดเสมอเมื่อเลือก device เฉพาะ หรือมี date range
  const fetchLimit = (hasRange || !allDevicesSelected) ? null : baseLimit * 8; 
  await fetchSheet({ limit: fetchLimit, startDate, endDate }); const rows = filterRows(); 
  
  // KPIs/Chart/Summary/Table use main filter
  updateKPIs(rows[0]); 
  updateChart(rows.slice(0, baseLimit)); 
  updateSummary(rows.slice(0, baseLimit)); updateTable(rows);

  // Advisor uses its own device selection
  const advisorDeviceVal = ddAdvisorDevice ? ddAdvisorDevice.value : null;
  const advisorRows = filterRows(advisorDeviceVal);
  const forBase = advisorRows.slice(0, baseLimit);
  const cards = evaluateSoil(advisorRows[0], forBase);
  renderAdvisor(cards);
  // Update advisor device label if present
  if (elAdvisorDeviceName) {
    const name = advisorDeviceVal ? advisorDeviceVal : 'ทั้งหมด';
    elAdvisorDeviceName.textContent = name;
  }
}
function startAuto() { if (timer) clearInterval(timer); timer = setInterval(refresh, REFRESH_SEC * 1000); }

/* ================== Boot ================== */
window.addEventListener('DOMContentLoaded', async () => {
  // Initialize date inputs with explicit format attributes for mobile compatibility
  if (startDateFilter) {
    startDateFilter.setAttribute('placeholder', 'ทุกวัน');
    startDateFilter.setAttribute('pattern', '[0-9]{4}-[0-9]{2}-[0-9]{2}');
    // Force date input format visibility on mobile browsers
    if (!startDateFilter.value) {
      startDateFilter.setAttribute('data-placeholder', 'ทุกวัน');
    }
  }
  if (endDateFilter) {
    endDateFilter.setAttribute('placeholder', 'ทุกวัน');
    endDateFilter.setAttribute('pattern', '[0-9]{4}-[0-9]{2}-[0-9]{2}');
    if (!endDateFilter.value) {
      endDateFilter.setAttribute('data-placeholder', 'ทุกวัน');
    }
  }

  // Initialize chart
  CHART = makeChart(document.getElementById('chart').getContext('2d')); applyChartTheme(currentTheme()); updateThemeIcon(currentTheme());

  // Theme toggle
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      showToast(`ธีมตอนนี้: ${currentTheme() === 'dark' ? 'โหมดมืด' : 'โหมดสว่าง'}`);
    });
  }

  // Sidebar collapse
  const collapseBtn = document.getElementById('sidebarCollapseBtn');
  const sidebar = document.getElementById('sidebar');
  if (collapseBtn && sidebar) {
    // Restore collapsed state
    const savedCollapsed = localStorage.getItem('smfarm-sidebar-collapsed');
    if (savedCollapsed === 'true') sidebar.classList.add('collapsed');

    collapseBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('smfarm-sidebar-collapsed', sidebar.classList.contains('collapsed'));
    });
  }

  // Mobile menu button
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', openMobileSidebar);
  }
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeMobileSidebar);
  }

  // Navigation click handlers (sidebar)
  document.querySelectorAll('.sidebar .nav-item[data-page]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = `#/${item.dataset.page}`;
    });
  });

  // Navigation click handlers (bottom bar)
  document.querySelectorAll('.bottom-bar .tab-item[data-page]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = `#/${item.dataset.page}`;
    });
  });

  // ESC to close mobile sidebar
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMobileSidebar();
  });

  // Export modal
  const modal = document.getElementById('exportModal'); document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const now = dayjs(); document.getElementById('exportEnd').value = now.format('YYYY-MM-DDTHH:mm'); const startHint = startDateFilter.value ? dayjs(startDateFilter.value).startOf('day') : now.subtract(7, 'day').startOf('day'); document.getElementById('exportStart').value = startHint.format('YYYY-MM-DDTHH:mm');
    // Set export device to match current filter selection
    const exportDevice = document.getElementById('exportDevice');
    if (exportDevice && ddDevice) {
      exportDevice.value = ddDevice.value;
    }
    modal.style.display = 'flex'; showToast('เปิดหน้าต่าง Export');
  }); document.getElementById('exportCancel').addEventListener('click', () => { modal.style.display = 'none'; showToast('ยกเลิก Export'); }); modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; }); document.getElementById('exportConfirm').addEventListener('click', () => { const sEl = document.getElementById('exportStart'); const eEl = document.getElementById('exportEnd'); const s = sEl.value, e = eEl.value; let invalid = false;[sEl, eEl].forEach(el => { el.classList.remove('invalid'); el.closest('.field')?.classList.remove('error-state'); }); if (!s) { sEl.classList.add('invalid'); sEl.closest('.field')?.classList.add('error-state'); invalid = true; } if (!e) { eEl.classList.add('invalid'); eEl.closest('.field')?.classList.add('error-state'); invalid = true; } if (invalid) { showToast('กรุณาเลือกช่วงวันและเวลาให้ครบ'); return; } if (s > e) { eEl.classList.add('invalid'); eEl.closest('.field')?.classList.add('error-state'); showToast('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น'); return; } modal.style.display = 'none'; exportCSVRange(s, e); showToast('กำลังดาวน์โหลดไฟล์ CSV'); });['exportStart', 'exportEnd'].forEach(id => { const el = document.getElementById(id); el.addEventListener('input', () => { el.classList.remove('invalid'); el.closest('.field')?.classList.remove('error-state'); }); });
  
  // Quick range chips
  const chips = ['rangeAll', 'rangeToday', 'range7', 'range30'].map(id => document.getElementById(id)); function setActive(btn) { chips.forEach(c => c && c.setAttribute('aria-pressed', 'false')); if (btn) btn.setAttribute('aria-pressed', 'true'); } const rangeAllBtn = document.getElementById('rangeAll'); if (rangeAllBtn) { rangeAllBtn.addEventListener('click', () => { setActive(rangeAllBtn); startDateFilter.value = ''; endDateFilter.value = ''; refresh(); showToast('เลือกช่วง: ทุกวัน (ทั้งหมด)'); }); } document.getElementById('rangeToday').addEventListener('click', () => { setActive(document.getElementById('rangeToday')); const today = dayjs().format('YYYY-MM-DD'); startDateFilter.value = today; endDateFilter.value = today; refresh(); showToast('เลือกช่วง: วันนี้'); }); document.getElementById('range7').addEventListener('click', () => { setActive(document.getElementById('range7')); startDateFilter.value = dayjs().subtract(6, 'day').format('YYYY-MM-DD'); endDateFilter.value = dayjs().format('YYYY-MM-DD'); refresh(); showToast('เลือกช่วง: 7 วันล่าสุด'); }); document.getElementById('range30').addEventListener('click', () => { setActive(document.getElementById('range30')); startDateFilter.value = dayjs().subtract(29, 'day').format('YYYY-MM-DD'); endDateFilter.value = dayjs().format('YYYY-MM-DD'); refresh(); showToast('เลือกช่วง: 30 วันล่าสุด'); }); ddDevice.addEventListener('change', () => { refresh(); const txt = ddDevice.value ? `Device: ${ddDevice.value}` : 'Device: ทั้งหมด'; showToast(txt); }); ddPoints.addEventListener('change', () => { refresh(); showToast(`กราฟล่าสุด ${ddPoints.value} จุด`); }); startDateFilter.addEventListener('change', () => { if (endDateFilter.value && startDateFilter.value > endDateFilter.value) endDateFilter.value = startDateFilter.value; refresh(); }); endDateFilter.addEventListener('change', () => { if (startDateFilter.value && startDateFilter.value > endDateFilter.value) endDateFilter.value = startDateFilter.value; refresh(); showToast(`ช่วงวันที่: ${formatDateRange()}`); }); document.querySelectorAll('.field[data-click-focus]').forEach(f => { f.addEventListener('click', e => { if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return; const ctrl = f.querySelector('select, input, button'); if (ctrl) { ctrl.focus({ preventScroll: true }); if (ctrl.tagName === 'INPUT' && (ctrl.type === 'date' || ctrl.type === 'datetime-local')) { if (typeof ctrl.showPicker === 'function') { try { ctrl.showPicker(); } catch { } } else { ctrl.click(); } } } }); }); if (rangeAllBtn) { setActive(rangeAllBtn); }

  // Keep advisor device selector in sync
  if (ddAdvisorDevice) {
    ddAdvisorDevice.addEventListener('change', () => {
      // Change advisor analysis only
      refresh();
      showToast(ddAdvisorDevice.value ? `AI Advisor: ${ddAdvisorDevice.value}` : 'AI Advisor: ทั้งหมด');
    });
  }

  // Initialize router
  initRouter();

  // Fetch data and start auto-refresh
  await refresh(); startAuto();
});

// ==== Config (ค่าเริ่มต้น แก้ได้ภายหลังผ่าน UI) ====
const TARGETS = {
  // pH.ok = 5.5–6.0 ; pH.warnLow <5.5 ; pH.warnHigh >6.5
  ph: { okMin: 5.5, okMax: 6.0, warnHigh: 6.5 },
  // EC: แปลงเป็น ppm แล้ว - ค่าประมาณสำหรับกาแฟ
  ec: { warn_ppm: 1280, alert_ppm: 2560, water_max_ppm: 960 }, // ec(ppm) = dS/m × 640
  // MOI.target = 60–80% ; MOI.refill_at ≈ 50%
  moi: { okMinPct: 60, okMaxPct: 80, refillPct: 50 },
  // N/P/K ในหน่วย ppm (แปลงจาก mg/kg เป็น ppm: 1 mg/kg ≈ 1 ppm สำหรับน้ำ)
  // N (NO3-N, ppm; แปลงจากข้อมูล Google Sheets)
  n: { action_lt: 10, warn_lt: 20 }, // <10 ACTION, 10–20 WARN, >20 OK (ppm)
  // P (ppm; แปลงจากข้อมูล Google Sheets)
  p: { action_lt: 30, warn_lt: 60, ok_hi: 80, warn_high_gt: 100 }, // <30 ACTION, 30–60 WARN, 60–80 OK, 80–100 WARN(ค่อนข้างสูง), >100 WARN สูง (ppm)
  // K (ppm; แปลงจากข้อมูล Google Sheets - แปลงจาก cmol(+)/kg)
  // สำหรับ K: 1 cmol(+)/kg ≈ 391 ppm K (ประมาณ)
  k: { action_lt: 117, warn_lt: 196, ok_hi: 391, warn_high_gt: 587 } // แปลงจาก cmol(+)/kg เป็น ppm
};

// ยูทิลขั้นต่ำ
const pct = (v) => Number.isFinite(v) ? Math.round(v * 100) + '%' : '–';
const percentile = (arr, p) => { arr = arr.filter(x => Number.isFinite(x)).sort((a, b) => a - b); if (!arr.length) return null; const i = (arr.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (i - lo); };

// ประเมินข้อมูลล่าสุดเทียบกับฐาน 30 วัน/หรือ N จุดล่าสุด
function evaluateSoil(latest, rows) {
  const cards = [];
  if (!latest) {
    // Return default "no data" cards for all parameters
    ['N', 'P', 'K', 'EC', 'MOI', 'pH'].forEach(param => {
      cards.push({
        key: param.toLowerCase(),
        level: 'warn',
        title: `${param} ไม่มีข้อมูล`,
        message: 'ไม่พบข้อมูลล่าสุด',
        why: 'ไม่สามารถประเมินสภาพดินได้',
        actions: []
      });
    });
    return cards;
  }

  // เตรียมฐาน 30 วัน (ชุดที่โชว์บนกราฟ/ฟิลเตอร์แล้ว)
  const base = rows.slice(0, 300); // พอประมาณ
  const baseStat = m => {
    const v = base.map(r => r[m]).filter(Number.isFinite);
    return { med: percentile(v, 0.5) };
  };

  // --- N/P/K (absolute thresholds) ---
  // N (ppm; แปลงจาก mg/L เป็น equivalent total ppm แล้ว)
  (function () {
    const key = 'n';
    const val = latest[key];
    if (!Number.isFinite(val)) {
      cards.push({ key, level: 'warn', title: 'N ไม่มีข้อมูล', message: 'ไม่พบข้อมูลล่าสุด', why: 'ไม่สามารถประเมินระดับธาตุได้', actions: [] });
      return;
    }
    if (val < TARGETS.n.action_lt) {
      cards.push({
        key, level: 'action', title: 'N ต่ำ',
        message: `N ${val.toFixed(1)} ppm < ${TARGETS.n.action_lt} ppm`,
        why: 'ไนโตรเจนต่ำ กระทบการเจริญเติบโต',
        actions: ['ยูเรีย 46-0-0', 'แอมโมเนียมซัลเฟต 21-0-0']
      });
    } else if (val < TARGETS.n.warn_lt) {
      cards.push({
        key, level: 'warn', title: 'N ค่อนข้างต่ำ',
        message: `N ${val.toFixed(1)} ppm อยู่ในช่วง 10–20 ppm`,
        why: 'เฝ้าระวัง อาจเริ่มขาด',
        actions: ['ปรับแผนใส่ปุ๋ย N', 'ตรวจซ้ำ']
      });
    } else {
      cards.push({
        key, level: 'ok', title: 'N ปกติ',
        message: `N ${val.toFixed(1)} ppm อยู่ในช่วงเหมาะสม (> 20 ppm)`,
        why: 'สุขภาพดินในส่วน N ดีแล้ว',
        actions: []
      });
    }
  })();

  // P (ppm; แปลงจาก mg/L เป็น equivalent total ppm แล้ว)
  (function () {
    const key = 'p';
    const val = latest[key];
    if (!Number.isFinite(val)) {
      cards.push({ key, level: 'warn', title: 'P ไม่มีข้อมูล', message: 'ไม่พบข้อมูลล่าสุด', why: 'ไม่สามารถประเมินระดับธาตุได้', actions: [] });
      return;
    }
    if (val < TARGETS.p.action_lt) {
      cards.push({
        key, level: 'action', title: 'P ต่ำ',
        message: `P ${val.toFixed(1)} ppm < ${TARGETS.p.action_lt} ppm`,
        why: 'ฟอสฟอรัสต่ำ กระทบราก/การออกดอก',
        actions: ['TSP 0-46-0', 'หินฟอสเฟต', 'เพิ่มอินทรียวัตถุ']
      });
    } else if (val < TARGETS.p.warn_lt) {
      cards.push({
        key, level: 'warn', title: 'P ค่อนข้างต่ำ',
        message: `P ${val.toFixed(1)} ppm อยู่ในช่วง 30–60 ppm`,
        why: 'ควรเฝ้าระวังและวางแผนเติม',
        actions: ['ปรับอัตรา P', 'ตรวจซ้ำ']
      });
    } else if (val <= TARGETS.p.ok_hi) {
      cards.push({
        key, level: 'ok', title: 'P ปกติ',
        message: `P ${val.toFixed(1)} ppm อยู่ในช่วงเป้าหมาย 60–80 ppm`,
        why: 'สุขภาพดินในส่วน P ดีแล้ว',
        actions: []
      });
    } else if (val > TARGETS.p.warn_high_gt) {
      cards.push({
        key, level: 'warn', title: 'P สูง',
        message: `P ${val.toFixed(1)} ppm > ${TARGETS.p.warn_high_gt} ppm`,
        why: 'P สูงอาจรบกวนการดูดจุลธาตุ',
        actions: ['เว้น/ลดปุ๋ย P', 'เพิ่มอินทรียวัตถุ', 'ตรวจ Zn/Fe']
      });
    } else {
      // 80–100 ppm
      cards.push({
        key, level: 'warn', title: 'P ค่อนข้างสูง',
        message: `P ${val.toFixed(1)} ppm อยู่ในช่วง 80–100 ppm`,
        why: 'ใกล้ช่วงสูง ควรเฝ้าระวังการสะสม',
        actions: ['ลดอัตรา P', 'ตรวจซ้ำ']
      });
    }
  })();

  // K (ppm; แปลงจาก mg/L เป็น equivalent total ppm แล้ว)
  (function () {
    const key = 'k';
    const val = latest[key];
    if (!Number.isFinite(val)) {
      cards.push({ key, level: 'warn', title: 'K ไม่มีข้อมูล', message: 'ไม่พบข้อมูลล่าสุด', why: 'ไม่สามารถประเมินระดับธาตุได้', actions: [] });
      return;
    }
    if (val < TARGETS.k.action_lt) {
      cards.push({
        key, level: 'action', title: 'K ต่ำ',
        message: `K ${val.toFixed(1)} ppm < ${TARGETS.k.action_lt} ppm`,
        why: 'โพแทสเซียมต่ำ กระทบคุณภาพผลผลิต',
        actions: ['K₂SO₄ 0-0-50', 'เพิ่มอินทรียวัตถุ']
      });
    } else if (val < TARGETS.k.warn_lt) {
      cards.push({
        key, level: 'warn', title: 'K ค่อนข้างต่ำ',
        message: `K ${val.toFixed(1)} ppm อยู่ในช่วง 117–196 ppm`,
        why: 'ควรเฝ้าระวังและวางแผนเติม',
        actions: ['ปรับอัตรา K', 'ตรวจซ้ำ']
      });
    } else if (val <= TARGETS.k.ok_hi) {
      cards.push({
        key, level: 'ok', title: 'K ปกติ',
        message: `K ${val.toFixed(1)} ppm อยู่ในช่วงเป้าหมาย 196–391 ppm`,
        why: 'สุขภาพดินในส่วน K ดีแล้ว',
        actions: []
      });
    } else if (val > TARGETS.k.warn_high_gt) {
      cards.push({
        key, level: 'warn', title: 'K สูง',
        message: `K ${val.toFixed(1)} ppm > ${TARGETS.k.warn_high_gt} ppm`,
        why: 'K สูงอาจเพิ่มความเค็ม/เสียสมดุลแคตไอออน',
        actions: ['เว้นปุ๋ย KCl', 'พิจารณา leaching', 'เพิ่มอินทรียวัตถุ']
      });
    } else {
      // 391–587 ppm
      cards.push({
        key, level: 'warn', title: 'K ค่อนข้างสูง',
        message: `K ${val.toFixed(1)} ppm อยู่ในช่วง 391–587 ppm`,
        why: 'ใกล้ช่วงสูง เฝ้าระวังความเค็ม/สมดุลแคตไอออน',
        actions: ['ลดอัตรา K', 'ตรวจซ้ำ']
      });
    }
  })();

  // --- EC (ppm; แปลงแล้ว) ---
  if (!Number.isFinite(latest.ec)) {
    cards.push({
      key: 'ec',
      level: 'warn',
      title: 'EC ไม่มีข้อมูล',
      message: 'ไม่พบข้อมูลความเค็มล่าสุด',
      why: 'ไม่สามารถประเมินระดับเกลือในดินได้',
      actions: []
    });
  } else {
    const ppm = latest.ec;
    if (ppm >= TARGETS.ec.alert_ppm) {
      cards.push({
        key: 'ec',
        level: 'action',
        title: 'ความเค็มดินสูง',
        message: `EC ${ppm.toFixed(1)} ppm ≥ ${TARGETS.ec.alert_ppm} ppm`,
        why: `เกลือสูงลดศักย์น้ำพืช → เครียด (น้ำชลประทานควรไม่เกิน ${TARGETS.ec.water_max_ppm} ppm)`,
        actions: ['ล้างเกลือ (leaching)', 'ปรับรอบให้น้ำ/ระบายน้ำ', 'เลี่ยง KCl → ใช้ K₂SO₄']
      });
    } else if (ppm >= TARGETS.ec.warn_ppm) {
      cards.push({
        key: 'ec',
        level: 'warn',
        title: 'ความเค็มเริ่มสูง',
        message: `EC ${ppm.toFixed(1)} ppm`,
        why: `เฝ้าระวังการสะสมเกลือ (น้ำชลประทานควรไม่เกิน ${TARGETS.ec.water_max_ppm} ppm)`,
        actions: ['ตรวจคุณภาพน้ำ', 'ลดใส่ปุ๋ยเค็ม', 'เพิ่มอินทรียวัตถุ']
      });
    } else {
      cards.push({
        key: 'ec',
        level: 'ok',
        title: 'ความเค็มปกติ',
        message: `EC ${ppm.toFixed(1)} ppm อยู่ในช่วงเหมาะสม`,
        why: `สุขภาพดินในส่วน EC ดีแล้ว (อ้างอิงน้ำชลประทาน ≤ ${TARGETS.ec.water_max_ppm} ppm)`,
        actions: []
      });
    }
  }

  // --- MOI: target 60–80% (ของ FC), เติมน้ำที่ ~50%
  if (!Number.isFinite(latest.moi)) {
    cards.push({
      key: 'moi',
      level: 'warn',
      title: 'MOI ไม่มีข้อมูล',
      message: 'ไม่พบข้อมูลความชื้นล่าสุด',
      why: 'ไม่สามารถประเมินระดับความชื้นดินได้',
      actions: []
    });
  } else {
    const v = latest.moi; // สมมติค่าเป็น % ของ FC
    if (v <= TARGETS.moi.refillPct) {
      cards.push({
        key: 'moi',
        level: 'action',
        title: 'ถึงจุดต้องให้น้ำ',
        message: `MOI ${v}% ≤ ${TARGETS.moi.refillPct}% (ควรเติมน้ำ)`,
        why: 'ความชื้นต่ำกว่าเกณฑ์เติมน้ำ เสี่ยงเครียดน้ำ',
        actions: ['ให้น้ำ', 'คลุมดินลดการระเหย']
      });
    } else if (v < TARGETS.moi.okMinPct) {
      cards.push({
        key: 'moi',
        level: 'warn',
        title: 'ดินค่อนข้างแห้ง',
        message: `MOI ${v}% < ช่วงเป้าหมาย ${TARGETS.moi.okMinPct}–${TARGETS.moi.okMaxPct}%`,
        why: 'ใกล้เกณฑ์เติมน้ำ ควรเฝ้าระวัง',
        actions: ['ตรวจวัดบ่อยขึ้น', 'ปรับรอบให้น้ำ']
      });
    } else if (v > TARGETS.moi.okMaxPct) {
      cards.push({
        key: 'moi',
        level: 'warn',
        title: 'ดินชื้นเกิน',
        message: `MOI ${v}% > ช่วงเป้าหมาย ${TARGETS.moi.okMinPct}–${TARGETS.moi.okMaxPct}%`,
        why: 'อากาศในดินต่ำ เสี่ยงรากขาดอากาศ',
        actions: ['ลดรอบให้น้ำ', 'ปรับระบายน้ำ']
      });
    } else {
      cards.push({
        key: 'moi',
        level: 'ok',
        title: 'ความชื้นปกติ',
        message: `MOI ${v}% อยู่ในช่วงเป้าหมาย ${TARGETS.moi.okMinPct}–${TARGETS.moi.okMaxPct}%`,
        why: 'สุขภาพดินในส่วนความชื้นดีแล้ว',
        actions: []
      });
    }
  }

  // --- pH ---
  if (!Number.isFinite(latest.ph)) {
    cards.push({
      key: 'ph',
      level: 'warn',
      title: 'pH ไม่มีข้อมูล',
      message: 'ไม่พบข้อมูลค่า pH ล่าสุด',
      why: 'ไม่สามารถประเมินความเป็นกรด-ด่างได้',
      actions: []
    });
  } else {
    if (latest.ph < TARGETS.ph.okMin) {
      cards.push({
        key: 'ph',
        level: 'action',
        title: 'pH กรดจัด',
        message: `pH ${latest.ph} < ${TARGETS.ph.okMin}`,
        why: 'กรดจัดลดการดูด P/K และจุลธาตุ',
        actions: ['ใส่ปูนโดโลไมต์/หินปูน', 'ตรวจดินกำหนดอัตรา', 'ปรับปุ๋ยรูปแอมโมเนียม']
      });
    } else if (latest.ph > TARGETS.ph.warnHigh) {
      cards.push({
        key: 'ph',
        level: 'warn',
        title: 'pH ด่างไป',
        message: `pH ${latest.ph} > ${TARGETS.ph.warnHigh}`,
        why: 'ด่างเกินอาจตรึง P/จุลธาตุ',
        actions: ['กำมะถันผง (S)', 'ใช้ปุ๋ยกรด (AS)', 'ตรวจดิน']
      });
    } else if (latest.ph <= TARGETS.ph.okMax) {
      cards.push({
        key: 'ph',
        level: 'ok',
        title: 'pH ปกติ',
        message: `pH ${latest.ph} อยู่ในช่วงเป้าหมาย ${TARGETS.ph.okMin}–${TARGETS.ph.okMax}`,
        why: 'สุขภาพดินในส่วน pH ดีแล้ว',
        actions: []
      });
    } else {
      // ค่ากลาง 6.0–6.5: ใช้เตือนอ่อน ๆ ให้เฝ้าระวัง
      cards.push({
        key: 'ph',
        level: 'warn',
        title: 'pH ค่อนข้างด่าง',
        message: `pH ${latest.ph} > ${TARGETS.ph.okMax} แต่ยังไม่เกิน ${TARGETS.ph.warnHigh}`,
        why: 'ใกล้ขอบบนของช่วงที่เหมาะสม ควรเฝ้าระวัง',
        actions: ['ตรวจวัดสม่ำเสมอ', 'หลีกเลี่ยงปุ๋ยที่เพิ่ม pH']
      });
    }
  }

  return cards;
}

// เรนเดอร์การ์ดคำแนะนำ
function renderAdvisor(cards) {
  const el = document.getElementById('advisor');
  if (!el) return;

  const missingCard = (key) => ({
    key,
    level: 'warn',
    title: `${key.toUpperCase()} ไม่มีข้อมูล`,
    message: 'ไม่พบข้อมูลล่าสุด',
    why: 'ไม่สามารถประเมินได้',
    actions: []
  });

  const getCard = (key) => cards.find(c => c && c.key === key) || missingCard(key);

  // ใช้ breakpoint เดียวกับส่วนอื่น (<=640px)
  let isMobile = false;
  try {
    isMobile = !!(window.matchMedia && window.matchMedia('(max-width:640px)').matches);
  } catch {}

  // จัดแถว: แถว1 N & EC, แถว2 P & pH, แถว3 K & MOI
  const rows = [
    ['n', 'ec'],
    ['p', 'ph'],
    ['k', 'moi']
  ];

  const cardTpl = (card) => `
    <div class="card ${card.level}">
      <div>
        <div><strong>${card.title}</strong> — ${card.message}</div>
        <div class="why">${card.why}</div>
        ${(!isMobile && card.actions?.length) ? `<div class="chips">${card.actions.map(a => `<span class="chip">${a}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;

  const html = rows.map(pair => {
    const left = getCard(pair[0]);
    const right = getCard(pair[1]);
    return `
      <div class="advisor-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        ${cardTpl(left)}
        ${cardTpl(right)}
      </div>`;
  }).join('');

  el.innerHTML = html;
}
