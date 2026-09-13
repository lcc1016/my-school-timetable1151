/**
 * ============================================================
 *  課表查詢系統 - 應用程式邏輯 (app.js)
 *  民雄國中
 * ============================================================
 */

/* ── 全域設定 ─────────────────────────────────────────────── */
// 請替換成你部署好的 Google Apps Script 網址
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyymH4_8hdi1SmccV6-m8hMsVJhkdEHDBtci9kluH_gb-37ERTX-JL4OOE_z7od6fSgUw/exec";

/* ── 全域狀態 ─────────────────────────────────────────────── */
let scheduleData          = [];   // CSV 全部資料
let homeroomData          = {};   // 導師資料 JSON
let lockedData            = {};   // 1~7 節綁課資料 JSON
let lockedDataP8          = {};   // 第 8 節獨立綁課資料 JSON
let isLoggedIn            = false;
let navHistory            = [];   // 導航歷史 [{type, value}]
let classGroups           = {};   // 班級分類
let subjectTeachers       = {};   // 科目→教師
let currentDisplayedClass = '';   // 當前顯示的班級名稱

const PERIODS_ALL   = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // 0=早自習, 1~8=第1~8節
const DAYS          = ['一', '二', '三', '四', '五'];

/* ── DOM 參考 ─────────────────────────────────────────────── */
let loginView, queryView, resultView, loadingOverlay, scheduleTitle, scheduleTableContainer;

function initDomReferences() {
    loginView = document.getElementById('loginView');
    queryView = document.getElementById('queryView');
    resultView = document.getElementById('resultView');
    loadingOverlay = document.getElementById('loadingOverlay');
    scheduleTitle = document.getElementById('scheduleTitle');
    scheduleTableContainer = document.getElementById('scheduleTableContainer');
}

/* ═══════════════════════════════════════════════════════════
    瀏覽統計計數器 (串接 Google Apps Script 後端)
═══════════════════════════════════════════════════════════ */

/**
 * 初始化計數器：網頁載入時向 GAS 請求「當月」與「總累計」人數
 */
async function initViewCounter() {
    if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.includes("YOUR_DEPLOYMENT_ID")) return;

    try {
        const response = await fetch(`${GAS_WEB_APP_URL}?action=getCounter`);
        if (!response.ok) throw new Error(`HTTP 錯誤 ${response.status}`);
        
        const data = await response.json();
        console.log("GAS 回傳資料 (init):", data);

        // 相容性處理：同時支援新版 {month, total} 與舊版 {count}
        const monthVal = (data && data.month !== undefined) ? data.month : 0;
        const totalVal = (data && data.total !== undefined) ? data.total : (data ? (data.count || 0) : 0);

        updateCounterDisplay(monthVal, totalVal);
    } catch (err) {
        console.error('讀取雲端計數器失敗:', err);
    }
}

/**
 * 累加計數器：執行查詢時呼叫，讓 GAS 後端的當月與總計數同時 +1
 */
async function incrementViewCounter() {
    if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.includes("YOUR_DEPLOYMENT_ID")) return;

    try {
        const response = await fetch(`${GAS_WEB_APP_URL}?action=increment`);
        if (!response.ok) throw new Error(`HTTP 錯誤 ${response.status}`);
        
        const data = await response.json();
        console.log("GAS 回傳資料 (increment):", data);

        // 相容性處理：同時支援新版 {month, total} 與舊版 {count}
        const monthVal = (data && data.month !== undefined) ? data.month : 0;
        const totalVal = (data && data.total !== undefined) ? data.total : (data ? (data.count || 0) : 0);

        updateCounterDisplay(monthVal, totalVal);
    } catch (err) {
        console.error('更新雲端計數器失敗:', err);
    }
}

/**
 * 更新 HTML 畫面上所有計數器位置的數字
 */
function updateCounterDisplay(monthTotal, overallTotal) {
    // 1. 更新當月瀏覽 (對應 ID: monthViews 或 class: month-visitor-count)
    const monthEls = document.querySelectorAll('#monthViews, .month-visitor-count');
    monthEls.forEach(el => {
        if (el) el.textContent = Number(monthTotal || 0).toLocaleString();
    });

    // 2. 更新總累計瀏覽 (對應 ID: totalViews, visitorCount 或 class: total-visitor-count)
    const totalEls = document.querySelectorAll('#totalViews, #visitorCount, .total-visitor-count');
    totalEls.forEach(el => {
        if (el) el.textContent = Number(overallTotal || 0).toLocaleString();
    });
}

/* ═══════════════════════════════════════════════════════════
    視圖切換
═══════════════════════════════════════════════════════════ */
function showView(viewId) {
    [loginView, queryView, resultView].forEach(v => {
        if (v) {
            v.classList.remove('active', 'result-active');
            v.style.display = 'none';
        }
    });
    const target = document.getElementById(viewId);
    if (!target) return;
    if (viewId === 'resultView') {
        target.classList.add('result-active');
        target.style.display = 'block';
    } else {
        target.classList.add('active');
        target.style.display = 'flex';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showQueryView() {
    navHistory = [];
    resetGradeSelects();
    showView('queryView');
}

function logout() {
    isLoggedIn   = false;
    scheduleData = [];
    homeroomData = {};
    lockedData   = {};
    lockedDataP8 = {};
    navHistory   = [];
    const errEl   = document.getElementById('loginError');
    if (errEl) errEl.textContent = '';
    showView('loginView');
}

/* ═══════════════════════════════════════════════════════════
    導航歷史（返回上一頁）
═══════════════════════════════════════════════════════════ */
function pushNav(type, value) {
    navHistory.push({ type, value });
    updateBackBtn();
}

function goBack() {
    if (navHistory.length <= 1) {
        showQueryView();
        return;
    }
    navHistory.pop();
    const prev = navHistory[navHistory.length - 1];
    navHistory.pop();
    if (prev.type === 'class') displayClassSchedule(prev.value);
    else displayTeacherSchedule(prev.value);
}

function updateBackBtn() {
    const btn = document.getElementById('backBtn');
    if (!btn) return;
    btn.style.visibility = navHistory.length > 1 ? 'visible' : 'hidden';
}

/* ═══════════════════════════════════════════════════════════
    上一班 / 下一班 快速切換邏輯
═══════════════════════════════════════════════════════════ */

/**
 * 根據班級名稱，取得該班在同年級（或特殊班）清單中的索引與整個陣列
 */
function getClassNavigationInfo(className) {
    if (!className) return { list: [], index: -1 };
    
    let targetGroup = null;
    for (const groupName in classGroups) {
        if (classGroups[groupName].includes(className)) {
            targetGroup = classGroups[groupName];
            break;
        }
    }

    if (!targetGroup) return { list: [], index: -1 };

    const index = targetGroup.indexOf(className);
    return { list: targetGroup, index };
}

/**
 * 切換至上一班 (-1) 或 下一班 (+1)
 */
function navigateClass(direction) {
    if (!currentDisplayedClass) return;

    const { list, index } = getClassNavigationInfo(currentDisplayedClass);
    if (index === -1) return;

    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < list.length) {
        const targetClass = list[newIndex];
        
        // 替換歷史紀錄最後一筆，避免按返回鍵時卡在快速切換的歷史中
        if (navHistory.length > 0) {
            navHistory[navHistory.length - 1] = { type: 'class', value: targetClass };
        }
        
        displayClassSchedule(targetClass);
    }
}

/**
 * 控制【上一班 / 下一班】按鈕的顯示與停用狀態
 */
function updateClassNavButtons(className) {
    const prevBtn = document.getElementById('prevClassBtn');
    const nextBtn = document.getElementById('nextClassBtn');
    if (!prevBtn || !nextBtn) return;

    const { list, index } = getClassNavigationInfo(className);

    if (index === -1 || list.length <= 1) {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        return;
    }

    // 顯示按鈕
    prevBtn.style.display = 'inline-block';
    nextBtn.style.display = 'inline-block';

    // 若為第 1 班則禁用「上一班」，若為最後一班則禁用「下一班」
    prevBtn.disabled = (index === 0);
    nextBtn.disabled = (index === list.length - 1);
}

/* ═══════════════════════════════════════════════════════════
    學期下拉選單初始化
═══════════════════════════════════════════════════════════ */
function populateSemesterSelect() {
    const sel = document.getElementById('semesterSelect');
    if (!sel || typeof CONFIG === 'undefined' || !CONFIG.SEMESTERS) return;
    
    sel.innerHTML = '';
    const keys = Object.keys(CONFIG.SEMESTERS);

    keys.forEach((label, i) => {
        const opt = document.createElement('option');
        opt.value       = label;
        opt.textContent = label;
        if (i === keys.length - 1) opt.selected = true;
        sel.appendChild(opt);
    });
}

/* ═══════════════════════════════════════════════════════════
    CSV 與 JSON 載入與解析
═══════════════════════════════════════════════════════════ */
async function fetchAndParseCSV(semLabel) {
    if (loadingOverlay) loadingOverlay.classList.add('show');

    let csvUrl = './teacher_11501.csv';
    let jsonUrl = './homerooms_11501.json';

    if (typeof CONFIG !== 'undefined' && CONFIG.SEMESTERS && semLabel && CONFIG.SEMESTERS[semLabel]) {
        const semObj = CONFIG.SEMESTERS[semLabel];
        if (typeof semObj === 'string') {
            csvUrl = semObj;
        } else if (typeof semObj === 'object') {
            csvUrl = semObj.csv || csvUrl;
            jsonUrl = semObj.homerooms || jsonUrl;
        }
    }

    try {
        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error(`HTTP 錯誤 ${response.status}`);
        
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('utf-8');
        let csvText = decoder.decode(buffer);
        if (csvText.charCodeAt(0) === 0xFEFF) {
            csvText = csvText.slice(1);
        }

        try {
            const hmRes = await fetch(jsonUrl);
            if (hmRes.ok) homeroomData = await hmRes.json();
            else homeroomData = {};
        } catch (e) { homeroomData = {}; }

        // 載入 1~7 節綁課資料
        let lockUrl = (typeof CONFIG !== 'undefined' && CONFIG.LOCKED_COURSES_URL) ? CONFIG.LOCKED_COURSES_URL : './locked_courses.json';
        try {
            const lockRes = await fetch(lockUrl);
            if (lockRes.ok) lockedData = await lockRes.json();
            else lockedData = {};
        } catch (e) { lockedData = {}; }

        // 載入第 8 節獨立綁課資料
        let lockP8Url = (typeof CONFIG !== 'undefined' && CONFIG.LOCKED_COURSES_P8_URL) ? CONFIG.LOCKED_COURSES_P8_URL : './8locked_courses.json';
        try {
            const lockP8Res = await fetch(lockP8Url);
            if (lockP8Res.ok) lockedDataP8 = await lockP8Res.json();
            else lockedDataP8 = {};
        } catch (e) { lockedDataP8 = {}; }

        const parsed = parseCSV(csvText);
        if (parsed.length === 0) throw new Error('CSV 資料為空');

        scheduleData = parsed;
        buildCategories();
        populateQueryUI();
        isLoggedIn = true;

        const badge = document.getElementById('currentSemester');
        if (badge) badge.textContent = semLabel || '';

        if (loadingOverlay) loadingOverlay.classList.remove('show');
        showView('queryView');

    } catch (err) {
        if (loadingOverlay) loadingOverlay.classList.remove('show');
        console.error(err);
        const errEl = document.getElementById('loginError');
        if (errEl) errEl.textContent = `載入失敗：${err.message}。請確認 CSV/JSON 檔案路徑。`;
    }
}

/* ── 輔助函式：判斷是否綁課 (新增支援第8節獨立邏輯) ───────────────────── */
function isSubjectLocked(className, subjectName, period) {
    if (!className || !subjectName) return false;

    // 依據節次選用對應的綁課 JSON 資料源
    const currentLockData = (period === 8) ? lockedDataP8 : lockedData;
    if (!currentLockData) return false;

    const cleanClass = className.trim();
    const numClass = className.replace(/\D/g, ''); 
    const cleanSubj = normalizeSubject(subjectName);

    const rules = currentLockData[numClass] || currentLockData[cleanClass] || currentLockData[className];
    if (!rules) return false;

    return rules.includes('ALL') || rules.includes(cleanSubj) || rules.includes(subjectName.trim());
}

/* ── CSV 解析 ─────────────────────────────────────────────── */
function splitCSVLine(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
        else { cur += c; }
    }
    result.push(cur);
    return result;
}

function parseCSV(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    const headers = splitCSVLine(lines[0]);
    return lines.slice(1).map(line => {
        const vals = splitCSVLine(line);
        const obj = {};
        headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim());
        return obj;
    }).filter(r => r.teachername);
}

/* ═══════════════════════════════════════════════════════════
    建立分類資料 (依指定班級數字範圍精確分類)
═══════════════════════════════════════════════════════════ */
function buildCategories() {
    const allClasses = new Set();
    const PERIODS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    
    scheduleData.forEach(row => {
        for (let d = 1; d <= 5; d++) {
            for (let p of PERIODS) {
                const classStr = row[`c${d}${p}`];
                if (classStr) {
                    classStr.split(/[\s/]+/).forEach(cls => {
                        cls = cls.trim();
                        if (cls) allClasses.add(cls);
                    });
                }
            }
        }
    });

    if (homeroomData) {
        Object.keys(homeroomData).forEach(cls => {
            if (cls && cls.trim()) allClasses.add(cls.trim());
        });
    }

    classGroups = { '七年級': [], '八年級': [], '九年級': [], '特殊班': [] };
    
    [...allClasses].forEach(cls => {
        // 解析純數字 (例："701" 或 "701班" 都會得到 701)
        const classNum = parseInt(cls.replace(/\D/g, ''), 10);
        
        if (classNum >= 701 && classNum <= 710) {
            classGroups['七年級'].push(cls);
        } else if (classNum >= 801 && classNum <= 812) {
            classGroups['八年級'].push(cls);
        } else if (classNum >= 901 && classNum <= 912) {
            classGroups['九年級'].push(cls);
        } else {
            // 未符合以上範圍（例：711、813、特教班、體育班）一律歸入特殊班 / 其他
            classGroups['特殊班'].push(cls);
        }
    });

    // 各年級內部按班級數字大小排序
    ['七年級', '八年級', '九年級', '特殊班'].forEach(g => {
        classGroups[g].sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.replace(/\D/g, '')) || 0;
            if (numA !== numB) return numA - numB;
            return a.localeCompare(b, 'zh-TW');
        });
    });

    subjectTeachers = {};
    scheduleData.forEach(row => {
        for (let d = 1; d <= 5; d++) {
            for (let p of PERIODS_ALL) {
                const subj = row[`s${d}${p}`];
                if (!subj) continue;
                subj.split('/').forEach(s => {
                    const base = normalizeSubject(s);
                    if (base) {
                        if (!subjectTeachers[base]) subjectTeachers[base] = new Set();
                        subjectTeachers[base].add(row.teachername);
                    }
                });
            }
        }
    });
    Object.keys(subjectTeachers).forEach(k => {
        subjectTeachers[k] = [...subjectTeachers[k]].sort();
    });
}

function normalizeSubject(subj) {
    return (subj || '').replace(/輔導$/, '').replace(/加強$/, '').trim();
}

/* ═══════════════════════════════════════════════════════════
    填充查詢 UI
═══════════════════════════════════════════════════════════ */
function populateQueryUI() {
    populateGradeSelect('sel7',  classGroups['七年級']);
    populateGradeSelect('sel8',  classGroups['八年級']);
    populateGradeSelect('sel9',  classGroups['九年級']);
    populateGradeSelect('selSp', classGroups['特殊班']);

    const subjectSel = document.getElementById('subjectSelect');
    if (subjectSel) {
        subjectSel.innerHTML = '<option value="">— 選擇科目 —</option>';
        Object.keys(subjectTeachers).sort().forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            subjectSel.appendChild(opt);
        });
    }
}

function populateGradeSelect(selId, classes) {
    const sel = document.getElementById(selId);
    if (!sel) return;
    sel.innerHTML = '<option value="">— 選擇班級 —</option>';
    (classes || []).forEach(cls => {
        const opt = document.createElement('option');
        opt.value = cls; opt.textContent = cls;
        sel.appendChild(opt);
    });
}

/* ═══════════════════════════════════════════════════════════
    Tab 切換
═══════════════════════════════════════════════════════════ */
function switchTab(tab) {
    const tabClass = document.getElementById('tabClass');
    const tabTeacher = document.getElementById('tabTeacher');
    const panelClass = document.getElementById('panelClass');
    const panelTeacher = document.getElementById('panelTeacher');

    if (tabClass) tabClass.classList.toggle('active', tab === 'class');
    if (tabTeacher) tabTeacher.classList.toggle('active', tab === 'teacher');
    if (panelClass) panelClass.classList.toggle('hidden', tab !== 'class');
    if (panelTeacher) panelTeacher.classList.toggle('hidden', tab !== 'teacher');
}

/* ═══════════════════════════════════════════════════════════
    班級查詢
═══════════════════════════════════════════════════════════ */
function setupGradeSelects() {
    const gradeMap = {
        sel7:  ['sel8', 'sel9', 'selSp'],
        sel8:  ['sel7', 'sel9', 'selSp'],
        sel9:  ['sel7', 'sel8', 'selSp'],
        selSp: ['sel7', 'sel8', 'sel9']
    };
    Object.entries(gradeMap).forEach(([id, others]) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.bound) return;
        el.dataset.bound = "true";
        el.addEventListener('change', () => {
            if (el.value) others.forEach(oid => {
                const oe = document.getElementById(oid);
                if (oe) oe.value = '';
            });
            const ce = document.getElementById('classError');
            if (ce) ce.textContent = '';
        });
    });
}

function resetGradeSelects() {
    ['sel7', 'sel8', 'sel9', 'selSp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const ce = document.getElementById('classError');
    if (ce) ce.textContent = '';
    const te = document.getElementById('teacherError');
    if (te) te.textContent = '';
}

function submitClassQuery() {
    const cls = ['sel7', 'sel8', 'sel9', 'selSp']
        .map(id => document.getElementById(id)?.value)
        .find(v => v);
    if (!cls) {
        const ce = document.getElementById('classError');
        if (ce) ce.textContent = '請先選擇一個班級';
        return;
    }
    navHistory = [];
    incrementViewCounter(); // 觸發雲端計數器 +1
    displayClassSchedule(cls);
}

/* ═══════════════════════════════════════════════════════════
    教師查詢
═══════════════════════════════════════════════════════════ */
function onSubjectChange() {
    const subjSel = document.getElementById('subjectSelect');
    const teacherSel = document.getElementById('teacherSelect');
    if (!subjSel || !teacherSel) return;
    
    const subj = subjSel.value;
    teacherSel.innerHTML = '<option value="">— 選擇教師 —</option>';
    if (!subj) return;
    
    (subjectTeachers[subj] || []).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        teacherSel.appendChild(opt);
    });
    const te = document.getElementById('teacherError');
    if (te) te.textContent = '';
}

function submitTeacherQuery() {
    const teacherSel = document.getElementById('teacherSelect');
    const teacher = teacherSel ? teacherSel.value : '';
    if (!teacher) {
        const te = document.getElementById('teacherError');
        if (te) te.textContent = '請先選擇科目與教師';
        return;
    }
    navHistory = [];
    incrementViewCounter(); // 觸發雲端計數器 +1
    displayTeacherSchedule(teacher);
}

/* ═══════════════════════════════════════════════════════════
    顯示課表
═══════════════════════════════════════════════════════════ */
function displayClassSchedule(className) {
    currentDisplayedClass = className; // 記錄當前顯示的班級
    pushNav('class', className);
    const cells = {};
    scheduleData.forEach(row => {
        for (let d = 1; d <= 5; d++) {
            for (let p of PERIODS_ALL) {
                const classRaw = row[`c${d}${p}`] || '';
                const classes = classRaw.split(/[\s/]+/);
                
                if (classes.includes(className) && row[`s${d}${p}`]) {
                    const key = `${d}-${p}`;
                    const subj = row[`s${d}${p}`];
                    const locked = isSubjectLocked(className, subj, p);

                    if (!cells[key]) {
                        cells[key] = { subject: subj, items: [row.teachername], isLocked: locked };
                    } else {
                        if (!cells[key].items.includes(row.teachername)) {
                            cells[key].items.push(row.teachername);
                        }
                        if (locked) cells[key].isLocked = true;
                    }
                }
            }
        }
    });
    
    const numClass = className.replace(/\D/g, '');
    const hmTeacher = homeroomData[className] || homeroomData[numClass] || '';
    const hmHtml = hmTeacher ? `<span style="font-size: 1.1rem; color: var(--text-dim, #666); margin-left: 0.5rem; font-weight: 500;">(導師：${escText(hmTeacher)})</span>` : '';
    
    if (scheduleTitle) scheduleTitle.innerHTML = `${escText(className)} 班課表 ${hmHtml}`;
    if (scheduleTableContainer) scheduleTableContainer.innerHTML = buildScheduleTable(cells, 'class', className);

    // 更新【上一班 / 下一班】按鈕的顯示狀態與啟用邏輯
    updateClassNavButtons(className);

    showView('resultView');
    updateBackBtn();
}

function displayTeacherSchedule(teacherName) {
    currentDisplayedClass = ''; // 清除班級紀錄
    
    // 隱藏【上一班 / 下一班】按鈕
    const prevBtn = document.getElementById('prevClassBtn');
    const nextBtn = document.getElementById('nextClassBtn');
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';

    pushNav('teacher', teacherName);
    const row   = scheduleData.find(r => r.teachername === teacherName);
    const cells = {};
    if (row) {
        for (let d = 1; d <= 5; d++) {
            for (let p of PERIODS_ALL) {
                if (row[`s${d}${p}`]) {
                    const key = `${d}-${p}`;
                    const subj = row[`s${d}${p}`];
                    const classRaw = row[`c${d}${p}`] || '';
                    const classes = classRaw.split(/[\s/]+/).filter(x => x);
                    const locked = classes.some(cls => isSubjectLocked(cls, subj, p));

                    cells[key] = { subject: subj, items: classes, isLocked: locked };
                }
            }
        }
    }
    if (scheduleTitle) scheduleTitle.textContent = `${teacherName} 老師課表`;
    if (scheduleTableContainer) scheduleTableContainer.innerHTML = buildScheduleTable(cells, 'teacher');

    showView('resultView');
    updateBackBtn();
}

/* ═══════════════════════════════════════════════════════════
    建構課表 HTML (包含午休)
═══════════════════════════════════════════════════════════ */
function buildScheduleTable(cells, mode, currentClassName = '') {
    const periods   = (typeof CONFIG !== 'undefined' && CONFIG.PERIOD_TIMES) || [];
    const hasEarly  = Object.keys(cells).some(k => k.endsWith('-0'));

    let html = '<table class="schedule-table"><thead><tr>';
    html += '<th class="th-period">節次</th>';
    DAYS.forEach(d => html += `<th>${d}</th>`);
    html += '</tr></thead><tbody>';

    // 1. 早自習
    if (hasEarly) {
        const et = periods[0] || { start: '07:35', end: '08:10' };
        html += `<tr><td class="td-period">
            <div class="period-num">早自習</div>
            <div class="period-time">${escText(et.start)}<br>${escText(et.end)}</div>
        </td>`;
        for (let d = 1; d <= 5; d++) {
            html += renderCell(cells[`${d}-0`], mode, d, 0, currentClassName);
        }
        html += '</tr>';
    }

    // 2. 正課 1 ~ 8 節 (包含午休)
    for (let p = 1; p <= 8; p++) {
        if (p === 5) {
            const lunchTime = periods['lunch'] || { start: '12:20', end: '13:00' };
            html += `<tr class="tr-break">
                <td class="td-period">
                    <div class="period-num">午休</div>
                    <div class="period-time">${escText(lunchTime.start)}<br>${escText(lunchTime.end)}</div>
                </td>
                <td colspan="5" class="td-break-content">午休</td>
            </tr>`;
        }

        const pt = periods[p] || { start: '', end: '' };
        html += `<tr class="${p === 8 ? 'period-8-row' : ''}"><td class="td-period"><div class="period-num">第${p}節</div>`;
        if (pt.start && pt.start !== '——') {
            html += `<div class="period-time">${escText(pt.start)}<br>${escText(pt.end)}</div>`;
        }
        html += '</td>';
        for (let d = 1; d <= 5; d++) {
            html += renderCell(cells[`${d}-${p}`], mode, d, p, currentClassName);
        }
        html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
}

function renderCell(cell, mode, day, period, currentClassName = '') {
    if (!cell) return '<td class="td-empty"></td>';
    
    const itemsHtml = (cell.items || []).map(item => {
        if (mode === 'class') {
            return `<div class="cell-link" onclick="displayTeacherSchedule('${escJsParam(item)}')">${escText(item)}</div>`;
        } else {
            return `<div class="cell-link" onclick="displayClassSchedule('${escJsParam(item)}')">${escText(item)}</div>`;
        }
    }).join(' ');

    let lockBadge = '';
    let cellClass = 'td-cell';

    if (cell.isLocked) {
        if (period === 8) {
            lockBadge = `<span class="lock-tag lock-tag-p8" title="此為第8節獨立綁課，不可調課">🔒綁課</span>`;
            cellClass = 'td-cell cell-locked-p8';
        } else {
            lockBadge = `<span class="lock-tag" title="此課程已綁定，不可調課">🔒 綁課</span>`;
            cellClass = 'td-cell cell-locked';
        }
    }

    let subjHtml = `<div class="cell-subject">${escText(cell.subject)} ${lockBadge}</div>`;
    if (mode === 'class') {
        const subjClick = `onclick="showAvailableTeachers('${escJsParam(cell.subject)}', ${day}, ${period}, '${escJsParam(currentClassName)}')"`
        subjHtml = `<div class="cell-subject clickable-subject" ${subjClick} title="點擊檢視該節空堂教師">${escText(cell.subject)} ${lockBadge}</div>`;
    }

    return `<td class="${cellClass}">
        <div class="cell-main-info">
            ${subjHtml}
            <div class="cell-items-container">${itemsHtml}</div>
        </div>
    </td>`;
}

/* ═══════════════════════════════════════════════════════════
    彈出視窗（Modal）邏輯：查詢該節空堂教師
═══════════════════════════════════════════════════════════ */
function showAvailableTeachers(subject, day, period, className) {
    const baseSubject = normalizeSubject(subject);
    
    // 完全保留您提供的完整排除名單
    const EXCLUDED_OTHER_SUBJECT_TEACHERS = new Set([
        "李漢堂", "陳綉燕", "何嘉峻", "蔡宜婷", "周億琳", "張孟傑", "莊宗儒", 
        "許湫萍", "邱順瑜", "陳群靜", "高健雄", "吳瑩娟", "張介凡", "Divina", 
        "Jun", "侯旻汶", "何晚居", "吳相禹", "吳月雲", "蕭因伶", "張芸榛", 
        "國代", "尤靖瑜", "張詠濬", "李雪菱", "林宇涵", "林宜潔", "林菀婷", 
        "洪楷哲", "洪顧展", "洪齊成", "特教代", "盧洪恩", "簡晟軒", "莊竣麟", 
        "董祐鈞", "蔡晨虹", "蔡佩珊", "蔡鈺萱", "許錦川", "賴泓文", "趙爾梅", 
        "郭勝綸", "郭泰延", "鄭珮辰", "鄭白苹", "鄭耀宗", "蔡麗香", "蔡明芬",
        "陳國川", "張曼玲", "何嘉峻", "沈伯齡",
    ]);

    // 1. 同科目空堂教師（不論節次，只要任教該科且該節空堂者）
    const primaryTeachers = (subjectTeachers[baseSubject] || []).filter(teacher => {
        const row = scheduleData.find(r => r.teachername === teacher);
        return row && !row[`s${day}${period}`];
    });

    // 2. 該班其他科目空堂教師（依據是否為第 8 節進行獨立比對）
    const otherTeachersMap = new Map();
    
    if (className) {
        // 判斷點擊的是否為第 8 節
        const isP8Query = (period === 8);
        // 第 8 節僅檢查 [8]；1~7 節則檢查正課 [1, 2, 3, 4, 5, 6, 7]
        const targetPeriods = isP8Query ? [8] : [1, 2, 3, 4, 5, 6, 7];

        scheduleData.forEach(row => {
            for (let d = 1; d <= 5; d++) {
                for (let p of targetPeriods) {
                    const classRaw = row[`c${d}${p}`] || '';
                    const classes = classRaw.split(/[\s/]+/);
                    
                    if (classes.includes(className)) {
                        const subj = row[`s${d}${p}`];
                        const normSubj = normalizeSubject(subj);
                        
                        if (
                            normSubj && 
                            normSubj !== baseSubject && 
                            !primaryTeachers.includes(row.teachername) &&
                            !EXCLUDED_OTHER_SUBJECT_TEACHERS.has(row.teachername)
                        ) {
                            if (!row[`s${day}${period}`]) {
                                if (!otherTeachersMap.has(row.teachername)) {
                                    otherTeachersMap.set(row.teachername, new Set());
                                }
                                otherTeachersMap.get(row.teachername).add(normSubj);
                            }
                        }
                    }
                }
            }
        });
    }

    const periodText = period === 0 ? '早自習' : `第 ${period} 節`;
    const dayText = DAYS[day - 1] || day;
    
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modal = document.getElementById('subModal');

    if (modalTitle) {
        modalTitle.textContent = `星期${dayText}${periodText} 可代課教師`;
    }

    if (modalBody) {
        let html = '';

        // 【同科】空堂教師
        html += `<div class="sub-group-title">【${escText(baseSubject)}】科空堂教師：</div>`;
        if (primaryTeachers.length === 0) {
            html += `<p class="no-teacher-msg">無同科空堂教師</p>`;
        } else {
            html += '<div class="teacher-grid" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-bottom:12px;">';
            primaryTeachers.forEach(t => {
                html += `<button class="btn btn-teacher-tag btn-primary-subject" onclick="selectModalTeacher('${escJsParam(t)}')">${escText(t)}</button>`;
            });
            html += '</div>';
        }

        // 【其他科目】空堂教師 (標題動態區分第 8 節與正課)
        const otherSectionTitle = (period === 8) ? '該班第八節其他任課空堂教師' : '該班其他科目空堂教師';
        html += `<div class="sub-group-title mt-3">${otherSectionTitle}：</div>`;
        if (otherTeachersMap.size === 0) {
            html += `<p class="no-teacher-msg">無其他科目空堂教師</p>`;
        } else {
            html += '<div class="teacher-grid" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center;">';
            otherTeachersMap.forEach((subjs, t) => {
                const subjTags = Array.from(subjs).join('、');
                html += `<button class="btn btn-teacher-tag btn-other-subject" onclick="selectModalTeacher('${escJsParam(t)}')" title="${escAttr(subjTags)}">${escText(t)} <span class="teacher-subj-badge">(${escText(subjTags)})</span></button>`;
            });
            html += '</div>';
        }

        modalBody.innerHTML = html;
    }

    if (modal) {
        modal.classList.add('show');
        modal.style.display = 'flex';
    }
}

function selectModalTeacher(teacherName) {
    closeSubModal();
    displayTeacherSchedule(teacherName);
}

function closeSubModal(event) {
    if (!event || event.target.id === 'subModal' || event.target.classList.contains('modal-close') || event.target.closest('.modal-close')) {
        const modal = document.getElementById('subModal');
        if (modal) {
            modal.classList.remove('show');
            modal.style.display = 'none';
        }
    }
}

/* ── 安全轉義工具函式 ─────────────────────────────────────── */
function escText(str) {
    return (str || '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escAttr(str) {
    return escText(str)
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escJsParam(str) {
    return (str || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"');
}

/* ═══════════════════════════════════════════════════════════
    列印
═══════════════════════════════════════════════════════════ */
function printSchedule() {
    if (!scheduleTitle || !scheduleTableContainer) return;
    const title     = scheduleTitle.textContent;
    const tableHTML = scheduleTableContainer.innerHTML;
    const semLabel  = document.getElementById('currentSemester')?.textContent || '';

    const win = window.open('', '_blank', 'width=1100,height=750');
    if (!win) {
        alert('請允許開啟彈出式視窗以進行列印功能。');
        return;
    }
    
    win.document.write(`<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="UTF-8">
<title>${escText(title)}</title>
<style>
  @page { size: A4 landscape; margin: 1cm; }
  body { font-family: 'Noto Sans TC', sans-serif; font-size: 10pt; }
  h2 { text-align:center; margin-bottom:4px; font-size:14pt; }
  p.sem { text-align:center; font-size:9pt; color:#555; margin:0 0 8px; }
  table { width:100%; border-collapse:collapse; }
  th, td { border:1px solid #999; padding:4px 6px; text-align:center; vertical-align:middle; }
  th { background:#e8e8e8; font-weight:600; }
  .td-period { background:#f5f5f5; width:4rem; }
  .period-num { font-weight:600; font-size:9pt; }
  .period-time { font-size:7.5pt; color:#555; }
  .cell-subject { font-weight:500; }
  .cell-link { font-size:8.5pt; color:#444; }
  .td-empty { background:#fafafa; }
  .td-cell.cell-locked { background-color: #fff3f3; }
  .td-cell.cell-locked-p8 { background-color: #f3e8ff; }
  .lock-tag {
      display: inline-block;
      background-color: #e63946;
      color: #ffffff;
      font-size: 0.7rem;
      padding: 1px 4px;
      border-radius: 3px;
      margin-left: 3px;
      font-weight: bold;
  }
  .lock-tag-p8 {
      background-color: #7e22ce;
  }
  tr.tr-break { background-color: #f8f9fa; }
  .td-break-content { text-align: center; color: #666; font-size: 9pt; background-color: #f0f0f0; }
</style>
</head><body>
<h2>${escText(title)}</h2>
<p class="sem">${escText(semLabel)}</p>
${tableHTML}
<script>window.onload=()=>{window.print();window.close();}<\/script>
</body></html>`);
    win.document.close();
}

/* ═══════════════════════════════════════════════════════════
    初始化與全域事件監聽
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    initDomReferences();
    initViewCounter(); // 網頁初始化時讀取雲端瀏覽人數

    const schoolName = (typeof CONFIG !== 'undefined' && CONFIG.SCHOOL_NAME) ? CONFIG.SCHOOL_NAME : '民雄國中';
    document.title = `${schoolName} 課表查詢`;

    populateSemesterSelect();
    setupGradeSelects();
    updateBackBtn();
    showView('loginView');

    // 綁定登入表單事件
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const errEl   = document.getElementById('loginError');
            const btn     = document.getElementById('loginBtn');
            const spinner = document.getElementById('loginSpinner');
            const semSelect = document.getElementById('semesterSelect');

            if (errEl) errEl.textContent = '';

            let semLabel = '';
            if (semSelect && semSelect.options && semSelect.options.length > 0) {
                semLabel = semSelect.value;
            } else if (typeof CONFIG !== 'undefined' && CONFIG.SEMESTERS) {
                semLabel = Object.keys(CONFIG.SEMESTERS)[0] || '';
            }

            if (!semLabel) {
                if (errEl) errEl.textContent = '請先選擇學期或確認 config.js 設定';
                return;
            }

            if (btn) btn.disabled = true;
            if (spinner) spinner.classList.add('show');

            try {
                await fetchAndParseCSV(semLabel);
            } catch (err) {
                if (errEl) errEl.textContent = '載入失敗，請確認課表檔案是否存在。';
            } finally {
                if (btn) btn.disabled = false;
                if (spinner) spinner.classList.remove('show');
            }
        });
    }

    // 全域監聽 Modal 點擊關閉事件
    const modal = document.getElementById('subModal');
    if (modal) {
        modal.addEventListener('click', closeSubModal);
    }
});

// 開啟獨立圖片新視窗
function openImageWindow(imgUrl) {
    const width = 900;
    const height = 700;
    
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    
    window.open(
        imgUrl, 
        'P8ImageWindow', 
        `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no`
    );
}