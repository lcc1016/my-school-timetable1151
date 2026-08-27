/**
 * ============================================================
 *  課表查詢系統 - 應用程式邏輯 (app.js)
 *  嘉義國中 國中部
 * ============================================================
 */

/* ── 全域狀態 ─────────────────────────────────────────────── */
let scheduleData    = [];   // CSV 全部資料
let homeroomData    = {};   // 導師資料 JSON
let isLoggedIn      = false;
let navHistory      = [];   // 導航歷史 [{type, value}]
let classGroups     = {};   // 班級分類
let subjectTeachers = {};   // 科目→教師

const PERIODS_ALL   = [0,1,2,3,4,5,6,7,8];  // 0=早自習, 1~8=第1~8節
const DAYS          = ['一','二','三','四','五'];

/* ── DOM 參考 ─────────────────────────────────────────────── */
const loginView    = document.getElementById('loginView');
const queryView    = document.getElementById('queryView');
const resultView   = document.getElementById('resultView');
const loadingOverlay = document.getElementById('loadingOverlay');
const scheduleTitle  = document.getElementById('scheduleTitle');
const scheduleTableContainer = document.getElementById('scheduleTableContainer');

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
    navHistory   = [];
    const errEl  = document.getElementById('loginError');
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
    navHistory.pop();                               // 移除目前頁
    const prev = navHistory[navHistory.length - 1];
    navHistory.pop();                               // 移除上一頁（displayX 會再 push）
    if (prev.type === 'class')   displayClassSchedule(prev.value);
    else                         displayTeacherSchedule(prev.value);
}

function updateBackBtn() {
    const btn = document.getElementById('backBtn');
    if (!btn) return;
    btn.style.visibility = navHistory.length > 1 ? 'visible' : 'hidden';
}

/* ═══════════════════════════════════════════════════════════
   學期下拉選單初始化
═══════════════════════════════════════════════════════════ */
function populateSemesterSelect() {
    const sel = document.getElementById('semesterSelect');
    if (!sel || !CONFIG || !CONFIG.SEMESTERS) return;
    const keys = Object.keys(CONFIG.SEMESTERS);
    sel.innerHTML = '';
    keys.forEach((label, i) => {
        const opt = document.createElement('option');
        opt.value       = label;
        opt.textContent = label;
        if (i === keys.length - 1) opt.selected = true;
        sel.appendChild(opt);
    });
}

/* ═══════════════════════════════════════════════════════════
   登入查詢 (簡化版：無須帳號密碼，直接讀取)
═══════════════════════════════════════════════════════════ */
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const errEl   = document.getElementById('loginError');
    const btn     = document.getElementById('loginBtn');
    const spinner = document.getElementById('loginSpinner');
    const semSelect = document.getElementById('semesterSelect');

    if (errEl) errEl.textContent = '';

    // 安全取得選取的學期（如果選單還沒載入，自動抓 CONFIG 裡的第一個 key）
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

/* ═══════════════════════════════════════════════════════════
   CSV 載入與解析
═══════════════════════════════════════════════════════════ */
async function fetchAndParseCSV(semLabel) {
    if (loadingOverlay) loadingOverlay.classList.add('show');

    let csvUrl = './teacher_timetable_matrix.csv';
    if (CONFIG && CONFIG.SEMESTERS && semLabel && CONFIG.SEMESTERS[semLabel]) {
        const semObj = CONFIG.SEMESTERS[semLabel];
        csvUrl = typeof semObj === 'string' ? semObj : (semObj.csv || csvUrl);
    }

    try {
        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error(`HTTP 錯誤 ${response.status}`);
        const csvText = await response.text();

        // 取得對應的 homerooms.json
        let jsonUrl = csvUrl.replace('teacher_timetable_matrix', 'homerooms_11402')
                            .replace('timetable_', 'homerooms_')
                            .replace('.csv', '.json');
        
        if (CONFIG && CONFIG.SEMESTERS && CONFIG.SEMESTERS[semLabel] && CONFIG.SEMESTERS[semLabel].homerooms) {
            jsonUrl = CONFIG.SEMESTERS[semLabel].homerooms;
        }

        try {
            const hmRes = await fetch(jsonUrl);
            if (hmRes.ok) homeroomData = await hmRes.json();
            else homeroomData = {};
        } catch (e) { homeroomData = {}; }

        const parsed  = parseCSV(csvText);
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
        document.getElementById('loginError').textContent =
            `載入失敗：${err.message}。請確認 CSV/JSON 檔案路徑。`;
    }
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
    const lines   = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    const headers = splitCSVLine(lines[0]);
    return lines.slice(1).map(line => {
        const vals = splitCSVLine(line);
        const obj  = {};
        headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim());
        return obj;
    }).filter(r => r.teachername);
}

/* ═══════════════════════════════════════════════════════════
   建立分類資料
═══════════════════════════════════════════════════════════ */
function buildCategories() {
    // ── 班級分類 ──
    const allClasses = new Set();
    const PERIODS = [0,1,2,3,4,5,6,7,8,9];  // 0=早自習
    
    scheduleData.forEach(row => {
        for (let d = 1; d <= 5; d++) {
            for (let p of PERIODS) {
                const classStr = row[`c${d}${p}`];
                if (classStr) {
                    // 相容空格與斜線分割的班級
                    classStr.split(/[\s/]+/).forEach(cls => {
                        cls = cls.trim();
                        if (cls) allClasses.add(cls);
                    });
                }
            }
        }
    });

    // 亦加入 homeroomData 中的班級（防漏掉無課班級）
    if (homeroomData) {
        Object.keys(homeroomData).forEach(cls => {
            if (cls && cls.trim()) allClasses.add(cls.trim());
        });
    }

    classGroups = { '七年級': [], '八年級': [], '九年級': [], '特殊班': [] };
    
    [...allClasses].sort().forEach(cls => {
        const firstChar = cls.charAt(0);
        // 只要是 7、8、9 開頭（如 701, 810, 912 或 七年1班）皆歸入對應年級
        if (firstChar === '7' || cls.startsWith('七')) {
            classGroups['七年級'].push(cls);
        } else if (firstChar === '8' || cls.startsWith('八')) {
            classGroups['八年級'].push(cls);
        } else if (firstChar === '9' || cls.startsWith('九')) {
            classGroups['九年級'].push(cls);
        } else {
            classGroups['特殊班'].push(cls);
        }
    });

    // 排序班級
    ['七年級','八年級','九年級'].forEach(g => {
        classGroups[g].sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.replace(/\D/g, '')) || 0;
            return numA - numB;
        });
    });
    classGroups['特殊班'].sort();

    // ── 科目→教師分類 ──
    subjectTeachers = {};
    scheduleData.forEach(row => {
        for (let d = 1; d <= 5; d++) {
            for (let p of PERIODS_ALL) {
                const subj = row[`s${d}${p}`];
                if (!subj) continue;
                // 若有斜線多科目則拆開
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
    document.getElementById('tabClass').classList.toggle('active', tab === 'class');
    document.getElementById('tabTeacher').classList.toggle('active', tab === 'teacher');
    document.getElementById('panelClass').classList.toggle('hidden', tab !== 'class');
    document.getElementById('panelTeacher').classList.toggle('hidden', tab !== 'teacher');
}

/* ═══════════════════════════════════════════════════════════
   班級查詢
═══════════════════════════════════════════════════════════ */
function setupGradeSelects() {
    const gradeMap = {
        sel7:  ['sel8','sel9','selSp'],
        sel8:  ['sel7','sel9','selSp'],
        sel9:  ['sel7','sel8','selSp'],
        selSp: ['sel7','sel8','sel9']
    };
    Object.entries(gradeMap).forEach(([id, others]) => {
        const el = document.getElementById(id);
        if (!el) return;
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
    ['sel7','sel8','sel9','selSp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const ce = document.getElementById('classError');
    if (ce) ce.textContent = '';
    const te = document.getElementById('teacherError');
    if (te) te.textContent = '';
}

function submitClassQuery() {
    const cls = ['sel7','sel8','sel9','selSp']
        .map(id => document.getElementById(id)?.value)
        .find(v => v);
    if (!cls) {
        document.getElementById('classError').textContent = '請先選擇一個班級';
        return;
    }
    navHistory = [];
    displayClassSchedule(cls);
}

/* ═══════════════════════════════════════════════════════════
   教師查詢
═══════════════════════════════════════════════════════════ */
function onSubjectChange() {
    const subj = document.getElementById('subjectSelect').value;
    const teacherSel = document.getElementById('teacherSelect');
    teacherSel.innerHTML = '<option value="">— 選擇教師 —</option>';
    if (!subj) return;
    (subjectTeachers[subj] || []).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        teacherSel.appendChild(opt);
    });
    document.getElementById('teacherError').textContent = '';
}

function submitTeacherQuery() {
    const teacher = document.getElementById('teacherSelect').value;
    if (!teacher) {
        document.getElementById('teacherError').textContent = '請先選擇科目與教師';
        return;
    }
    navHistory = [];
    displayTeacherSchedule(teacher);
}

/* ═══════════════════════════════════════════════════════════
   顯示課表
═══════════════════════════════════════════════════════════ */
function displayClassSchedule(className) {
    pushNav('class', className);
    const cells = {};
    scheduleData.forEach(row => {
        for (let d = 1; d <= 5; d++) {
            for (let p of PERIODS_ALL) {
                const classRaw = row[`c${d}${p}`] || '';
                const classes = classRaw.split(/[\s/]+/); // 切分空格或斜線
                
                if (classes.includes(className) && row[`s${d}${p}`]) {
                    const key = `${d}-${p}`;
                    if (!cells[key]) {
                        cells[key] = { subject: row[`s${d}${p}`], items: [row.teachername] };
                    } else {
                        if (!cells[key].items.includes(row.teachername)) {
                            cells[key].items.push(row.teachername);
                        }
                    }
                }
            }
        }
    });
    
    const hmTeacher = homeroomData[className] || '';
    const hmHtml = hmTeacher ? `<span style="font-size: 1.1rem; color: var(--text-dim); margin-left: 0.5rem; font-weight: 500;">(導師：${escHtml(hmTeacher)})</span>` : '';
    
    scheduleTitle.innerHTML = `${className} 班課表 ${hmHtml}`;
    scheduleTableContainer.innerHTML = buildScheduleTable(cells, 'class');
    showView('resultView');
    updateBackBtn();
}

function displayTeacherSchedule(teacherName) {
    pushNav('teacher', teacherName);
    const row   = scheduleData.find(r => r.teachername === teacherName);
    const cells = {};
    if (row) {
        for (let d = 1; d <= 5; d++) {
            for (let p of PERIODS_ALL) {
                if (row[`s${d}${p}`]) {
                    const key = `${d}-${p}`;
                    const classRaw = row[`c${d}${p}`] || '';
                    const classes = classRaw.split(/[\s/]+/).filter(x => x);
                    cells[key] = { subject: row[`s${d}${p}`], items: classes };
                }
            }
        }
    }
    scheduleTitle.textContent = `${teacherName} 老師課表`;
    scheduleTableContainer.innerHTML = buildScheduleTable(cells, 'teacher');
    showView('resultView');
    updateBackBtn();
}

/* ═══════════════════════════════════════════════════════════
   建構課表 HTML
═══════════════════════════════════════════════════════════ */
function buildScheduleTable(cells, mode) {
    const periods   = (CONFIG && CONFIG.PERIOD_TIMES) || [];
    const hasEarly  = Object.keys(cells).some(k => k.endsWith('-0'));

    let html = '<table class="schedule-table"><thead><tr>';
    html += '<th class="th-period">節次</th>';
    DAYS.forEach(d => html += `<th>${d}</th>`);
    html += '</tr></thead><tbody>';

    // 早自習列
    if (hasEarly) {
        const et = periods[0] || { start: '07:40', end: '08:10' };
        html += `<tr><td class="td-period">
            <div class="period-num">早自習</div>
            <div class="period-time">${et.start}<br>${et.end}</div>
        </td>`;
        for (let d = 1; d <= 5; d++) {
            html += renderCell(cells[`${d}-0`], mode);
        }
        html += '</tr>';
    }

    // 第1~8節
    for (let p = 1; p <= 8; p++) {
        const pt = periods[p] || { start: '', end: '' };
        html += `<tr><td class="td-period"><div class="period-num">第${p}節</div>`;
        if (pt.start && pt.start !== '——') {
            html += `<div class="period-time">${pt.start}<br>${pt.end}</div>`;
        }
        html += '</td>';
        for (let d = 1; d <= 5; d++) {
            html += renderCell(cells[`${d}-${p}`], mode);
        }
        html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
}

function renderCell(cell, mode) {
    if (!cell) return '<td class="td-empty"></td>';
    
    const itemsHtml = (cell.items || []).map(item => {
        if (mode === 'class') {
            return `<div class="cell-link" onclick="displayTeacherSchedule('${escHtml(item)}')">${item}</div>`;
        } else {
            return `<div class="cell-link" onclick="displayClassSchedule('${escHtml(item)}')">${item}</div>`;
        }
    }).join(' ');

    return `<td class="td-cell">
        <div class="cell-subject">${cell.subject}</div>
        <div class="cell-items-container">${itemsHtml}</div>
    </td>`;
}

function escHtml(str) {
    return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/* ═══════════════════════════════════════════════════════════
   列印
═══════════════════════════════════════════════════════════ */
function printSchedule() {
    const title     = scheduleTitle.textContent;
    const tableHTML = scheduleTableContainer.innerHTML;
    const semLabel  = document.getElementById('currentSemester')?.textContent || '';

    const win = window.open('', '_blank', 'width=1100,height=750');
    win.document.write(`<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="UTF-8">
<title>${title}</title>
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
</style>
</head><body>
<h2>${title}</h2>
<p class="sem">${semLabel}</p>
${tableHTML}
<script>window.onload=()=>{window.print();window.close();}<\/script>
</body></html>`);
    win.document.close();
}

/* ═══════════════════════════════════════════════════════════
   初始化
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    populateSemesterSelect();
    setupGradeSelects();
    updateBackBtn();
    showView('loginView');
});