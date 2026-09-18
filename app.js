/** // 程式碼檔案標頭區塊註解開始
 * ============================================================ // 標頭分隔線
 *  課表查詢系統 - 應用程式邏輯 (app.js) // 檔案名稱與系統名稱
 *  民雄國中 // 學校名稱
 * ============================================================ // 標頭分隔線
 */ // 標頭區塊註解結束

/* ── 全域設定 ─────────────────────────────────────────────── */ // 區塊標題：全域設定
// 請替換成你部署好的 Google Apps Script 網址 // 說明文字：提示替換後端網址
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyymH4_8hdi1SmccV6-m8hMsVJhkdEHDBtci9kluH_gb-37ERTX-JL4OOE_z7od6fSgUw/exec"; // 定義 Google Apps Script API 部署網址常數

/* ── 全域狀態 ─────────────────────────────────────────────── */ // 區塊標題：全域狀態變數
let scheduleData          = [];   // 儲存解析後的 CSV 全部課表資料陣列
let homeroomData          = {};   // 儲存各班導師資料的 JSON 物件
let lockedData            = {};   // 儲存 1~7 節課綁課規則資料的 JSON 物件
let lockedDataP8          = {};   // 儲存第 8 節獨立綁課規則資料的 JSON 物件
let isLoggedIn            = false; // 紀錄使用者是否已成功登入系統的布林值
let navHistory            = [];   // 儲存頁面導航歷史紀錄的陣列 [{type, value}]
let classGroups           = {};   // 儲存班級分類（七年級、八年級等）的物件
let subjectTeachers       = {};   // 儲存科目對應教師清單 Mapping 的物件
let currentDisplayedClass = '';   // 紀錄目前畫面上顯示的班級名稱

const PERIODS_ALL   = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // 定義所有節次陣列 (0=早自習, 1~8=第1~8節)
const DAYS          = ['一', '二', '三', '四', '五']; // 定義星期名稱陣列

/* ── DOM 參考 ─────────────────────────────────────────────── */ // 區塊標題：DOM 元素參考變數
let loginView, queryView, resultView, loadingOverlay, scheduleTitle, scheduleTableContainer; // 宣告 DOM 元素全域變數

function initDomReferences() { // 初始化取得 DOM 元素參考的函式
    loginView = document.getElementById('loginView'); // 取得登入視圖容器元素
    queryView = document.getElementById('queryView'); // 取得查詢視圖容器元素
    resultView = document.getElementById('resultView'); // 取得結果視圖容器元素
    loadingOverlay = document.getElementById('loadingOverlay'); // 取得 Loading 遮罩元素
    scheduleTitle = document.getElementById('scheduleTitle'); // 取得課表標題文字元素
    scheduleTableContainer = document.getElementById('scheduleTableContainer'); // 取得課表表格容器元素
} // initDomReferences 函式結束

/* ═══════════════════════════════════════════════════════════
    瀏覽統計計數器 (串接 Google Apps Script 後端)
═══════════════════════════════════════════════════════════ */ // 區塊標題：瀏覽統計計數器相關邏輯

/** // JSDoc 註解開始
 * 初始化計數器：網頁載入時向 GAS 請求「當月」與「總累計」人數 // 函式功能說明
 */ // JSDoc 註解結束
async function initViewCounter() { // 異步函式：初始化並讀取雲端瀏覽人數
    if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.includes("YOUR_DEPLOYMENT_ID")) return; // 若未設定有效 GAS 網址則直接結束

    try { // 開始嘗試向後端發送請求
        const response = await fetch(`${GAS_WEB_APP_URL}?action=getCounter`); // 向 GAS API 發送讀取計數器的 GET 請求
        if (!response.ok) throw new Error(`HTTP 錯誤 ${response.status}`); // 檢查 HTTP 回應狀態，若失敗則拋出例外
        
        const data = await response.json(); // 將 API 回傳內容解析為 JSON 物件
        console.log("GAS 回傳資料 (init):", data); // 在主控台輸出初始化讀取的數據

        // 相容性處理：同時支援新版 {month, total} 與舊版 {count} // 說明文字：處理資料格式相容
        const monthVal = (data && data.month !== undefined) ? data.month : 0; // 取得當月瀏覽次數，若無則設為 0
        const totalVal = (data && data.total !== undefined) ? data.total : (data ? (data.count || 0) : 0); // 取得總累計瀏覽次數，若無則降級處理

        updateCounterDisplay(monthVal, totalVal); // 呼叫 DOM 更新函式，更新畫面顯示數字
    } catch (err) { // 捕獲請求或解析過程中的錯誤
        console.error('讀取雲端計數器失敗:', err); // 在主控台輸出錯誤訊息
    } // try-catch 結束
} // initViewCounter 函式結束

/** // JSDoc 註解開始
 * 累加計數器：執行查詢時呼叫，讓 GAS 後端的當月與總計數同時 +1 // 函式功能說明
 */ // JSDoc 註解結束
async function incrementViewCounter() { // 異步函式：觸發雲端計數器累加 +1
    if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.includes("YOUR_DEPLOYMENT_ID")) return; // 若未設定有效 GAS 網址則直接結束

    try { // 開始嘗試向後端發送請求
        const response = await fetch(`${GAS_WEB_APP_URL}?action=increment`); // 向 GAS API 發送計數器 +1 的 GET 請求
        if (!response.ok) throw new Error(`HTTP 錯誤 ${response.status}`); // 檢查 HTTP 回應狀態，若失敗則拋出例外
        
        const data = await response.json(); // 將 API 回傳內容解析為 JSON 物件
        console.log("GAS 回傳資料 (increment):", data); // 在主控台輸出累加後的數據

        // 相容性處理：同時支援新版 {month, total} 與舊版 {count} // 說明文字：處理資料格式相容
        const monthVal = (data && data.month !== undefined) ? data.month : 0; // 取得更新後的當月瀏覽次數
        const totalVal = (data && data.total !== undefined) ? data.total : (data ? (data.count || 0) : 0); // 取得更新後的總累計瀏覽次數

        updateCounterDisplay(monthVal, totalVal); // 呼叫 DOM 更新函式，同步更新畫面數字
    } catch (err) { // 捕獲請求或解析過程中的錯誤
        console.error('更新雲端計數器失敗:', err); // 在主控台輸出錯誤訊息
    } // try-catch 結束
} // incrementViewCounter 函式結束

/** // JSDoc 註解開始
 * 更新 HTML 畫面上所有計數器位置的數字 // 函式功能說明
 */ // JSDoc 註解結束
function updateCounterDisplay(monthTotal, overallTotal) { // 函式：將數據渲染至 HTML DOM 節點
    // 1. 更新當月瀏覽 (對應 ID: monthViews 或 class: month-visitor-count) // 步驟說明 1
    const monthEls = document.querySelectorAll('#monthViews, .month-visitor-count'); // 尋找所有顯示當月人數的 DOM 元素
    monthEls.forEach(el => { // 尋訪每個當月人數 DOM 元素
        if (el) el.textContent = Number(monthTotal || 0).toLocaleString(); // 格式化數字為千分位格式並寫入文字
    }); // 尋訪結束

    // 2. 更新總累計瀏覽 (對應 ID: totalViews, visitorCount 或 class: total-visitor-count) // 步驟說明 2
    const totalEls = document.querySelectorAll('#totalViews, #visitorCount, .total-visitor-count'); // 尋找所有顯示總累計人數的 DOM 元素
    totalEls.forEach(el => { // 尋訪每個總人數 DOM 元素
        if (el) el.textContent = Number(overallTotal || 0).toLocaleString(); // 格式化數字為千分位格式並寫入文字
    }); // 尋訪結束
} // updateCounterDisplay 函式結束

/* ═══════════════════════════════════════════════════════════
    視圖切換
═══════════════════════════════════════════════════════════ */ // 區塊標題：頁面視圖 (View) 切換邏輯
function showView(viewId) { // 函式：顯示指定的視圖並隱藏其他視圖
    [loginView, queryView, resultView].forEach(v => { // 尋訪三個主要視圖容器
        if (v) { // 若視圖 DOM 存在
            v.classList.remove('active', 'result-active'); // 移除活躍的 CSS class
            v.style.display = 'none'; // 將顯示樣式設為隱藏 (none)
        } // if 結束
    }); // 尋訪結束
    const target = document.getElementById(viewId); // 依傳入的 ID 取得目標視圖 DOM 元素
    if (!target) return; // 若目標 DOM 不存在則中止執行
    if (viewId === 'resultView') { // 若目標為課表結果視圖
        target.classList.add('result-active'); // 加上結果頁特有的 active class
        target.style.display = 'block'; // 顯示方式設為 block
    } else { // 若為其他視圖 (登入或查詢)
        target.classList.add('active'); // 加上一般 active class
        target.style.display = 'flex'; // 顯示方式設為 flex (彈性佈局)
    } // if-else 結束
    window.scrollTo({ top: 0, behavior: 'smooth' }); // 將視窗平滑滾動回頂部
} // showView 函式結束

function showQueryView() { // 函式：返回查詢主頁面
    navHistory = []; // 清空導航歷史紀錄
    resetGradeSelects(); // 重設所有班級下拉選單
    showView('queryView'); // 切換顯示查詢視圖
} // showQueryView 函式結束

function logout() { // 函式：執行使用者登出
    isLoggedIn   = false; // 重設登入狀態為 false
    scheduleData = []; // 清空課表資料
    homeroomData = {}; // 清空導師資料
    lockedData   = {}; // 清空綁課資料
    lockedDataP8 = {}; // 清空第8節綁課資料
    navHistory   = []; // 清空導航歷史紀錄
    const errEl   = document.getElementById('loginError'); // 取得登入錯誤訊息 DOM
    if (errEl) errEl.textContent = ''; // 清空錯誤訊息文字
    showView('loginView'); // 切換顯示登入視圖
} // logout 函式結束

/* ═══════════════════════════════════════════════════════════
    導航歷史（返回上一頁）
═══════════════════════════════════════════════════════════ */ // 區塊標題：頁面導航歷史管理
function pushNav(type, value) { // 函式：推入一筆導航紀錄
    navHistory.push({ type, value }); // 將型態與值推入歷史紀錄陣列
    updateBackBtn(); // 更新返回按鈕的顯示狀態
} // pushNav 函式結束

function goBack() { // 函式：返回上一個查詢頁面
    if (navHistory.length <= 1) { // 若歷史紀錄只剩一筆或更少
        showQueryView(); // 直接返回查詢主頁面
        return; // 結束執行
    } // if 結束
    navHistory.pop(); // 彈出當前頁面的歷史紀錄
    const prev = navHistory[navHistory.length - 1]; // 取得前一個頁面的紀錄資訊
    navHistory.pop(); // 彈出前頁紀錄 (因為展示函式會重新 pushNav)
    if (prev.type === 'class') displayClassSchedule(prev.value); // 若前頁為班級，則渲染班級課表
    else displayTeacherSchedule(prev.value); // 若前頁為教師，則渲染教師課表
} // goBack 函式結束

function updateBackBtn() { // 函式：控制「返回上一頁」按鈕顯隱
    const btn = document.getElementById('backBtn'); // 取得返回按鈕 DOM
    if (!btn) return; // 若按鈕不存在則結束
    btn.style.visibility = navHistory.length > 1 ? 'visible' : 'hidden'; // 當歷史紀錄大於 1 時顯示按鈕，否則隱藏
} // updateBackBtn 函式結束

/* ═══════════════════════════════════════════════════════════
    上一班 / 下一班 快速切換邏輯
═══════════════════════════════════════════════════════════ */ // 區塊標題：班級快速切換邏輯

/** // JSDoc 註解開始
 * 根據班級名稱，取得該班在同年級（或特殊班）清單中的索引與整個陣列 // 函式功能說明
 */ // JSDoc 註解結束
function getClassNavigationInfo(className) { // 函式：計算班級切換資訊
    if (!className) return { list: [], index: -1 }; // 若未輸入班級名稱，回傳預設空值
    
    let targetGroup = null; // 宣告目標班級群組變數
    for (const groupName in classGroups) { // 尋訪所有班級分類群組
        if (classGroups[groupName].includes(className)) { // 若該群組包含當前班級
            targetGroup = classGroups[groupName]; // 記錄該班級群組陣列
            break; // 跳出迴圈
        } // if 結束
    } // for-in 結束

    if (!targetGroup) return { list: [], index: -1 }; // 若找不到所屬群組，回傳預設空值

    const index = targetGroup.indexOf(className); // 取得當前班級在群組陣列中的索引位置
    return { list: targetGroup, index }; // 回傳群組陣列與索引位置
} // getClassNavigationInfo 函式結束

/** // JSDoc 註解開始
 * 切換至上一班 (-1) 或 下一班 (+1) // 函式功能說明
 */ // JSDoc 註解結束
function navigateClass(direction) { // 函式：執行上一班/下一班切換
    if (!currentDisplayedClass) return; // 若當前無顯示班級，直接結束

    const { list, index } = getClassNavigationInfo(currentDisplayedClass); // 取得當前班級導航資訊
    if (index === -1) return; // 若索引無效，直接結束

    const newIndex = index + direction; // 計算切換後的新索引 (-1 或 +1)
    if (newIndex >= 0 && newIndex < list.length) { // 確保新索引在合法範圍內
        const targetClass = list[newIndex]; // 取得目標班級名稱
        
        // 替換歷史紀錄最後一筆，避免按返回鍵時卡在快速切換的歷史中 // 說明文字
        if (navHistory.length > 0) { // 若導航歷史不為空
            navHistory[navHistory.length - 1] = { type: 'class', value: targetClass }; // 覆寫最後一筆歷史紀錄
        } // if 結束
        
        displayClassSchedule(targetClass); // 渲染並顯示目標班級課表
    } // if 結束
} // navigateClass 函式結束

/** // JSDoc 註解開始
 * 控制【上一班 / 下一班】按鈕的顯示與停用狀態 // 函式功能說明
 */ // JSDoc 註解結束
function updateClassNavButtons(className) { // 函式：更新切換按鈕 UI 狀態
    const prevBtn = document.getElementById('prevClassBtn'); // 取得上一班按鈕 DOM
    const nextBtn = document.getElementById('nextClassBtn'); // 取得下一班按鈕 DOM
    if (!prevBtn || !nextBtn) return; // 若按鈕 DOM 不存在則結束

    const { list, index } = getClassNavigationInfo(className); // 取得班級導航資訊

    if (index === -1 || list.length <= 1) { // 若非合法班級或該群組只有 1 個班
        prevBtn.style.display = 'none'; // 隱藏上一班按鈕
        nextBtn.style.display = 'none'; // 隱藏下一班按鈕
        return; // 結束執行
    } // if 結束

    // 顯示按鈕 // 說明文字
    prevBtn.style.display = 'inline-block'; // 顯示上一班按鈕
    nextBtn.style.display = 'inline-block'; // 顯示下一班按鈕

    // 若為第 1 班則禁用「上一班」，若為最後一班則禁用「下一班」 // 說明文字
    prevBtn.disabled = (index === 0); // 若為第 0 個班級，停用上一班按鈕
    nextBtn.disabled = (index === list.length - 1); // 若為最後一個班級，停用下一班按鈕
} // updateClassNavButtons 函式結束

/* ═══════════════════════════════════════════════════════════
    學期下拉選單初始化
═══════════════════════════════════════════════════════════ */ // 區塊標題：學期選單初始化
function populateSemesterSelect() { // 函式：填入學期下拉選單選項
    const sel = document.getElementById('semesterSelect'); // 取得學期下拉選單 DOM
    if (!sel || typeof CONFIG === 'undefined' || !CONFIG.SEMESTERS) return; // 檢查 DOM 與 CONFIG 設定檔是否存在
    
    sel.innerHTML = ''; // 清空下拉選單預設內容
    const keys = Object.keys(CONFIG.SEMESTERS); // 取得 CONFIG 中定義的所有學期標籤 Key

    keys.forEach((label, i) => { // 尋訪每一個學期標籤
        const opt = document.createElement('option'); // 建立 option 元素
        opt.value       = label; // 設定 option 的 value 為學期標籤
        opt.textContent = label; // 設定 option 顯示文字為學期標籤
        if (i === keys.length - 1) opt.selected = true; // 預設選取最後一個 (最新) 學期
        sel.appendChild(opt); // 將 option 加入選單中
    }); // 尋訪結束
} // populateSemesterSelect 函式結束

/* ═══════════════════════════════════════════════════════════
    CSV 與 JSON 載入與解析
═══════════════════════════════════════════════════════════ */ // 區塊標題：資料載入與解析邏輯
async function fetchAndParseCSV(semLabel) { // 異步函式：載入指定學期的 CSV 與 JSON 檔案
    if (loadingOverlay) loadingOverlay.classList.add('show'); // 顯示全螢幕 Loading 遮罩

    let csvUrl = './teacher_11501.csv'; // 預設 CSV 檔案路徑
    let jsonUrl = './homerooms_11501.json'; // 預設導師 JSON 檔案路徑

    if (typeof CONFIG !== 'undefined' && CONFIG.SEMESTERS && semLabel && CONFIG.SEMESTERS[semLabel]) { // 檢查 CONFIG 是否設定該學期路徑
        const semObj = CONFIG.SEMESTERS[semLabel]; // 取得該學期的設定物件
        if (typeof semObj === 'string') { // 若設定值直接為字串 (舊格式)
            csvUrl = semObj; // 將字串賦值給 csvUrl
        } else if (typeof semObj === 'object') { // 若設定值為物件 (新格式)
            csvUrl = semObj.csv || csvUrl; // 取得 csv 路徑
            jsonUrl = semObj.homerooms || jsonUrl; // 取得 homerooms 路徑
        } // if-else 結束
    } // if 結束

    try { // 開始發送 HTTP 請求讀取檔案
        const response = await fetch(csvUrl); // 獲取 CSV 課表檔案
        if (!response.ok) throw new Error(`HTTP 錯誤 ${response.status}`); // 檢查回應狀態，若失敗則拋錯
        
        const buffer = await response.arrayBuffer(); // 將回應轉為 ArrayBuffer
        const decoder = new TextDecoder('utf-8'); // 建立 UTF-8 文字解碼器
        let csvText = decoder.decode(buffer); // 將 Buffer 解碼為純文字字串
        if (csvText.charCodeAt(0) === 0xFEFF) { // 檢查並去除 UTF-8 BOM 檔頭標頭
            csvText = csvText.slice(1); // 截去第一個 BOM 字元
        } // if 結束

        try { // 嘗試讀取導師 JSON
            const hmRes = await fetch(jsonUrl); // 獲取導師對應檔
            if (hmRes.ok) homeroomData = await hmRes.json(); // 若成功則解析 JSON 並寫入 homeroomData
            else homeroomData = {}; // 否則設為空物件
        } catch (e) { homeroomData = {}; } // 若讀取失敗設為空物件

        // 載入 1~7 節綁課資料 // 說明文字
        let lockUrl = (typeof CONFIG !== 'undefined' && CONFIG.LOCKED_COURSES_URL) ? CONFIG.LOCKED_COURSES_URL : './locked_courses.json'; // 決定綁課檔路徑
        try { // 嘗試讀取綁課 JSON
            const lockRes = await fetch(lockUrl); // 獲取綁課檔案
            if (lockRes.ok) lockedData = await lockRes.json(); // 解析 JSON 並寫入 lockedData
            else lockedData = {}; // 否則設為空物件
        } catch (e) { lockedData = {}; } // 若失敗設為空物件

        // 載入第 8 節獨立綁課資料 // 說明文字
        let lockP8Url = (typeof CONFIG !== 'undefined' && CONFIG.LOCKED_COURSES_P8_URL) ? CONFIG.LOCKED_COURSES_P8_URL : './8locked_courses.json'; // 決定第8節綁課檔路徑
        try { // 嘗試讀取第8節綁課 JSON
            const lockP8Res = await fetch(lockP8Url); // 獲取第8節綁課檔案
            if (lockP8Res.ok) lockedDataP8 = await lockP8Res.json(); // 解析 JSON 並寫入 lockedDataP8
            else lockedDataP8 = {}; // 否則設為空物件
        } catch (e) { lockedDataP8 = {}; } // 若失敗設為空物件

        const parsed = parseCSV(csvText); // 解析 CSV 文字內容為物件陣列
        if (parsed.length === 0) throw new Error('CSV 資料為空'); // 若解析結果為空則拋錯

        scheduleData = parsed; // 將解析後的資料寫入全域變數 scheduleData
        buildCategories(); // 建立班級分類與科目教師清單
        populateQueryUI(); // 渲染填充查詢選單的選項
        isLoggedIn = true; // 設定登入狀態為已登入

        const badge = document.getElementById('currentSemester'); // 取得當前學期標籤 DOM
        if (badge) badge.textContent = semLabel || ''; // 顯示當前學期名稱

        if (loadingOverlay) loadingOverlay.classList.remove('show'); // 隱藏 Loading 遮罩
        showView('queryView'); // 自動切換至查詢視圖

    } catch (err) { // 捕獲整體載入流程中的錯誤
        if (loadingOverlay) loadingOverlay.classList.remove('show'); // 隱藏 Loading 遮罩
        console.error(err); // 主控台輸出錯誤詳細資訊
        const errEl = document.getElementById('loginError'); // 取得登入錯誤訊息容器 DOM
        if (errEl) errEl.textContent = `載入失敗：${err.message}。請確認 CSV/JSON 檔案路徑。`; // 顯示錯誤訊息給使用者
    } // try-catch 結束
} // fetchAndParseCSV 函式結束

/* ── 輔助函式：判斷是否綁課 (新增支援第8節獨立邏輯) ───────────────────── */ // 區塊標題：綁課邏輯判斷
function isSubjectLocked(className, subjectName, period) { // 函式：判斷指定班級科目在特定節次是否綁課
    if (!className || !subjectName) return false; // 無班級或科目名稱則回傳 false

    // 依據節次選用對應的綁課 JSON 資料源 // 說明文字
    const currentLockData = (period === 8) ? lockedDataP8 : lockedData; // 若節次為 8 選用 lockedDataP8，否則選用 lockedData
    if (!currentLockData) return false; // 若無資料源回傳 false

    const cleanClass = className.trim(); // 清理班級名稱前後空白
    const numClass = className.replace(/\D/g, '');  // 提取班級名稱中的數字部分 (例如: "701班" -> "701")
    const cleanSubj = normalizeSubject(subjectName); // 標準化科目名稱 (去除輔導/加強字眼)

    const rules = currentLockData[numClass] || currentLockData[cleanClass] || currentLockData[className]; // 查找該班級的綁課規則陣列
    if (!rules) return false; // 若該班無綁課規則回傳 false

    return rules.includes('ALL') || rules.includes(cleanSubj) || rules.includes(subjectName.trim()); // 若規則包含 ALL 或該科目名則回傳 true
} // isSubjectLocked 函式結束

/* ── CSV 解析 ─────────────────────────────────────────────── */ // 區塊標題：CSV 字串解析工具
function splitCSVLine(line) { // 函式：切割單行 CSV (正確處理雙引號內的逗號)
    const result = []; // 儲存切割結果的陣列
    let cur = '', inQ = false; // cur 儲存當前字元，inQ 記錄是否在雙引號內部
    for (let i = 0; i < line.length; i++) { // 逐字元檢查該行字串
        const c = line[i]; // 取出當前字元
        if (c === '"') { inQ = !inQ; } // 若遇到雙引號，切換引號內外狀態
        else if (c === ',' && !inQ) { result.push(cur); cur = ''; } // 若遇到引號外的逗號，推入當前字串並重置
        else { cur += c; } // 否則將字元累加至當前字串
    } // for 迴圈結束
    result.push(cur); // 推入最後一個欄位
    return result; // 回傳該行切割出的陣列
} // splitCSVLine 函式結束

function parseCSV(text) { // 函式：將整份 CSV 文字解析成 JavaScript 物件陣列
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim()); // 統一換行符號，按行切割並去除空行
    if (lines.length === 0) return []; // 若無內容回傳空陣列
    const headers = splitCSVLine(lines[0]); // 讀取第一行作為欄位名稱表頭 (Header)
    return lines.slice(1).map(line => { // 尋訪第二行以後的每一行資料
        const vals = splitCSVLine(line); // 切割該行欄位值
        const obj = {}; // 建立資料物件
        headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim()); // 依據表頭組裝 Key-Value 物件
        return obj; // 回傳組裝後的物件
    }).filter(r => r.teachername); // 過濾掉沒有教師姓名的無效資料列
} // parseCSV 函式結束

/* ═══════════════════════════════════════════════════════════
    建立分類資料 (依指定班級數字範圍精確分類)
═══════════════════════════════════════════════════════════ */ // 區塊標題：建立班級分類與科目對照表
function buildCategories() { // 函式：自動建立班級分類與科目教師 Mapping
    const allClasses = new Set(); // 建立 Set 用於儲存不重複的班級名稱
    const PERIODS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // 解析用節次範圍陣列
    
    scheduleData.forEach(row => { // 尋訪每一位教師的課表資料
        for (let d = 1; d <= 5; d++) { // 尋訪星期一至五 (1~5)
            for (let p of PERIODS) { // 尋訪各節次 (0~9)
                const classStr = row[`c${d}${p}`]; // 取得該節次的班級欄位字串 (例如: "c11")
                if (classStr) { // 若該節次有班級資料
                    classStr.split(/[\s/]+/).forEach(cls => { // 切割合班或複數班級字串
                        cls = cls.trim(); // 去除空白
                        if (cls) allClasses.add(cls); // 將班級加入 Set 集合中
                    }); // 切割尋訪結束
                } // if 結束
            } // 節次迴圈結束
        } // 星期迴圈結束
    }); // scheduleData 尋訪結束

    if (homeroomData) { // 若有導師 JSON 資料
        Object.keys(homeroomData).forEach(cls => { // 尋訪導師資料的所有班級 Key
            if (cls && cls.trim()) allClasses.add(cls.trim()); // 將導師資料中的班級也加入 Set
        }); // 尋訪結束
    } // if 結束

    classGroups = { '七年級': [], '八年級': [], '九年級': [], '特殊班': [] }; // 初始化班級分類物件
    
    [...allClasses].forEach(cls => { // 將 Set 轉為陣列並尋訪每一個班級名稱
        // 解析純數字 (例："701" 或 "701班" 都會得到 701) // 說明文字
        const classNum = parseInt(cls.replace(/\D/g, ''), 10); // 提取班級中的數字並轉為整數
        
        if (classNum >= 701 && classNum <= 710) { // 701 ~ 710 歸類為七年級
            classGroups['七年級'].push(cls); // 加入七年級陣列
        } else if (classNum >= 801 && classNum <= 812) { // 801 ~ 812 歸類為八年級
            classGroups['八年級'].push(cls); // 加入八年級陣列
        } else if (classNum >= 901 && classNum <= 912) { // 901 ~ 912 歸類為九年級
            classGroups['九年級'].push(cls); // 加入九年級陣列
        } else { // 其餘範圍 (如: 711、813、特教班、體育班)
            // 未符合以上範圍（例：711、813、特教班、體育班）一律歸入特殊班 / 其他 // 說明文字
            classGroups['特殊班'].push(cls); // 加入特殊班 / 其他陣列
        } // if-else 結束
    }); // 班級尋訪結束

    // 各年級內部按班級數字大小排序 // 說明文字
    ['七年級', '八年級', '九年級', '特殊班'].forEach(g => { // 尋訪四個分類群組
        classGroups[g].sort((a, b) => { // 對該群組內的班級進行排序
            const numA = parseInt(a.replace(/\D/g, '')) || 0; // 提取 A 的班級數字
            const numB = parseInt(b.replace(/\D/g, '')) || 0; // 提取 B 的班級數字
            if (numA !== numB) return numA - numB; // 按數字由小到大排序
            return a.localeCompare(b, 'zh-TW'); // 若無數字或數字相同，按中文字串排序
        }); // sort 結束
    }); // 分類尋訪結束

    subjectTeachers = {}; // 初始化科目對應教師 Mapping 物件
    scheduleData.forEach(row => { // 尋訪每一位教師課表
        for (let d = 1; d <= 5; d++) { // 尋訪星期一至五
            for (let p of PERIODS_ALL) { // 尋訪 0~8 節
                const subj = row[`s${d}${p}`]; // 取得科目欄位 (例如: "s11")
                if (!subj) continue; // 若無科目跳過
                subj.split('/').forEach(s => { // 切割合班或跨科科目
                    const base = normalizeSubject(s); // 將科目名稱去除輔導/加強後標準化
                    if (base) { // 若標準化後有科目名稱
                        if (!subjectTeachers[base]) subjectTeachers[base] = new Set(); // 若該科目尚無 Set 則初始化
                        subjectTeachers[base].add(row.teachername); // 將任課教師加入該科目的 Set 集合
                    } // if 結束
                }); // 切割尋訪結束
            } // 節次迴圈結束
        } // 星期迴圈結束
    }); // scheduleData 尋訪結束
    Object.keys(subjectTeachers).forEach(k => { // 尋訪每個科目 Key
        subjectTeachers[k] = [...subjectTeachers[k]].sort(); // 將教師 Set 轉為陣列並進行筆畫/姓名排序
    }); // 尋訪結束
} // buildCategories 函式結束

function normalizeSubject(subj) { // 輔助函式：去除科目尾綴字眼 (如: 輔導、加強)
    return (subj || '').replace(/輔導$/, '').replace(/加強$/, '').trim(); // 移除字尾「輔導」與「加強」並清除空白
} // normalizeSubject 函式結束

/* ═══════════════════════════════════════════════════════════
    填充查詢 UI
═══════════════════════════════════════════════════════════ */ // 區塊標題：渲染查詢頁面下拉選單 UI
function populateQueryUI() { // 函式：將班級與科目資料填入對應選單
    populateGradeSelect('sel7',  classGroups['七年級']); // 填入七年級班級選單
    populateGradeSelect('sel8',  classGroups['八年級']); // 填入八年級班級選單
    populateGradeSelect('sel9',  classGroups['九年級']); // 填入九年級班級選單
    populateGradeSelect('selSp', classGroups['特殊班']); // 填入特殊班選單

    const subjectSel = document.getElementById('subjectSelect'); // 取得教師查詢的「任教科目」選單 DOM
    if (subjectSel) { // 若選單 DOM 存在
        subjectSel.innerHTML = '<option value="">— 選擇科目 —</option>'; // 重置預設選項

        // 1. 定義要置頂排序的科目清單（請依需求自行調整）
        const topSubjects = ['國語文', '英語文', '本土語文', '數學', '生物', '地理', '歷史', '公民與社會', '理化', '地球科學', '輔導', '家政', '童軍', '生活科技', '資訊科技', '音樂', '視覺藝術', '表演藝術', '體育', '健康教育'];

        // 建立「筆劃排序器」（zh-TW 搭配 stroke 排序法，按第一字筆劃由少至多排序）
        const strokeCollator = new Intl.Collator('zh-TW-u-co-stroke', { numeric: true });

        // 2. 取得所有科目並執行客製化排序
        const sortedSubjects = Object.keys(subjectTeachers).sort((a, b) => {
            const indexA = topSubjects.indexOf(a);
            const indexB = topSubjects.indexOf(b);

            // 情況 A：兩者都在置頂清單中，按置頂清單順序排序
            if (indexA !== -1 && indexB !== -1) {
                return indexA - indexB;
            }
            // 情況 B：a 在置頂清單中，a 往前排
            if (indexA !== -1) {
                return -1;
            }
            // 情況 C：b 在置頂清單中，b 往前排
            if (indexB !== -1) {
                return 1;
            }
            // 情況 D：兩者都不在置頂清單中，按第一個字的「筆劃由少至多」排序
            return strokeCollator.compare(a, b);
        });

        // 3. 將排序後的科目渲染至下拉選單
        sortedSubjects.forEach(s => {
            const opt = document.createElement('option'); // 建立 option 元素
            opt.value = s; 
            opt.textContent = s; // 設定 option 的值與顯示文字為科目名稱
            subjectSel.appendChild(opt); // 將 option 加入科目選單
        });
    } // if 結束
} // populateQueryUI 函式結束
function populateGradeSelect(selId, classes) { // 輔助函式：填入特定年級選單
    const sel = document.getElementById(selId); // 依 ID 取得選單 DOM
    if (!sel) return; // 若不存在直接結束
    sel.innerHTML = '<option value="">— 選擇班級 —</option>'; // 重置預設預設選項
    (classes || []).forEach(cls => { // 尋訪傳入的班級清單陣列
        const opt = document.createElement('option'); // 建立 option 元素
        opt.value = cls; opt.textContent = cls; // 設定 option 的值與文字為班級名稱
        sel.appendChild(opt); // 將 option 加入選單
    }); // 尋訪結束
} // populateGradeSelect 函式結束

/* ═══════════════════════════════════════════════════════════
    Tab 切換
═══════════════════════════════════════════════════════════ */ // 區塊標題：查詢頁 Tab 頁籤切換邏輯
function switchTab(tab) { // 函式：切換「班級查詢」或「教師查詢」 Tab
    const tabClass = document.getElementById('tabClass'); // 取得班級 Tab 按鈕 DOM
    const tabTeacher = document.getElementById('tabTeacher'); // 取得教師 Tab 按鈕 DOM
    const panelClass = document.getElementById('panelClass'); // 取得班級查詢面板 DOM
    const panelTeacher = document.getElementById('panelTeacher'); // 取得教師查詢面板 DOM

    if (tabClass) tabClass.classList.toggle('active', tab === 'class'); // 切換班級按鈕的 active 狀態
    if (tabTeacher) tabTeacher.classList.toggle('active', tab === 'teacher'); // 切換教師按鈕的 active 狀態
    if (panelClass) panelClass.classList.toggle('hidden', tab !== 'class'); // 切換班級面板的 hidden 隱藏狀態
    if (panelTeacher) panelTeacher.classList.toggle('hidden', tab !== 'teacher'); // 切換教師面板的 hidden 隱藏狀態
} // switchTab 函式結束

/* ═══════════════════════════════════════════════════════════
    班級查詢
═══════════════════════════════════════════════════════════ */ // 區塊標題：班級查詢邏輯
function setupGradeSelects() { // 函式：綁定年級選單互斥事件 (選取其中一個時清空其他選單)
    const gradeMap = { // 定義四個選單對應的「其他選單」Mapping 物件
        sel7:  ['sel8', 'sel9', 'selSp'], // 選 7 年級時清空 8, 9, Special
        sel8:  ['sel7', 'sel9', 'selSp'], // 選 8 年級時清空 7, 9, Special
        sel9:  ['sel7', 'sel8', 'selSp'], // 選 9 年級時清空 7, 8, Special
        selSp: ['sel7', 'sel8', 'sel9'] // 選 Special 時清空 7, 8, 9
    }; // gradeMap 物件結束
    Object.entries(gradeMap).forEach(([id, others]) => { // 尋訪每個選單 Mapping
        const el = document.getElementById(id); // 取得選單 DOM
        if (!el || el.dataset.bound) return; // 若 DOM 不存在或已綁定過則跳過
        el.dataset.bound = "true"; // 標記該 DOM 為已綁定監聽
        el.addEventListener('change', () => { // 綁定 change 改變事件
            if (el.value) others.forEach(oid => { // 當該選單選取了值，尋訪其他選單
                const oe = document.getElementById(oid); // 取得其他選單 DOM
                if (oe) oe.value = ''; // 將其他選單重置為空值
            }); // 尋訪結束
            const ce = document.getElementById('classError'); // 取得班級錯誤訊息 DOM
            if (ce) ce.textContent = ''; // 清空錯誤訊息
        }); // 事件監聽結束
    }); // 尋訪結束
} // setupGradeSelects 函式結束

function resetGradeSelects() { // 函式：重置所有班級下拉選單
    ['sel7', 'sel8', 'sel9', 'selSp'].forEach(id => { // 尋訪四個班級選單 ID
        const el = document.getElementById(id); // 取得選單 DOM
        if (el) el.value = ''; // 重置為空值
    }); // 尋訪結束
    const ce = document.getElementById('classError'); // 取得班級錯誤訊息 DOM
    if (ce) ce.textContent = ''; // 清空錯誤訊息
    const te = document.getElementById('teacherError'); // 取得教師錯誤訊息 DOM
    if (te) te.textContent = ''; // 清空錯誤訊息
} // resetGradeSelects 函式結束

function submitClassQuery() { // 函式：觸發班級查詢操作
    const cls = ['sel7', 'sel8', 'sel9', 'selSp'] // 尋訪四個班級選單
        .map(id => document.getElementById(id)?.value) // 取得各選單當前的 selected value
        .find(v => v); // 找出第一個有價值的班級名稱
    if (!cls) { // 若四個選單皆未選擇
        const ce = document.getElementById('classError'); // 取得錯誤訊息 DOM
        if (ce) ce.textContent = '請先選擇一個班級'; // 提示使用者選擇班級
        return; // 中止執行
    } // if 結束
    navHistory = []; // 重置導航歷史紀錄
    incrementViewCounter(); // 觸發雲端計數器 +1 累加
    displayClassSchedule(cls); // 呼叫渲染並顯示該班級課表
} // submitClassQuery 函式結束

/* ═══════════════════════════════════════════════════════════
    教師查詢
═══════════════════════════════════════════════════════════ */ // 區塊標題：教師查詢邏輯
function onSubjectChange() { // 函式：當任教科目選單改變時，連動更新教師姓名選單
    const subjSel = document.getElementById('subjectSelect'); // 取得科目選單 DOM
    const teacherSel = document.getElementById('teacherSelect'); // 取得教師選單 DOM
    if (!subjSel || !teacherSel) return; // 若 DOM 不存在直接結束
    
    const subj = subjSel.value; // 取得選取的科目名稱
    teacherSel.innerHTML = '<option value="">— 選擇教師 —</option>'; // 重置教師選單預設選項
    if (!subj) return; // 若未選擇科目直接結束
    
    (subjectTeachers[subj] || []).forEach(t => { // 尋訪該科目對應的所有任課教師
        const opt = document.createElement('option'); // 建立 option 元素
        opt.value = t; opt.textContent = t; // 設定 option 的值與文字為教師姓名
        teacherSel.appendChild(opt); // 將 option 加入教師選單
    }); // 尋訪結束
    const te = document.getElementById('teacherError'); // 取得教師錯誤訊息 DOM
    if (te) te.textContent = ''; // 清空錯誤訊息
} // onSubjectChange 函式結束

function submitTeacherQuery() { // 函式：觸發教師查詢操作
    const teacherSel = document.getElementById('teacherSelect'); // 取得教師選單 DOM
    const teacher = teacherSel ? teacherSel.value : ''; // 取得選擇的教師姓名
    if (!teacher) { // 若未選擇教師
        const te = document.getElementById('teacherError'); // 取得錯誤訊息 DOM
        if (te) te.textContent = '請先選擇科目與教師'; // 提示選擇教師
        return; // 中止執行
    } // if 結束
    navHistory = []; // 重置導航歷史紀錄
    incrementViewCounter(); // 觸發雲端計數器 +1 累加
    displayTeacherSchedule(teacher); // 呼叫渲染並顯示該教師課表
} // submitTeacherQuery 函式結束

/* ═══════════════════════════════════════════════════════════
    顯示課表
═══════════════════════════════════════════════════════════ */ // 區塊標題：課表渲染與顯示核心
function displayClassSchedule(className) { // 函式：處理並渲染班級課表
    currentDisplayedClass = className; // 記錄當前顯示的班級名稱
    pushNav('class', className); // 將當前查詢加入導航歷史紀錄
    const cells = {}; // 初始化課表儲存格資料字典 (Key 格式: "星期-節次")
    scheduleData.forEach(row => { // 尋訪所有教師的課表資料列
        for (let d = 1; d <= 5; d++) { // 尋訪星期一至五
            for (let p of PERIODS_ALL) { // 尋訪 0~8 節
                const classRaw = row[`c${d}${p}`] || ''; // 取得該節次授課班級字串
                const classes = classRaw.split(/[\s/]+/); // 切割合班班級
                
                if (classes.includes(className) && row[`s${d}${p}`]) { // 若該節次包含目標班級且有科目名稱
                    const key = `${d}-${p}`; // 產生 Key (如: "1-2" 代表星期一第2節)
                    const subj = row[`s${d}${p}`]; // 取得科目名稱
                    const locked = isSubjectLocked(className, subj, p); // 判斷該節該科是否綁課

                    if (!cells[key]) { // 若該儲存格尚未建立資料
                        cells[key] = { subject: subj, items: [row.teachername], isLocked: locked }; // 建立儲存格物件並記錄教師姓名
                    } else { // 若已建立 (代表合班/多位教師協同教學)
                        if (!cells[key].items.includes(row.teachername)) { // 若教師姓名尚未在清單中
                            cells[key].items.push(row.teachername); // 加入教師姓名
                        } // if 結束
                        if (locked) cells[key].isLocked = true; // 若有任一授課設定綁課則標記綁課
                    } // if-else 結束
                } // if 結束
            } // 節次迴圈結束
        } // 星期迴圈結束
    }); // scheduleData 尋訪結束
    
    const numClass = className.replace(/\D/g, ''); // 提取純數字班級 (例: "701")
    const hmTeacher = homeroomData[className] || homeroomData[numClass] || ''; // 查找該班導師姓名
    const hmHtml = hmTeacher ? `<span style="font-size: 1.1rem; color: var(--text-dim, #666); margin-left: 0.5rem; font-weight: 500;">(導師：${escText(hmTeacher)})</span>` : ''; // 組裝導師姓名 HTML
    
    if (scheduleTitle) scheduleTitle.innerHTML = `${escText(className)} 班課表 ${hmHtml}`; // 設定抬頭標題文字 (含導師)
    if (scheduleTableContainer) scheduleTableContainer.innerHTML = buildScheduleTable(cells, 'class', className); // 產生 HTML 表格並寫入容器

    // 更新【上一班 / 下一班】按鈕的顯示狀態與啟用邏輯 // 說明文字
    updateClassNavButtons(className); // 更新班級導航按鈕 UI

    showView('resultView'); // 切換顯示結果頁面視圖
    updateBackBtn(); // 更新返回上一頁按鈕狀態
} // displayClassSchedule 函式結束

function displayTeacherSchedule(teacherName) { // 函式：處理並渲染教師個人課表
    currentDisplayedClass = ''; // 清除當前班級紀錄 (因為這是教師課表)
    
    // 隱藏【上一班 / 下一班】按鈕 // 說明文字
    const prevBtn = document.getElementById('prevClassBtn'); // 取得上一班按鈕 DOM
    const nextBtn = document.getElementById('nextClassBtn'); // 取得下一班按鈕 DOM
    if (prevBtn) prevBtn.style.display = 'none'; // 隱藏上一班按鈕
    if (nextBtn) nextBtn.style.display = 'none'; // 隱藏下一班按鈕

    pushNav('teacher', teacherName); // 將教師查詢推入導航歷史紀錄
    const row   = scheduleData.find(r => r.teachername === teacherName); // 在 scheduleData 查找該教師的課表資料列
    const cells = {}; // 初始化儲存格字典
    if (row) { // 若找到該教師資料
        for (let d = 1; d <= 5; d++) { // 尋訪星期一至五
            for (let p of PERIODS_ALL) { // 尋訪 0~8 節
                if (row[`s${d}${p}`]) { // 若該節次有排課
                    const key = `${d}-${p}`; // 產生 Key
                    const subj = row[`s${d}${p}`]; // 取得科目名稱
                    const classRaw = row[`c${d}${p}`] || ''; // 取得上課班級字串
                    const classes = classRaw.split(/[\s/]+/).filter(x => x); // 切割班級字串為陣列
                    const locked = classes.some(cls => isSubjectLocked(cls, subj, p)); // 判斷是否有任一上課班級設定綁課

                    cells[key] = { subject: subj, items: classes, isLocked: locked }; // 建立該儲存格物件
                } // if 結束
            } // 節次迴圈結束
        } // 星期迴圈結束
    } // if 結束
    if (scheduleTitle) scheduleTitle.textContent = `${teacherName} 老師課表`; // 設定抬頭標題文字
    if (scheduleTableContainer) scheduleTableContainer.innerHTML = buildScheduleTable(cells, 'teacher'); // 產生 HTML 表格並寫入容器

    showView('resultView'); // 切換顯示結果頁面視圖
    updateBackBtn(); // 更新返回上一頁按鈕狀態
} // displayTeacherSchedule 函式結束

/* ═══════════════════════════════════════════════════════════
    建構課表 HTML (包含午休)
═══════════════════════════════════════════════════════════ */ // 區塊標題：課表 HTML 表格構建工具
function buildScheduleTable(cells, mode, currentClassName = '') { // 函式：將 cells 資料拼裝成 HTML <table> 字串
    const periods   = (typeof CONFIG !== 'undefined' && CONFIG.PERIOD_TIMES) || []; // 取得 CONFIG 設定之各節次時間
    const hasEarly  = Object.keys(cells).some(k => k.endsWith('-0')); // 判斷課表中是否有「早自習 (第0節)」資料

    let html = '<table class="schedule-table"><thead><tr>'; // 建立 <table> 標籤與 <thead> 開始
    html += '<th class="th-period">節次</th>'; // 插入第 1 欄「節次」表頭
    DAYS.forEach(d => html += `<th>${d}</th>`); // 插入星期一至五的表頭 <th>
    html += '</tr></thead><tbody>'; // 表頭結束，開啟 <tbody>

    // 1. 早自習 // 說明文字
    if (hasEarly) { // 若有早自習資料
        const et = periods[0] || { start: '07:35', end: '08:10' }; // 取得早自習時間設定
        html += `<tr><td class="td-period">
            <div class="period-num">早自習</div>
            <div class="period-time">${escText(et.start)}<br>${escText(et.end)}</div>
        </td>`; // 建立早自習節次時間欄位
        for (let d = 1; d <= 5; d++) { // 尋訪星期一至五
            html += renderCell(cells[`${d}-0`], mode, d, 0, currentClassName); // 渲染並拼裝早自習 TD
        } // 迴圈結束
        html += '</tr>'; // 早自習列結束
    } // if 結束

    // 2. 正課 1 ~ 8 節 (包含午休) // 說明文字
    for (let p = 1; p <= 8; p++) { // 迴圈處理第 1 至第 8 節
        if (p === 5) { // 在第 5 節之前 (即第4節與第5節之間) 插入午休列
            const lunchTime = periods['lunch'] || { start: '12:20', end: '13:00' }; // 取得午休時間設定
            html += `<tr class="tr-break">
                <td class="td-period">
                    <div class="period-num">午休</div>
                    <div class="period-time">${escText(lunchTime.start)}<br>${escText(lunchTime.end)}</div>
                </td>
                <td colspan="5" class="td-break-content">午休</td>
            </tr>`; // 建立跨 5 欄的午休分隔列
        } // if 結束

        const pt = periods[p] || { start: '', end: '' }; // 取得該節次的上課時間
        html += `<tr class="${p === 8 ? 'period-8-row' : ''}"><td class="td-period"><div class="period-num">第${p}節</div>`; // 建立第 p 節 TR，若是第8節加上特有 class
        if (pt.start && pt.start !== '——') { // 若有設定有效開始時間
            html += `<div class="period-time">${escText(pt.start)}<br>${escText(pt.end)}</div>`; // 插入時間標籤
        } // if 結束
        html += '</td>'; // 節次資訊欄 <td> 結束
        for (let d = 1; d <= 5; d++) { // 尋訪星期一至五
            html += renderCell(cells[`${d}-${p}`], mode, d, p, currentClassName); // 渲染並拼裝該節 TD 內容
        } // 迴圈結束
        html += '</tr>'; // 該節次列 TR 結束
    } // 1~8 節迴圈結束

    html += '</tbody></table>'; // <tbody> 與 <table> 結束
    return html; // 回傳完整的 HTML 字串
} // buildScheduleTable 函式結束

function renderCell(cell, mode, day, period, currentClassName = '') { // 函式：渲染單一課表儲存格 (TD)
    if (!cell) return '<td class="td-empty"></td>'; // 若該儲存格無課程資料，回傳空白 TD
    
    const itemsHtml = (cell.items || []).map(item => { // 尋訪儲存格內的教師或班級清單
        if (mode === 'class') { // 若當前為班級查詢模式 (顯示教師名)
            return `<div class="cell-link" onclick="displayTeacherSchedule('${escJsParam(item)}')">${escText(item)}</div>`; // 點擊可跳轉至該教師個人課表
        } else { // 若當前為教師查詢模式 (顯示班級名)
            return `<div class="cell-link" onclick="displayClassSchedule('${escJsParam(item)}')">${escText(item)}</div>`; // 點擊可跳轉至該班級課表
        } // if-else 結束
    }).join(' '); // 以空白分隔多個連結 HTML

    let lockBadge = ''; // 初始化綁課徽章 HTML
    let cellClass = 'td-cell'; // 初始化 TD 的預設 CSS class

    if (cell.isLocked) { // 若該課程標記為綁課
        if (period === 8) { // 若為第 8 節綁課
            lockBadge = `<span class="lock-tag lock-tag-p8" title="此為第8節獨立綁課，不可調課">🔒綁課</span>`; // 產生紫色第8節鎖頭徽章
            cellClass = 'td-cell cell-locked-p8'; // 設定第8節綁課背景樣式 class
        } else { // 若為正課 1~7 節綁課
            lockBadge = `<span class="lock-tag" title="此課程已綁定，不可調課">🔒 綁課</span>`; // 產生紅色一般鎖頭徽章
            cellClass = 'td-cell cell-locked'; // 設定一般綁課背景樣式 class
        } // if-else 結束
    } // if 結束

    let subjHtml = `<div class="cell-subject">${escText(cell.subject)} ${lockBadge}</div>`; // 組裝科目名稱 HTML (含綁課徽章)
    if (mode === 'class') { // 若為班級查詢模式
        const subjClick = `onclick="showAvailableTeachers('${escJsParam(cell.subject)}', ${day}, ${period}, '${escJsParam(currentClassName)}')"` // 組裝點擊彈出可代課教師 Modal 的事件
        subjHtml = `<div class="cell-subject clickable-subject" ${subjClick} title="點擊檢視該節空堂教師">${escText(cell.subject)} ${lockBadge}</div>`; // 加上可點擊樣式與點擊事件
    } // if 結束

    return `<td class="${cellClass}">
        <div class="cell-main-info">
            ${subjHtml}
            <div class="cell-items-container">${itemsHtml}</div>
        </div>
    </td>`; // 回傳組裝完成的單一 TD HTML 字串
} // renderCell 函式結束

/* ═══════════════════════════════════════════════════════════
    彈出視窗（Modal）邏輯：查詢該節空堂教師
═══════════════════════════════════════════════════════════ */ // 區塊標題：查詢可代課教師 Modal 邏輯
function showAvailableTeachers(subject, day, period, className) { // 函式：計算並顯示特定節次的空堂/可代課教師 Modal
    const baseSubject = normalizeSubject(subject); // 去除科目尾綴進行名稱標準化
    
    // 完全保留您提供的完整排除名單 // 說明文字
    const EXCLUDED_OTHER_SUBJECT_TEACHERS = new Set([ // 定義「其他科目空堂」要過濾排除的教師名單 Set
        "李漢堂", "陳綉燕", "何嘉峻", "蔡宜婷", "周億琳", "張孟傑", "莊宗儒", 
        "許湫萍", "邱順瑜", "陳群靜", "高健雄", "吳瑩娟", "張介凡", "Divina", 
        "Jun", "侯旻汶", "何晚居", "吳相禹", "吳月雲", "蕭因伶", "張芸榛", 
        "國代", "尤靖瑜", "張詠濬", "李雪菱", "林宇涵", "林宜潔", "林菀婷", 
        "洪楷哲", "洪顧展", "洪齊成", "特教代", "盧洪恩", "簡晟軒", "莊竣麟", 
        "董祐鈞", "蔡晨虹", "蔡佩珊", "蔡鈺萱", "許錦川", "賴泓文", "趙爾梅", 
        "郭勝綸", "郭泰延", "鄭珮辰", "鄭白苹", "鄭耀宗", "蔡麗香", "蔡明芬",
        "陳國川", "張曼玲", "何嘉峻", "沈伯齡",
    ]); // EXCLUDED_OTHER_SUBJECT_TEACHERS 集合宣告結束

    // 1. 同科目空堂教師（不論節次，只要任教該科且該節空堂者） // 說明文字
    const primaryTeachers = (subjectTeachers[baseSubject] || []).filter(teacher => { // 取得該科目所有教師並進行過濾
        const row = scheduleData.find(r => r.teachername === teacher); // 取得該教師的課表資料
        return row && !row[`s${day}${period}`]; // 傳回在指定 (星期, 節次) 沒有排課的教師 (即空堂)
    }); // filter 結束

    // 2. 該班其他科目空堂教師（依據是否為第 8 節進行獨立比對） // 說明文字
    const otherTeachersMap = new Map(); // 初始化 Map 用於記錄其他科目空堂教師及其任教科目
    
    if (className) { // 若有班級資訊
        // 判斷點擊的是否為第 8 節 // 說明文字
        const isP8Query = (period === 8); // 判斷查詢節次是否為第 8 節
        // 第 8 節僅檢查 [8]；1~7 節則檢查正課 [1, 2, 3, 4, 5, 6, 7] // 說明文字
        const targetPeriods = isP8Query ? [8] : [1, 2, 3, 4, 5, 6, 7]; // 決定檢查正課還是第8節

        scheduleData.forEach(row => { // 尋訪所有教師課表
            for (let d = 1; d <= 5; d++) { // 尋訪星期一至五
                for (let p of targetPeriods) { // 尋訪目標節次 (第8節或正課1~7節)
                    const classRaw = row[`c${d}${p}`] || ''; // 取得上課班級
                    const classes = classRaw.split(/[\s/]+/); // 切割班級陣列
                    
                    if (classes.includes(className)) { // 若該教師有任教該班級
                        const subj = row[`s${d}${p}`]; // 取得授課科目
                        const normSubj = normalizeSubject(subj); // 標準化科目名稱
                        
                        if (
                            normSubj && 
                            normSubj !== baseSubject && 
                            !primaryTeachers.includes(row.teachername) &&
                            !EXCLUDED_OTHER_SUBJECT_TEACHERS.has(row.teachername)
                        ) { // 條件：有效科目、非同科、不在同科空堂名單中、且不在排除名單內
                            if (!row[`s${day}${period}`]) { // 且該教師在目標 (星期, 節次) 為空堂
                                if (!otherTeachersMap.has(row.teachername)) { // 若 Map 中尚未記錄該教師
                                    otherTeachersMap.set(row.teachername, new Set()); // 初始化該教師的科目 Set
                                } // if 結束
                                otherTeachersMap.get(row.teachername).add(normSubj); // 將任教科目加入 Set
                            } // if 結束
                        } // if 結束
                    } // if 結束
                } // 節次迴圈結束
            } // 星期迴圈結束
        }); // scheduleData 尋訪結束
    } // if 結束

    const periodText = period === 0 ? '早自習' : `第 ${period} 節`; // 計算節次顯示文字
    const dayText = DAYS[day - 1] || day; // 計算星期顯示文字
    
    const modalTitle = document.getElementById('modalTitle'); // 取得 Modal 標題 DOM
    const modalBody = document.getElementById('modalBody'); // 取得 Modal 內容 DOM
    const modal = document.getElementById('subModal'); // 取得 Modal 最外層容器 DOM

    if (modalTitle) { // 若標題 DOM 存在
        modalTitle.textContent = `星期${dayText}${periodText} 可代課教師`; // 動態設定 Modal 標題文字
    } // if 結束

    if (modalBody) { // 若內容 DOM 存在
        let html = ''; // 初始化 HTML 字串

        // 【同科】空堂教師 // 說明文字
        html += `<div class="sub-group-title">【${escText(baseSubject)}】科空堂教師：</div>`; // 插入同科標題
        if (primaryTeachers.length === 0) { // 若同科無空堂教師
            html += `<p class="no-teacher-msg">無同科空堂教師</p>`; // 顯示無空堂教師訊息
        } else { // 若有同科空堂教師
            html += '<div class="teacher-grid" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-bottom:12px;">'; // 開啟彈性容器
            primaryTeachers.forEach(t => { // 尋訪同科空堂教師
                html += `<button class="btn btn-teacher-tag btn-primary-subject" onclick="selectModalTeacher('${escJsParam(t)}')">${escText(t)}</button>`; // 建立教師按鈕膠囊 (點擊可跳轉)
            }); // 尋訪結束
            html += '</div>'; // 容器關閉
        } // if-else 結束

        // 【其他科目】空堂教師 (標題動態區分第 8 節與正課) // 說明文字
        const otherSectionTitle = (period === 8) ? '該班第八節其他任課空堂教師' : '該班其他科目空堂教師'; // 動態決定其他科目分組標題
        html += `<div class="sub-group-title mt-3">${otherSectionTitle}：</div>`; // 插入其他科目標題
        if (otherTeachersMap.size === 0) { // 若無其他科目空堂教師
            html += `<p class="no-teacher-msg">無其他科目空堂教師</p>`; // 顯示訊息
        } else { // 若有其他科目空堂教師
            html += '<div class="teacher-grid" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center;">'; // 開啟彈性容器
            otherTeachersMap.forEach((subjs, t) => { // 尋訪 Map 中的教師與科目集合
                const subjTags = Array.from(subjs).join('、'); // 將科目 Set 轉為「、」分隔的字串
                html += `<button class="btn btn-teacher-tag btn-other-subject" onclick="selectModalTeacher('${escJsParam(t)}')" title="${escAttr(subjTags)}">${escText(t)} <span class="teacher-subj-badge">(${escText(subjTags)})</span></button>`; // 建立含任教科目的教師按鈕膠囊
            }); // 尋訪結束
            html += '</div>'; // 容器關閉
        } // if-else 結束

        modalBody.innerHTML = html; // 將產生的 HTML 寫入 Modal 內容區塊
    } // if 結束

    if (modal) { // 若 Modal 容器 DOM 存在
        modal.classList.add('show'); // 加上 show CSS class 觸發顯示動畫
        modal.style.display = 'flex'; // 將顯示方式設定為 flex
    } // if 結束
} // showAvailableTeachers 函式結束

function selectModalTeacher(teacherName) { // 函式：在 Modal 中點擊教師姓名
    closeSubModal(); // 關閉 Modal 彈出視窗
    displayTeacherSchedule(teacherName); // 直接切換顯示該教師的個人課表
} // selectModalTeacher 函式結束

function closeSubModal(event) { // 函式：關閉 Modal 彈出視窗
    if (!event || event.target.id === 'subModal' || event.target.classList.contains('modal-close') || event.target.closest('.modal-close')) { // 判斷點擊的是背景或關閉按鈕
        const modal = document.getElementById('subModal'); // 取得 Modal DOM
        if (modal) { // 若 DOM 存在
            modal.classList.remove('show'); // 移除 show CSS class
            modal.style.display = 'none'; // 隱藏 Modal
        } // if 結束
    } // if 結束
} // closeSubModal 函式結束

/* ── 安全轉義工具函式 ─────────────────────────────────────── */ // 區塊標題：防止 XSS 攻擊的字串轉義工具
function escText(str) { // 函式：轉義純文字內容中的特殊 HTML 字元
    return (str || '')
        .replace(/&/g, "&amp;") // 轉義 & 為 &amp;
        .replace(/</g, "&lt;") // 轉義 < 為 &lt;
        .replace(/>/g, "&gt;"); // 轉義 > 為 &gt;
} // escText 函式結束

function escAttr(str) { // 函式：轉義 HTML 屬性 (Attribute) 中的引號
    return escText(str)
        .replace(/"/g, "&quot;") // 轉義雙引號
        .replace(/'/g, "&#39;"); // 轉義單引號
} // escAttr 函式結束

function escJsParam(str) { // 函式：轉義 JavaScript 內嵌參數中的特殊符號
    return (str || '')
        .replace(/\\/g, '\\\\') // 轉義反斜線
        .replace(/'/g, "\\'") // 轉義單引號
        .replace(/"/g, '\\"'); // 轉義雙引號
} // escJsParam 函式結束

/* ═══════════════════════════════════════════════════════════
    列印
═══════════════════════════════════════════════════════════ */ // 區塊標題：課表列印功能
function printSchedule() { // 函式：彈出新視窗進行課表列印
    if (!scheduleTitle || !scheduleTableContainer) return; // 若標題或表格 DOM 不存在則結束
    const title     = scheduleTitle.textContent; // 取得當前課表標題文字
    const tableHTML = scheduleTableContainer.innerHTML; // 取得課表表格的完整 HTML
    const semLabel  = document.getElementById('currentSemester')?.textContent || ''; // 取得當前學期標籤

    const win = window.open('', '_blank', 'width=1100,height=750'); // 開啟新空白視窗
    if (!win) { // 若視窗被瀏覽器封鎖
        alert('請允許開啟彈出式視窗以進行列印功能。'); // 提示使用者允許快顯視窗
        return; // 中止執行
    } // if 結束
    
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
</body></html>`); // 將列印專用的 HTML 與樣式寫入新視窗，並在載入完成後自動呼叫列印與關閉
    win.document.close(); // 關閉文件流以完成寫入
} // printSchedule 函式結束

/* ═══════════════════════════════════════════════════════════
    初始化與全域事件監聽
═══════════════════════════════════════════════════════════ */ // 區塊標題：頁面初始化與事件監聽設定
document.addEventListener('DOMContentLoaded', () => { // 當 DOM 樹載入完成後執行
    initDomReferences(); // 初始化 DOM 元素參考
    initViewCounter(); // 網頁初始化時讀取並顯示雲端瀏覽人數

    const schoolName = (typeof CONFIG !== 'undefined' && CONFIG.SCHOOL_NAME) ? CONFIG.SCHOOL_NAME : '民雄國中'; // 取得 CONFIG 設定的學校名稱
    document.title = `${schoolName} 課表查詢`; // 設定網頁標題

    populateSemesterSelect(); // 初始化學期選單
    setupGradeSelects(); // 設定班級選單互斥監聽
    updateBackBtn(); // 更新返回按鈕狀態
    showView('loginView'); // 預設顯示登入視圖

    // 綁定登入表單事件 // 說明文字
    const loginForm = document.getElementById('loginForm'); // 取得登入表單 DOM
    if (loginForm) { // 若表單存在
        loginForm.addEventListener('submit', async function(e) { // 監聽表單提交 (Submit) 事件
            e.preventDefault(); // 阻止表單預設的頁面刷新行為
            const errEl   = document.getElementById('loginError'); // 取得錯誤訊息 DOM
            const btn     = document.getElementById('loginBtn'); // 取得登入按鈕 DOM
            const spinner = document.getElementById('loginSpinner'); // 取得按鈕 Spinner DOM
            const semSelect = document.getElementById('semesterSelect'); // 取得學期下拉選單 DOM

            if (errEl) errEl.textContent = ''; // 清空錯誤訊息

            let semLabel = ''; // 初始化學期標籤變數
            if (semSelect && semSelect.options && semSelect.options.length > 0) { // 若學期選單有選項
                semLabel = semSelect.value; // 取得選取的學期標籤
            } else if (typeof CONFIG !== 'undefined' && CONFIG.SEMESTERS) { // 否則從 CONFIG 中獲取第一個學期
                semLabel = Object.keys(CONFIG.SEMESTERS)[0] || ''; // 取第一個學期 Key
            } // if-else 結束

            if (!semLabel) { // 若無法取得有效學期
                if (errEl) errEl.textContent = '請先選擇學期或確認 config.js 設定'; // 提示錯誤訊息
                return; // 中止執行
            } // if 結束

            if (btn) btn.disabled = true; // 停用登入按鈕防止重複點擊
            if (spinner) spinner.classList.add('show'); // 顯示按鈕轉圈 Loading 圖示

            try { // 開始載入該學期課表資料
                await fetchAndParseCSV(semLabel); // 呼叫載入與解析 CSV/JSON 函式
            } catch (err) { // 捕獲載入過程中的錯誤
                if (errEl) errEl.textContent = '載入失敗，請確認課表檔案是否存在。'; // 顯示錯誤提示
            } finally { // 無論成功或失敗都會執行的區塊
                if (btn) btn.disabled = false; // 恢復登入按鈕啟用狀態
                if (spinner) spinner.classList.remove('show'); // 隱藏按鈕 Spinner 圖示
            } // try-catch-finally 結束
        }); // 提交事件監聽結束
    } // if 結束

    // 全域監聽 Modal 點擊關閉事件 // 說明文字
    const modal = document.getElementById('subModal'); // 取得 Modal DOM
    if (modal) { // 若 Modal 存在
        modal.addEventListener('click', closeSubModal); // 綁定點擊事件以關閉 Modal
    } // if 結束
}); // DOMContentLoaded 事件監聽結束

// 開啟獨立圖片新視窗 // 說明文字
function openImageWindow(imgUrl) { // 函式：開啟新視窗檢視圖片 (如：第八節開班表)
    const width = 900; // 設定新視窗寬度
    const height = 700; // 設定新視窗高度
    
    const left = (window.screen.width - width) / 2; // 計算置中時的 Left 座標
    const top = (window.screen.height - height) / 2; // 計算置中時的 Top 座標
    
    window.open( // 開啟彈出視窗
        imgUrl, // 圖片網址
        'P8ImageWindow', // 視窗名稱
        `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no` // 視窗功能與尺寸參數
    ); // window.open 結束
} // openImageWindow 函式結束