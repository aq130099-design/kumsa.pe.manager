document.addEventListener('DOMContentLoaded', async () => {
    // 1. Session Check & Background Setup
    // If session exists, immediately switch background to app-mode (hides login screen)
    // BUT kept the loader on top so user doesn't see empty dashboard
    if (dataManager.currentUser && dataManager.currentUser.id) {
        document.body.classList.add('app-mode');
    }

    // Show loading state
    const body = document.body;
    const loader = document.createElement('div');
    loader.id = 'appLoader';
    loader.innerHTML = '<div class="spinner"></div><p>데이터 연동 중...</p>';
    body.appendChild(loader);

    // 2. Await Data Sync (CRITICAL)
    // Wait until ALL data is loaded from Google Sheets
    await dataManager.init();

    // 3. Final Render
    // Now data is ready, render the full UI
    updateView();

    // Remove loader only after UI is ready
    loader.remove();

    // Show connection status
    showConnectionStatus(dataManager.isCloudConnected);

    initDashboard();
    initTabs();
    initTimetable();
    initInventory();
    initRequests();
    initRepairs();
    // initAdminMode(); // Removed: Admin features are now automatic based on role
    initGreeting();  // Greeting logic
    updateDateDisplay();
    updateAdminState();

    // Bind login form submit event - Handled in HTML onsubmit
    // const loginForm = document.getElementById('loginForm');
    // if (loginForm) {
    //     loginForm.addEventListener('submit', function (e) {
    //         e.preventDefault();
    //         submitLogin();
    //     });
    // }

    // Weather Initialization
    fetchWeatherData();
});

function updateView() {
    try {
        const body = document.body;
        const user = dataManager.currentUser;
        const authSection = document.getElementById('authSection');
        const mainSection = document.getElementById('mainAppSection');

        if (user && user.id) {
            // 로그인 상태: 클래스 교체로 CSS 제어
            console.log('[DEBUG] updateView: User Logged In:', user.id);
            body.classList.remove('auth-mode');
            body.classList.add('app-mode');

            // If data is fully loaded, refresh UI components
            if (dataManager.isLoaded) {
                setTimeout(() => {
                    try {
                        updateUIForUser();
                    } catch (e) { console.error(e); }
                }, 50);
            }
        } else {
            // 로그아웃 상태
            body.classList.remove('app-mode');
            body.classList.add('auth-mode');

            if (typeof populateUserDropdown === 'function') populateUserDropdown();
        }
    } catch (err) {
        console.error('[CRITICAL] updateView failed:', err);
    }
}


function updateUIForUser() {
    try {
        if (!dataManager.currentUser) return;
        const userRole = dataManager.currentUser.role;
        const adminTabBtn = document.getElementById('adminManageSidebarBtn');

        // Show User Management only for Master
        if (adminTabBtn) {
            adminTabBtn.style.display = (userRole === 'master') ? 'flex' : 'none';
        }

        // Refresh components
        if (typeof renderDashboardWeekly === 'function') renderDashboardWeekly();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        if (typeof renderRecentActivity === 'function') renderRecentActivity();
        if (typeof updateAdminState === 'function') updateAdminState();

        console.log('UI Updated for user:', dataManager.currentUser.id);
    } catch (e) {
        console.error('updateUIForUser failure:', e);
    }
}

/* Auth Modal Controllers - defined early for reliability */
window.showLoginModal = () => {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.style.display = 'block';
        if (typeof populateUserDropdown === 'function') populateUserDropdown();

        // Bind click event directly to the login button
    } else {
        console.error('Login modal not found');
    }
};

window.closeAuthModals = () => {
    document.querySelectorAll('.modal').forEach(m => {
        if (m.id.includes('Modal') && (m.id === 'loginModal' || m.id === 'registerModal' || m.id === 'profileEditModal')) {
            m.style.display = 'none';
        }
    });
};

function populateUserDropdown() {
    const select = document.getElementById('loginUserSelect');
    if (!select) return;

    // Keep the first option
    const firstOption = select.options[0];
    select.innerHTML = '';
    select.appendChild(firstOption);

    dataManager.admins.forEach(user => {
        if (user.status !== 'pending') {
            const opt = document.createElement('option');
            opt.value = user.id;
            opt.textContent = user.id + (user.name ? ` (${user.name})` : '');
            select.appendChild(opt);
        }
    });
}

// ==========================================
// Weather & Air Quality Logic
// ==========================================
// ==========================================
// Weather & Air Quality Logic (KMA via GAS)
// ==========================================

async function fetchWeatherData() {
    const tempEl = document.getElementById('weatherTemp');
    const iconEl = document.getElementById('weatherIcon');
    // dustStatus element removed, using dustStatus10/25 instead
    const widget = document.getElementById('weatherWidget');

    if (!tempEl || !iconEl) return;

    // Loading State
    tempEl.innerText = '...';
    const dust10 = document.getElementById('dustStatus10');
    const dust25 = document.getElementById('dustStatus25');
    if (dust10) dust10.innerText = '미세 ...';
    if (dust25) dust25.innerText = '초미세 ...';

    try {
        // 1. Fetch from GAS (KMA Proxy)
        const responsev = await dataManager.fetchData('getWeather');

        // 2. Fetch Dust from GAS (AirKorea Proxy)
        const dustResponse = await dataManager.fetchData('getDust');

        // Handle Dust UI
        if (dustResponse && dustResponse.success && dustResponse.data) {
            const d = dustResponse.data;
            const gradeMap = { 1: '좋음', 2: '보통', 3: '나쁨', 4: '매우나쁨' };
            const colorMap = { 1: 'good', 2: 'normal', 3: 'bad', 4: 'very-bad' };

            if (dust10) {
                const g10 = parseInt(d.pm10Grade);
                dust10.innerText = `미세: ${gradeMap[g10] || '정보없음'}`;
                dust10.className = `dust-badge ${colorMap[g10] || ''}`;
            }
            if (dust25) {
                const g25 = parseInt(d.pm25Grade);
                dust25.innerText = `초미세: ${gradeMap[g25] || '정보없음'}`;
                dust25.className = `dust-badge ${colorMap[g25] || ''}`;
            }
        }

        /* 
        const response = await dataManager.fetchData('getWeather');
        if (!responsev || !responsev.success || !responsev.data) { // use responsev checks logic below 
           // Compatible with existing logic
        }
        */

        // Reuse responsev as response for weather logic
        const response = responsev;

        if (!response || !response.success || !response.data) {
            throw new Error(response?.error || '날씨 통신 실패');
        }

        const items = response.data; // Array of {category, fcstValue, fcstTime, ...}

        // Group items by fcstTime
        const forecasts = {};
        items.forEach(item => {
            if (!forecasts[item.fcstTime]) forecasts[item.fcstTime] = {};
            forecasts[item.fcstTime][item.category] = item.fcstValue;
        });

        const times = Object.keys(forecasts).sort();
        const current = forecasts[times[0]]; // Earliest available forecast is "Now"

        // Render Current Weather
        if (current) {
            const temp = current.T1H;
            const sky = parseInt(current.SKY);
            const pty = parseInt(current.PTY);

            tempEl.innerText = `${temp}°C`;

            // Icon & Theme Logic (Using Images)
            let iconCode = '01d'; // default sun
            let themeClass = 'sunny';

            // Map KMA PTY/SKY to OpenWeather Icon Codes
            if (pty > 0) {
                if ([1, 4, 5].includes(pty)) {
                    iconCode = '09d';
                    themeClass = 'rainy';
                } // Rain/Shower
                else if ([2, 3, 6, 7].includes(pty)) {
                    iconCode = '13d';
                    themeClass = 'snowy';
                } // Snow/Sleet
                else {
                    iconCode = '11d';
                    themeClass = 'rainy';
                }
            } else {
                if (sky === 1) { iconCode = '01d'; themeClass = 'sunny'; } // Clear
                else if (sky === 3) { iconCode = '02d'; themeClass = 'cloudy'; } // Partly Cloudy
                else { iconCode = '04d'; themeClass = 'cloudy'; } // Cloudy
            }

            // Check Night
            const nowHour = new Date().getHours();
            const isNight = nowHour >= 19 || nowHour < 6;
            if (isNight) {
                themeClass = 'night';
                iconCode = iconCode.replace('d', 'n');
            }

            // Use Image Element
            iconEl.innerHTML = `<img src="https://openweathermap.org/img/wn/${iconCode}@4x.png" alt="weather" style="width: 64px; height: 64px;">`;

            // Remove Lucide re-scan if not needed elsewhere, or keep it safe
            // lucide.createIcons(); // Not needed for img

            if (widget) {
                widget.className = 'weather-widget';
                widget.classList.add(themeClass);
            }
        }

        // Render Forecast Strip (1~6 Periods)
        // Standard Elementary Schedule (approx)
        // 1: 09:00 -> Nearest 09:00
        // 2: 09:50 -> Nearest 10:00
        // 3: 10:40 -> Nearest 11:00
        // 4: 11:30 -> Nearest 12:00
        // 5: 13:00 -> Nearest 13:00
        // 6: 13:50 -> Nearest 14:00

        const periods = [
            { label: '1교시', h: 9, m: 0 },
            { label: '2교시', h: 9, m: 50 },
            { label: '3교시', h: 10, m: 40 },
            { label: '4교시', h: 11, m: 30 },
            { label: '5교시', h: 13, m: 0 },
            { label: '6교시', h: 13, m: 50 }
        ];

        let forecastHtml = '';

        periods.forEach(p => {
            // Calculate Nearest Hour
            let targetHour = p.h;
            if (p.m >= 30) targetHour += 1;

            const timeKey = String(targetHour).padStart(2, '0') + '00';

            const f = forecasts[timeKey];
            if (f) {
                const t_temp = f.T1H;
                const t_sky = parseInt(f.SKY);
                const t_pty = parseInt(f.PTY);

                let iconUrl = '';
                if (t_pty > 0) iconUrl = 'https://openweathermap.org/img/wn/09d.png';
                else if (t_sky === 1) iconUrl = 'https://openweathermap.org/img/wn/01d.png';
                else if (t_sky === 3) iconUrl = 'https://openweathermap.org/img/wn/02d.png';
                else iconUrl = 'https://openweathermap.org/img/wn/04d.png';

                forecastHtml += `
                    <div class="weather-cell" style="min-width: 50px;">
                        <span class="period" style="font-size: 0.75rem;">${p.label}</span>
                        <img src="${iconUrl}" alt="weather" style="width: 32px; height: 32px;">
                        <span class="temp" style="font-size: 0.8rem;">${t_temp}°C</span>
                    </div>
                 `;
            } else {
                forecastHtml += `
                    <div class="weather-cell" style="min-width: 50px;">
                        <span class="period" style="font-size: 0.75rem;">${p.label}</span>
                        <span style="font-size: 0.8rem;">-</span>
                    </div>
                `;
            }
        });

        // Inject into widget
        let strip = widget.querySelector('.weather-forecast');
        if (!strip) {
            strip = document.createElement('div');
            strip.className = 'weather-forecast';
            widget.appendChild(strip);
        }
        strip.innerHTML = forecastHtml;



    } catch (err) {
        console.error('Weather Sync Error:', err);
        tempEl.innerText = '!';
        if (dust10) dust10.innerText = '!';
        if (dust25) dust25.innerText = '!';

        // Fallback: Check Night Mode even on error
        const nowHour = new Date().getHours();
        const isNight = nowHour >= 19 || nowHour < 6;
        if (isNight) {
            // Use Moon Icon (Lucide or consistent with success path which handles widget class)
            if (widget) {
                widget.className = 'weather-widget night';
            }
            // Use a default moon image or Lucide icon. 
            // Since success path uses OpenWeatherMap image, we can try using a static image or just Lucide for error safety.
            // Using Lucide 'moon' as it's built-in and guaranteed to work if network fails.
            iconEl.innerHTML = '<i data-lucide="moon"></i>';
            if (window.lucide) window.lucide.createIcons();
        }
    }
}



// ==========================================
// AI Activity Recommender ('오늘 뭐 하지?')
// ==========================================
// API Key is now loaded from js/config.js
// const GEMINI_API_KEY = '...'; 

function initAIRecommend() {
    const itemsList = document.getElementById('aiItemsList');
    if (!itemsList || itemsList.children.length > 0) return; // Already populated

    // Populate items checkboxes from current inventory
    itemsList.innerHTML = dataManager.inventory.map(item => `
        <label class="ai-item-option">
            <input type="checkbox" name="aiItem" value="${item.name}">
            <span>${item.name}</span>
        </label>
    `).join('');

    // Create icons for the new content
    if (window.lucide) window.lucide.createIcons();
}

function filterAIItems() {
    const searchText = document.getElementById('aiItemSearch').value.toLowerCase();
    const items = document.querySelectorAll('.ai-item-option');

    items.forEach(item => {
        const itemName = item.querySelector('span').innerText.toLowerCase();
        if (itemName.includes(searchText)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function openAIRecommendModal() {
    const modal = document.getElementById('aiRecommendModal');
    const itemsList = document.getElementById('aiItemsList');
    if (!modal || !itemsList) return;

    // Populate items checkboxes from current inventory
    itemsList.innerHTML = dataManager.inventory.map(item => `
        <label class="ai-item-option">
            <input type="checkbox" name="aiItem" value="${item.name}">
            <span>${item.name}</span>
        </label>
    `).join('');

    // Reset Form
    document.getElementById('aiRecommendForm').reset();
    document.getElementById('aiResultArea').style.display = 'none';
    document.getElementById('aiSubmitBtn').disabled = false;

    modal.classList.add('active');

    // Ensure icons in modal are rendered if any
    if (window.lucide) window.lucide.createIcons();
}

function closeAIRecommendModal() {
    document.getElementById('aiRecommendModal').classList.remove('active');
}

async function submitAIRecommend() {
    // Get Location (Radio)
    const locationRadio = document.querySelector('input[name="aiLocation"]:checked');
    const location = locationRadio ? locationRadio.value : '';

    const gradeCheckboxes = document.querySelectorAll('#aiGrades input:checked');
    const itemCheckboxes = document.querySelectorAll('#aiItemsList input:checked');
    const customRequest = document.getElementById('aiCustomRequest').value;

    if (!location) return alert('수업 장소를 선택해주세요.');
    if (gradeCheckboxes.length === 0) return alert('대상 학년을 최소 하나 선택해주세요.');

    const grades = Array.from(gradeCheckboxes).map(cb => cb.value).join(', ');
    const items = Array.from(itemCheckboxes).map(cb => cb.value).join(', ') || '교구 없음 (신체 활동 위주)';

    // UI Feedback
    const submitBtn = document.getElementById('aiSubmitBtn');
    const resultArea = document.getElementById('aiResultArea');
    const loader = document.getElementById('aiLoading');
    const content = document.getElementById('aiContent');

    submitBtn.disabled = true;
    submitBtn.innerText = '✨ AI가 생각하는 중...';
    resultArea.style.display = 'block';
    loader.style.display = 'block';
    content.innerHTML = '';

    try {

        const prompt = `
            당신은 초등학교 체육 교육 전문가입니다. 다음 조건에 맞는 창의적이고 재미있는 체육 수업 활동을 하나 추천해주세요.
            
            [조건]
            - 장소: ${location}
            - 대상: ${grades}
            - 사용 가능한 교구: ${items}
            - 추가 요청: ${customRequest || '없음'}
            
            [응답 형식]
            ### 🎯 활동명: [활동 이름]
            - **활동 목표**: [이 활동을 통해 배울 점]
            - **상세 방법**:
              1. [단계별 설명]
              2. ...
            - **준비물**: [선택한 교구 활용법]
            
            ### ⚠️ 안전 수칙 (매우 중요)
            - [부상 방지를 위한 필수 주의사항]
            
            답변은 반드시 한국어로, 초등학교 선생님이 읽기 편한 친절한 말투로 작성해주세요.
        `;

        // Use Google Apps Script Proxy
        // API_URL is defined in data.js
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'aiRecommend',
                data: { prompt: prompt }
            })
        });

        const data = await response.json();

        // Check for errors from GAS or Gemini
        if (data.error) {
            const msg = data.error.message || 'AI 호출 중 오류가 발생했습니다.';
            const detail = data.error.detail ? ` (${data.error.detail})` : '';
            throw new Error(msg + detail);
        }

        // GAS returns the raw text response in the body content (as per our GAS code)
        // If the GAS returns a JSON with 'candidates' structure (which handleAIRequest does by returning text output of response)
        // We need to parse it if it came back as a string, OR handle the structure.

        // Our GAS handleAIRequest returns: ContentService.createTextOutput(response.getContentText())
        // So 'data' variable here IS the JSON object from Gemini API directly.

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            throw new Error('AI 응답 형식이 올바르지 않습니다.');
        }

        let aiText = data.candidates[0].content.parts[0].text;

        // Robust Markdown Parsing Function
        function formatAIResponse(text) {
            let lines = text.split('\n');
            let html = '';
            let inList = false;

            lines.forEach(line => {
                line = line.trim();

                // 1. Format Bold (**bold**)
                line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

                // 2. Headers (### Title)
                if (line.startsWith('### ')) {
                    if (inList) { html += '</ul>'; inList = false; }
                    html += `<h3 class="ai-header">${line.substring(4)}</h3>`;
                }
                // 3. List Items (- Item or * Item)
                else if (line.startsWith('- ') || line.startsWith('* ')) {
                    if (!inList) { html += '<ul class="ai-list">'; inList = true; }
                    html += `<li>${line.substring(2)}</li>`;
                }
                // 4. Safety Box (Special handling for ⚠️)
                else if (line.startsWith('⚠️')) {
                    if (inList) { html += '</ul>'; inList = false; }
                    html += `<div class="ai-safety-box">${line}</div>`;
                }
                // 5. Normal Paragraphs
                else if (line.length > 0) {
                    if (inList) { html += '</ul>'; inList = false; }
                    html += `<p>${line}</p>`;
                }
            });

            if (inList) html += '</ul>';
            return html;
        }

        const htmlResult = formatAIResponse(aiText);

        loader.style.display = 'none';
        content.innerHTML = htmlResult;

    } catch (err) {
        console.error('AI Error:', err);
        loader.style.display = 'none';
        content.innerHTML = `<p style="color: #ef4444; font-weight: bold;">❌ 추천 실패: ${err.message}</p>`;
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="wand-2"></i> 다시 추천받기';
        if (window.lucide) window.lucide.createIcons();
    }
}

// Dashboard Stats Logic
function initDashboard() {
    updateDashboardStats();
    renderRecentActivity(); // Initial render
    initDashboardScheduler();
}

function formatDateForLog(dateStr) {
    const d = new Date(dateStr);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}

function renderRecentActivity() {
    const list = document.getElementById('recentActivityList');
    if (!list) return;
    list.innerHTML = '';

    const logs = dataManager.activityLogs || [];

    // Sort logic (newest first) is handled in update logic or needs sort here
    // Assuming pre-sorted or handling here:
    // logs.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)); // Optional verify

    if (logs.length === 0) {
        list.innerHTML = '<li style="padding: 1rem; color: #94a3b8; text-align: center;">최근 활동이 없습니다.</li>';
        return;
    }

    logs.forEach(log => {
        const li = document.createElement('li');
        li.style.padding = '0.75rem';
        li.style.borderBottom = '1px solid #f1f5f9';
        li.style.fontSize = '0.9rem';
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';

        let timeStr = log.timestamp && log.timestamp.includes('오') ? log.timestamp.split('오')[0].trim() : (log.timestamp || '');
        if (timeStr.length > 12) timeStr = timeStr.substring(5); // Remove year if present 2026. ...

        li.innerHTML = `<span>${log.message}</span> <span style="color:#94a3b8; font-size: 0.75rem; white-space: nowrap;">${timeStr}</span>`;
        list.appendChild(li);
    });
}

// 4. Update Teacher Dashboard Stats (New)
function updateTeacherDashboardStats() {
    if (isAdminMode() || !dataManager.currentUser) return;

    try {
        // 1. Pending Approvals I need to process
        const pendingCount = (dataManager.weeklySchedule || [])
            .filter(s => s.status === '대기')
            .filter(s => canApproveBooking(s))
            .length;

        const teacherPendingEl = document.getElementById('teacherPendingApprovals');
        if (teacherPendingEl) teacherPendingEl.innerText = `${pendingCount}건`;

        // 2. My Reservations Count (Pending or Approved)
        const myId = dataManager.currentUser.id; // Class name
        const myReservationsCount = (dataManager.weeklySchedule || [])
            .filter(s => s.class === myId && (s.status === '대기' || s.status === '승인' || s.status === '승인됨'))
            .length;

        const myReservationsEl = document.getElementById('teacherMyReservations');
        if (myReservationsEl) myReservationsEl.innerText = `${myReservationsCount}건`;

        // 3. My Unreturned Items Count (New)
        let unreturnedCount = 0;
        if (dataManager.inventory) {
            unreturnedCount = dataManager.inventory.reduce((sum, item) => {
                const myRentals = (item.rentals || []).filter(r => r.class === myId && !r.returned);
                return sum + myRentals.length;
            }, 0);
        }

        const unreturnedEl = document.getElementById('teacherUnreturnedItems');
        if (unreturnedEl) unreturnedEl.innerText = `${unreturnedCount}개`;

    } catch (e) {
        console.warn('Teacher dashboard stats refresh failed:', e);
    }
}

function updateDashboardStats() {
    try {
        // 대기 중인 승인
        const pendingCount = (dataManager.weeklySchedule || []).filter(s => s.status === '대기').length;
        const pendingEl = document.getElementById('statPendingApprovals');
        if (pendingEl) pendingEl.innerText = `${pendingCount}건`;

        // 미반납 비품
        const unreturnedCount = (dataManager.inventory || []).reduce((sum, item) => {
            return sum + (item.rentals || []).filter(r => !r.returned).length;
        }, 0);
        const unreturnedEl = document.getElementById('statUnreturnedItems');
        if (unreturnedEl) unreturnedEl.innerText = `${unreturnedCount}건`;

        // 1. Purchase Requests
        const requests = dataManager.adminRequests || [];
        const purchases = requests.filter(r => r.type === '구매');
        const purPending = purchases.filter(r => r.status === '대기').length;
        const purProgress = purchases.filter(r => r.status === '진행').length;

        const purPendingEl = document.getElementById('statPurchasePending');
        const purProgressEl = document.getElementById('statPurchaseProgress');
        if (purPendingEl) purPendingEl.innerText = `대기 ${purPending}건`;
        if (purProgressEl) purProgressEl.innerText = `진행 ${purProgress}건`;

        // 2. Repair Requests
        let repairPending = 0;
        let repairProgress = 0;
        (dataManager.inventory || []).forEach(item => {
            if (item.repairs) {
                item.repairs.forEach(r => {
                    if (r.status === '대기') repairPending++;
                    else if (r.status === '수리중' || r.status === '진행') repairProgress++;
                });
            }
        });

        const repPendingEl = document.getElementById('statRepairPending');
        const repProgressEl = document.getElementById('statRepairProgress');
        if (repPendingEl) repPendingEl.innerText = `대기 ${repairPending}건`;
        if (repProgressEl) repProgressEl.innerText = `수리 ${repairProgress}건`;

        // 3. Bug Reports
        const bugs = requests.filter(r => r.type === '버그');
        const bugPending = bugs.filter(r => r.status === '대기').length;
        const bugProgress = bugs.filter(r => r.status === '진행').length;

        const bugPendingEl = document.getElementById('statBugPending');
        const bugProgressEl = document.getElementById('statBugProgress');
        if (bugPendingEl) bugPendingEl.innerText = `대기 ${bugPending}건`;
        if (bugProgressEl) bugProgressEl.innerText = `진행 ${bugProgress}건`;
    } catch (e) {
        console.warn('Dashboard stats refresh failed:', e);
    }
}

// Tab Management
function initTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.getAttribute('data-tab');
            if (!tabId) return; // Ignore if no tabId (e.g., profile edit button)

            const targetSection = document.getElementById(tabId);
            if (!targetSection) {
                console.warn(`Tab section for "${tabId}" not found`);
                return;
            }

            if (tabId === 'adminManage') {
                renderAdminManage();
            }

            if (tabId === 'aiRecommend') {
                initAIRecommend();
            }

            navItems.forEach(nav => nav.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            item.classList.add('active');
            targetSection.classList.add('active');
            document.getElementById('pageTitle').innerText = item.innerText.trim();
        });
    });
}

// Timetable Rendering
function initTimetable() {

    const dateInput = document.getElementById('timetableDate');
    const filterBtns = document.querySelectorAll('.filter-btn');

    // Initialize with Today's Date (KST)
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kstGap = 9 * 60 * 60 * 1000; // UTC+9
    const kstDate = new Date(utc + kstGap);

    const year = kstDate.getFullYear();
    const month = String(kstDate.getMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getDate()).padStart(2, '0');

    dateInput.value = `${year}-${month}-${day}`;

    dateInput.addEventListener('change', renderTimetable);
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTimetable();
        });
    });

    renderTimetable();
}

function renderTimetable() {
    const date = document.getElementById('timetableDate').value;
    const locationFilter = document.querySelector('.filter-btn.active').getAttribute('data-loc');
    const { specials, bases } = dataManager.getScheduleForDate(date);

    // Update Table Header
    const theadRow = document.querySelector('#timetable .timetable thead tr');
    theadRow.innerHTML = '<th>교시 / 시간</th>';

    const allLocations = ['체육관', '실내 체육실', '운동장'];
    const activeLocations = locationFilter === 'all' ? allLocations : [locationFilter];

    activeLocations.forEach(loc => {
        const th = document.createElement('th');
        th.innerText = loc;
        theadRow.appendChild(th);
    });

    const tbody = document.getElementById('timetableBody');
    tbody.innerHTML = '';

    const periods = [
        { name: '1교시', time: '09:00 - 09:40' },
        { name: '2교시', time: '09:50 - 10:30' },
        { name: '3교시', time: '10:40 - 11:20' },
        { name: '4교시', time: '11:30 - 12:10' },
        { name: '점심시간', time: '12:10 - 13:00' },
        { name: '5교시', time: '13:00 - 13:40' },
        { name: '6교시', time: '13:50 - 14:30' }
    ];

    periods.forEach(p => {
        const tr = document.createElement('tr');

        // Time cell
        const timeTd = document.createElement('td');
        timeTd.className = 'time-cell';
        timeTd.innerHTML = `<div>${p.name}</div><div style="font-size: 0.75rem; color: #64748b;">${p.time}</div>`;
        tr.appendChild(timeTd);

        activeLocations.forEach(loc => {
            const td = document.createElement('td');
            td.dataset.period = p.name;
            td.dataset.location = loc;

            // Find specials (WeeklySchedule)
            const matchedSpecials = specials.filter(s => s.period === p.name && s.location === loc);

            const approvedSpecials = matchedSpecials.filter(s => s.status === '승인');
            const pendingSpecials = matchedSpecials.filter(s => !s.status || s.status === '대기');

            if (approvedSpecials.length > 0) {
                // 1. If approved special exists, it replaces the base schedule completely
                approvedSpecials.forEach(s => {
                    const card = createBookingCard(s, true);
                    td.appendChild(card);
                });
            } else {
                // 2. If no approved special, show Base Schedule FIRST
                const matchedBase = bases.find(b => b.period === p.name && b.location === loc);
                if (matchedBase) {
                    const card = createBookingCard({ ...matchedBase, status: '승인' }, false);
                    td.appendChild(card);
                }

                // 3. Then show Pending Specials below it
                if (pendingSpecials.length > 0) {
                    pendingSpecials.forEach(s => {
                        const card = createBookingCard(s, true);
                        td.appendChild(card);
                    });
                } else if (!matchedBase) {
                    td.innerHTML = '<div style="color: #cbd5e1; font-size: 0.75rem;">(비어 있음)</div>';
                }
            }

            // Click to book
            td.addEventListener('click', (e) => {
                if (e.target === td || e.target.tagName === 'DIV') {
                    showBookingModal(date, p.name, loc);
                }
            });

            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}


function createBookingCard(booking, isSpecial) {
    const card = document.createElement('div');
    const isPending = !booking.status || booking.status === '대기';
    card.className = `booking-card ${isPending ? 'pending' : ''}`;
    card.innerHTML = `
        <div class="booking-header">
            <strong>${booking.class}</strong>
            ${isPending ? '<span class="badge badge-pending">대기</span>' : ''}
        </div>
        ${isSpecial ? '<div class="booking-type">(특별)</div>' : ''}
    `;

    card.addEventListener('click', (e) => {
        e.stopPropagation();
        showDetailModal(booking, isSpecial);
    });

    return card;
}

// Help Check if user can approve this booking (Admin or Owner of Base Slot)
// Approval Permission Check - Extended for Teachers
function canApproveBooking(booking) {
    if (isAdminMode()) return true;
    if (!dataManager.currentUser) return false;

    // 1. Check Base Schedule Ownership
    // Special bookings always have a date
    if (!booking.date) return false;

    // Find day of week
    const date = new Date(booking.date);
    const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const dayOfWeek = days[date.getDay()];

    const ownerSlot = dataManager.baseSchedule.find(b =>
        b.day === dayOfWeek &&
        b.period === booking.period &&
        b.location === booking.location
    );

    // If I own the base slot
    if (ownerSlot && String(ownerSlot.class) === String(dataManager.currentUser.class)) {
        return true;
    }

    // 2. Check Approved Special Booking Ownership
    // If there is an APPROVED booking for this slot (conflicting with my request if I were requesting, but here I am checking if I can approve someone else's request?)
    // Wait, the logic is: If *I* have an APPROVED booking here, efficiently "owning" the slot for this specific day, can I approve/reject others?
    // Scenario: I booked Gym for Friday 1st period. Admin approved it.
    // Someone else requests Gym for Friday 1st period.
    // The system should probably flag this as a conflict, but if it allows the request to go to 'pending',
    // I should be able to see it and say "No" (or "Yes" if I yield).

    const approvedBookingOwner = dataManager.weeklySchedule.find(s =>
        s.date === booking.date &&
        s.period === booking.period &&
        s.location === booking.location &&
        s.status === '승인됨'
    );

    if (approvedBookingOwner && String(approvedBookingOwner.class) === String(dataManager.currentUser.class)) {
        return true;
    }

    return false;
}

function showDetailModal(booking, isSpecial) {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '예약 상세 정보';

    const isAdmin = isAdminMode();
    const isPending = !booking.status || booking.status === '대기';

    const canApprove = isSpecial && isPending && canApproveBooking(booking);

    form.innerHTML = `
        <div class="detail-info">
            <div class="info-row"><span>장소</span><strong>${booking.location}</strong></div>
            <div class="info-row"><span>교시</span><strong>${booking.period}</strong></div>
            <div class="info-row"><span>학급</span><strong>${booking.class}</strong></div>
            <div class="info-row"><span>상태</span><span class="badge ${isPending ? 'badge-pending' : 'badge-done'}">${booking.status}</span></div>
            ${isSpecial ? '<div class="info-row"><span>구분</span><strong>특별 예약</strong></div>' : ''}
        </div>
        <div class="modal-actions">
            ${canApprove ? `
                <button type="button" class="btn btn-primary" onclick="approveAndClose(${booking.id})">승인하기</button>
                <button type="button" class="btn btn-danger" onclick="deleteAndClose(${booking.id})">반려/삭제</button>
            ` : ''}
             ${isAdmin && !isPending && booking.status === '승인' ? `
                <button type="button" class="btn btn-danger" onclick="cancelBooking(${booking.id})">승인 취소</button>
            ` : ''}
            <button type="button" class="btn" style="background: #e2e8f0;" onclick="closeModal()">닫기</button>
        </div>
    `;
    form.onsubmit = (e) => e.preventDefault();
}

// Global helper for modal actions
// Global helper for modal actions
window.approveAndClose = async (id) => {
    const booking = dataManager.weeklySchedule.find(b => b.id === id);
    if (!booking) return;

    // Conflict Check
    const overlaps = dataManager.weeklySchedule.filter(s =>
        s.status === '승인' &&
        s.date === booking.date &&
        s.period === booking.period &&
        s.location === booking.location &&
        s.id !== id
    );

    if (overlaps.length > 0) {
        showConflictModal(booking, overlaps);
        return;
    }

    // Normal Approval
    await executeApproval(booking);
};

// Cancel Approved Booking (Admin Only)
window.cancelBooking = async (id) => {
    if (!confirm('정말 이 승인된 예약을 취소하시겠습니까? (기본 시간표로 돌아갑니다)')) return;

    await dataManager.sync('deleteBooking', { id });

    // Log Activity
    dataManager.sync('logActivity', { message: '관리자가 승인된 예약을 취소했습니다.' });

    closeModal();
    renderTimetable();
    renderDashboardWeekly(); // Refresh Dashboard Schedule
    renderDashboardWeekly(); // Refresh Dashboard Schedule
    updateDashboardStats();
    updateTeacherDashboardStats();
    alert('예약이 취소되었습니다.');
};

// Extracted Approval Logic
async function executeApproval(booking) {
    await dataManager.sync('approveBooking', { id: booking.id });

    // Log Activity
    const dateStr = formatDateForLog(booking.date);
    const msg = `${booking.class}에서 신청한 ${dateStr} ${booking.period} ${booking.location} 사용이 승인되었습니다.`;
    dataManager.sync('logActivity', { message: msg });
    renderRecentActivity();

    closeModal();
    renderTimetable();
    renderDashboardWeekly(); // Refresh Dashboard Schedule
    renderDashboardWeekly(); // Refresh Dashboard Schedule
    updateDashboardStats();
    updateTeacherDashboardStats();
    alert('승인되었습니다.');
}

// Conflict Resolution Modal
window.showConflictModal = (booking, overlaps) => {
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '중복 예약 발생';

    const conflictClasses = overlaps.map(o => o.class).join(', ');

    form.innerHTML = `
        <div style="padding: 1rem; background: #fff1f2; border-radius: 8px; border: 1px solid #fda4af; margin-bottom: 1.5rem;">
            <p style="color: #be123c; font-weight: 600; margin-bottom: 0.5rem;">⚠️ 이미 승인된 예약이 있습니다.</p>
            <p><strong>기존 예약:</strong> ${conflictClasses}</p>
            <p><strong>현재 승인 요청:</strong> ${booking.class}</p>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px;">
            <button type="button" class="btn" style="background: #e2e8f0; color:#334155; justify-content: space-between;" onclick="confirmDuplicateApproval(${booking.id})">
                <span>중복 승인 (둘 다 표시)</span>
                <i data-lucide="users"></i>
            </button>
            <button type="button" class="btn" style="background: #be123c; color:white; justify-content: space-between;" onclick="confirmReplaceApproval(${booking.id}, [${overlaps.map(o => o.id).join(',')}])">
                <span>대체 승인 (기존 예약 취소)</span>
                <i data-lucide="refresh-cw"></i>
            </button>
        </div>

        <div class="modal-actions" style="margin-top: 1.5rem;">
            <button type="button" class="btn" onclick="showPendingApprovalsModal()">돌아가기</button>
            <button type="button" class="btn" onclick="closeModal()">취소</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
    form.onsubmit = (e) => e.preventDefault();
};

window.confirmDuplicateApproval = async (id) => {
    const booking = dataManager.weeklySchedule.find(b => b.id === id);
    if (booking) await executeApproval(booking);
};

window.confirmReplaceApproval = async (newId, oldIds) => {
    if (!confirm('기존 예약을 취소하고 현재 요청을 승인하시겠습니까?')) return;

    // Delete existing approvals
    for (const oldId of oldIds) {
        await dataManager.sync('deleteBooking', { id: oldId });
    }

    // Approve new one
    await confirmDuplicateApproval(newId);
};

window.deleteAndClose = (id) => {
    const booking = dataManager.weeklySchedule.find(s => s.id === id);
    if (!booking) return;

    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '삭제 확인';

    form.innerHTML = `
        <div class="detail-info" style="text-align: center; padding: 1.5rem 0;">
            <p><b>${booking.class}</b> (${booking.location}, ${booking.period}) 예약을</p>
            <p style="font-size: 1.1rem; color: var(--danger); font-weight: 700; margin-top: 0.5rem;">정말 삭제하시겠습니까?</p>
        </div>
        <div class="modal-actions">
            <button type="button" class="btn btn-danger" onclick="confirmDeleteAction(${id})">삭제 확정</button>
            <button type="button" class="btn" style="background: #e2e8f0;" onclick="showDetailModalById(${id})">취소</button>
        </div>
    `;
};

window.confirmDeleteAction = async (id) => {
    // Sync delete action to server
    await dataManager.sync('deleteBooking', { id });

    // UI Update success
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '삭제 완료';
    form.innerHTML = `
        <div style="text-align: center; padding: 2rem 0;">
            <i data-lucide="check-circle" style="width: 48px; height: 48px; color: #10b981; margin-bottom: 1rem;"></i>
            <p style="font-weight: 600; font-size: 1.1rem;">정상적으로 삭제되었습니다.</p>
        </div>
        <div class="modal-actions">
            <button type="button" class="btn btn-primary" onclick="closeModal()">확인</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
    renderTimetable();
    renderDashboardWeekly(); // Fix: Immediate update for dashboard
    renderDashboardWeekly(); // Fix: Immediate update for dashboard
    updateDashboardStats();
    updateTeacherDashboardStats();
};

window.showDetailModalById = (id) => {
    // Helper to return to detail view from confirmation
    const booking = dataManager.weeklySchedule.find(s => s.id === id);
    if (booking) showDetailModal(booking, true);
    else closeModal();
};

window.closeModal = () => {
    modal.style.display = 'none';
};


// Modal handling
const modal = document.getElementById('modal');
const closeBtn = document.querySelector('.close');

closeBtn.onclick = () => modal.style.display = 'none';
window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

function showBookingModal(date, period, location) {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');

    if (period === '점심시간') {
        document.getElementById('modalTitle').innerText = `점심시간 예약 (${location})`;
        form.innerHTML = `
            <div class="form-group">
                <label>예약 단위</label>
                <select id="bookType">
                    <option value="class">학급 단위</option>
                    <option value="grade">학년 단위</option>
                </select>
            </div>
            <div class="form-group">
                <label>내용 (자동 입력: 학급명)</label>
                 <div style="padding: 10px; background: #f1f5f9; border-radius: 8px; color: #64748b;">
                    ${dataManager.currentUser ? dataManager.currentUser.id : '로그인 필요'}
                </div>
            </div>
            <button type="submit" class="btn btn-primary">신청하기</button>
        `;
    } else {
        document.getElementById('modalTitle').innerText = `${period} 예약 (${location})`;
        form.innerHTML = `
            <div class="form-group">
                <label>신청 학급 (자동 입력)</label>
                <div style="padding: 10px; background: #f1f5f9; border-radius: 8px; color: #64748b;">
                    ${dataManager.currentUser ? dataManager.currentUser.id : '로그인 필요'}
                </div>
            </div>
            <button type="submit" class="btn btn-primary">신청하기</button>
        `;
    }

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            // Auto-fill Class from User
            if (!dataManager.currentUser) {
                alert('로그인이 필요합니다.');
                if (submitBtn) submitBtn.disabled = false;
                return;
            }
            const targetClass = dataManager.currentUser.id; // User ID is the Class Name (e.g. "6-1")

            const newBooking = { date, period, location, class: targetClass };

            await dataManager.sync('addBooking', { data: newBooking });

            // Log Activity
            const dateStr = formatDateForLog(date);
            const msg = `${targetClass}에서 ${dateStr} ${period} ${location}을 예약하였습니다.`;
            dataManager.sync('logActivity', { message: msg });

            modal.style.display = 'none';
            renderTimetable();
            updateDashboardStats();
            renderRecentActivity();
            renderDashboardWeekly(); // Refresh Dashboard Schedule
            alert('신청되었습니다. 관리자 승인 후 확정됩니다.');
        } catch (err) {
            console.error(err);
            alert('오류가 발생했습니다.');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };
}

// Inventory & Requests
function getAvailableCount(item) {
    const activeRentals = item.rentals ? item.rentals.filter(r => !r.returned) : [];
    const rentedCount = activeRentals.reduce((sum, r) => sum + (r.count || 0), 0);

    // Repairing: status != 완료
    const activeRepairs = item.repairs ? item.repairs.filter(r => r.status && r.status !== '완료') : [];
    const repairingCount = activeRepairs.reduce((sum, r) => sum + (parseInt(r.count) || 0), 0);

    return item.quantity - rentedCount - repairingCount;
}

function initInventory() {
    const tbody = document.getElementById('inventoryBody');
    tbody.innerHTML = '';

    // Filter Controls
    const searchInput = document.getElementById('inventorySearchInput');
    const locFilter = document.getElementById('inventoryLocationFilter');
    const keyword = searchInput ? searchInput.value.toLowerCase() : '';
    const filterLoc = locFilter ? locFilter.value : '';

    // Populate Location Filter if empty (ensure "All" exists)
    if (locFilter && locFilter.options.length <= 1 && dataManager.locations.length > 0) {
        dataManager.locations.forEach(loc => {
            const option = document.createElement('option');
            option.value = loc;
            option.textContent = loc;
            locFilter.appendChild(option);
        });
        // Restore selection if re-rendering (though usually not needed if only appending)
        locFilter.value = filterLoc;
    }

    // Toggle admin UI elements
    const isAdmin = isAdminMode();
    const checkboxHeader = document.querySelector('.admin-checkbox-col');
    const manageLocBtn = document.getElementById('manageLocBtn');
    const bulkUpdateBtn = document.getElementById('bulkUpdateBtn');

    if (checkboxHeader) checkboxHeader.style.display = isAdmin ? 'table-cell' : 'none';
    if (manageLocBtn) manageLocBtn.style.display = isAdmin ? 'inline-block' : 'none';
    if (bulkUpdateBtn) bulkUpdateBtn.style.display = 'none'; // Initially hidden

    // Reset "Select All" checkbox
    const selectAllCb = document.getElementById('selectAllInventory');
    if (selectAllCb) selectAllCb.checked = false;

    dataManager.inventory.forEach(item => {
        // FILTER LOGIC
        if (keyword && !item.name.toLowerCase().includes(keyword)) return;
        if (filterLoc && item.location !== filterLoc) return;

        const tr = document.createElement('tr');

        // Calculate availability including repairs
        const available = getAvailableCount(item);

        // Define activeRentals for display logic
        const activeRentals = item.rentals ? item.rentals.filter(r => !r.returned) : [];

        // Calculate repairs for status
        const activeRepairs = item.repairs ? item.repairs.filter(r => r.status && r.status !== '완료') : [];
        const repairingCount = activeRepairs.reduce((sum, r) => sum + (parseInt(r.count) || 0), 0);
        const statusBadge = repairingCount > 0
            ? `<span class="badge" style="background: #eab308; color: white;">${repairingCount}개 수리중</span>`
            : `<span class="badge badge-done">정상</span>`;

        // Check if user can return (Admin or has own rentals)
        let canReturn = false;
        if (isAdmin) {
            canReturn = true;
        } else if (dataManager.currentUser) {
            canReturn = activeRentals.some(r => r.class === dataManager.currentUser.id || r.requester === dataManager.currentUser.id);
        }

        // Rental info string (multiple classes)
        const rentalInfo = activeRentals.length > 0
            ? activeRentals.map(r => `<div class="rental-tag"><b>${r.class}</b>: ${r.count}개</div>`).join('')
            : '<span style="color: #cbd5e1;">대여 없음</span>';

        tr.innerHTML = `
            ${isAdmin ? `<td><input type="checkbox" class="inv-checkbox" value="${item.id}" onchange="updateBulkBtnState()"></td>` : ''}
            <td>${item.name}</td>
            <td>${item.location}</td>
            <td><span class="quantity-badge ${available === 0 ? 'empty' : ''}">${available}</span> / ${item.quantity}</td>
            <td class="rental-info-column">${rentalInfo}</td>
            <td>${statusBadge}</td>
            <td>
                <div style="display: flex; gap: 4px;">
                    <button class="btn btn-primary btn-sm" onclick="handleRental(${item.id})" ${available <= 0 ? 'disabled' : ''}>대여</button>
                    ${activeRentals.length > 0 ? `
                    <button class="btn btn-sm" style="background: #f1f5f9; ${!canReturn ? 'opacity: 0.5; cursor: not-allowed; color: #94a3b8;' : ''}" 
                            onclick="${canReturn ? `showReturnListModal(${item.id})` : ''}"
                            ${!canReturn ? 'disabled title="내 학급의 대여 내역이 없습니다"' : ''}>
                        반납
                    </button>` : ''}
                    ${isAdmin ? `
                    <button class="btn btn-sm" style="background: #e2e8f0;" onclick="showEditInventoryModal('${item.id}')">수정</button>
                    <button class="btn btn-danger btn-sm" onclick="confirmDeleteInventoryItem(${item.id})">삭제</button>` : ''}
                </div>
            </td>
        `;

        tbody.appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();
}

window.handleRental = (id) => {
    const item = dataManager.inventory.find(i => i.id === id);
    if (!item) return;

    const rentedCount = item.rentals.filter(r => !r.returned).reduce((sum, r) => sum + r.count, 0);
    const available = item.quantity - rentedCount;

    showRentalModal(item, available);
};

function showRentalModal(item, available) {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = `${item.name} 대여 (잔여: ${available}개)`;

    form.innerHTML = `
        <div class="form-group">
            <label>대여 학급 (자동 입력)</label>
             <div style="padding: 10px; background: #f1f5f9; border-radius: 8px; color: #64748b;">
                ${dataManager.currentUser ? dataManager.currentUser.id : '로그인 필요'}
            </div>
        </div>
        <div class="form-group">
            <label>대여 수량 (최대 ${available}개)</label>
            <input type="number" id="rentalCount" value="1" min="1" max="${available}" required>
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">대여하기</button>
            <button type="button" class="btn" onclick="closeModal()">취소</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();

        if (!dataManager.currentUser) {
            alert('로그인이 필요합니다.');
            return;
        }
        const targetClass = dataManager.currentUser.id; // Auto-fill
        const count = parseInt(document.getElementById('rentalCount').value);

        if (count > available) {
            alert('잔여 수량이 부족합니다.');
            return;
        }

        const rentalData = {
            id: Date.now(),
            item_id: item.id,
            class: targetClass,
            count: count,
            date: new Date().toISOString().split('T')[0],
            returned: false
        };

        await dataManager.sync('addRental', { data: rentalData });

        const remaining = available - count;
        const msg = `${targetClass}에서 ${item.name} ${count}개 대여하였습니다. (잔여 수량: ${remaining}개)`;
        dataManager.sync('logActivity', { message: msg });

        closeModal();
        initInventory();
        updateDashboardStats();
        renderRecentActivity();
        alert(`${targetClass} 학급에 ${count}개 대여되었습니다.`);
    };
}

window.showReturnListModal = (id) => {
    const item = dataManager.inventory.find(i => i.id === id);
    if (!item) return;

    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = `${item.name} 반납 선택`;

    let activeRentals = item.rentals.filter(r => !r.returned);

    // Permission Check: If not admin, only show own rentals
    if (!isAdminMode() && dataManager.currentUser) {
        activeRentals = activeRentals.filter(r => (r.class === dataManager.currentUser.id || r.requester === dataManager.currentUser.id));
    }

    let listHtml = '<div class="return-list">';

    if (activeRentals.length === 0) {
        listHtml += `
            <div style="text-align:center; padding: 2rem; color: var(--text-muted);">
                반납할 수 있는 내역이 없습니다.
            </div>
        `;
    } else {
        activeRentals.forEach(r => {
            listHtml += `
                <div class="return-item">
                    <span><b>${r.class}</b> (${r.count}개)</span>
                    <button type="button" class="btn btn-primary btn-sm" onclick="processReturn(${item.id}, ${r.id})">반납</button>
                </div>
            `;
        });
    }
    listHtml += '</div>';

    form.innerHTML = `
        ${listHtml}
        <div class="modal-actions">
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;
    form.onsubmit = (e) => e.preventDefault();
    if (window.lucide) lucide.createIcons();
};

window.processReturn = (itemId, rentalId) => {
    const item = dataManager.inventory.find(i => i.id == itemId);
    if (!item) return;

    const rental = item.rentals.find(r => r.id == rentalId);
    if (!rental) return;

    // Show confirmation view instead of native confirm
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '반납 확인';

    form.innerHTML = `
        <div class="detail-info" style="text-align: center; padding: 1rem 0;">
            <p><b>${item.name}</b> (${rental.class}, ${rental.count}개)를</p>
            <p style="font-size: 1.1rem; color: var(--danger); font-weight: 700;">정말로 반납하시겠습니까?</p>
        </div>
        <div class="modal-actions">
            <button type="button" class="btn btn-danger" onclick="confirmReturnAction(${itemId}, ${rentalId})">반납 확정</button>
            <button type="button" class="btn" onclick="showReturnListModal(${itemId})">취소</button>
        </div>
    `;
};

window.confirmReturnAction = async (itemId, rentalId) => {
    const item = dataManager.inventory.find(i => i.id == itemId);
    const rental = item.rentals.find(r => r.id == rentalId);

    if (rental) {
        await dataManager.sync('returnItem', { rentalId });

        // Log Activity
        const activeRentals = item.rentals.filter(r => !r.returned);
        const rentedCount = activeRentals.reduce((sum, r) => sum + r.count, 0);
        const remaining = item.quantity - rentedCount;
        const msg = `${rental.class}에서 대여한 ${item.name} ${rental.count}개 반납하였습니다. (잔여 수량: ${remaining}개)`;
        dataManager.sync('logActivity', { message: msg });
        renderRecentActivity();

        // Final success state in modal
        const form = document.getElementById('modalForm');
        document.getElementById('modalTitle').innerText = '반납 완료';
        form.innerHTML = `
            <div style="text-align: center; padding: 2rem 0;">
                <i data-lucide="check-circle" style="width: 48px; height: 48px; color: #10b981; margin-bottom: 1rem;"></i>
                <p style="font-weight: 600; font-size: 1.1rem;">정상적으로 반납되었습니다.</p>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-primary" onclick="handlePostReturn(${itemId})">확인</button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        initInventory();
        updateDashboardStats();
    }
};

window.handlePostReturn = (itemId) => {
    const item = dataManager.inventory.find(i => i.id === itemId);
    const remaining = item.rentals.filter(r => !r.returned);

    if (remaining.length === 0) {
        closeModal();
    } else {
        showReturnListModal(itemId);
    }
};

window.confirmDeleteInventoryItem = (id) => {
    const item = dataManager.inventory.find(i => i.id === id);
    if (!item) return;

    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '비품 삭제 확인';

    form.innerHTML = `
        <div class="detail-info" style="text-align: center; padding: 1.5rem 0;">
            <p>비품 <b>${item.name}</b>을(를) 삭제하시겠습니까?</p>
            <p style="color: var(--danger); font-size: 0.9rem; margin-top: 0.5rem;">※ 대여 내역을 포함한 모든 정보가 사라집니다.</p>
        </div>
        <div class="modal-actions">
            <button type="button" class="btn btn-danger" onclick="executeInventoryDelete('${id}')">삭제 확정</button>
            <button type="button" class="btn" style="background: #e2e8f0;" onclick="closeModal()">취소</button>
        </div>
    `;
};

window.executeInventoryDelete = async (id) => {
    // Optimistic update
    dataManager.inventory = dataManager.inventory.filter(i => i.id != id);
    dataManager.saveLocalAll();

    // UI Update immediately
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '삭제 완료';
    form.innerHTML = `
        <div style="text-align: center; padding: 2rem 0;">
            <i data-lucide="check-circle" style="width: 48px; height: 48px; color: #10b981; margin-bottom: 1rem;"></i>
            <p style="font-weight: 600;">비품이 성공적으로 삭제되었습니다.</p>
        </div>
        <div class="modal-actions">
            <button type="button" class="btn btn-primary" onclick="closeModal()">확인</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
    initInventory();
    updateDashboardStats();

    // Sync in background
    await dataManager.sync('deleteInventoryItem', { id });
};

function initRequests() {
    renderRequestList('requests', 'requestBody');
    renderRequestList('bugs', 'bugBody');
}

function renderRequestList(typeFilter, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';

    const isAdmin = isAdminMode(); // Capture once

    const requests = dataManager.adminRequests.filter(r => {
        if (typeFilter === 'bugs') return r.type === '버그';
        return r.type !== '버그';
    });

    requests.forEach(req => {
        const tr = document.createElement('tr');
        const statusClass = req.status === '대기' ? 'badge-pending' : (req.status === '진행' ? 'badge-progress' : 'badge-done');

        tr.innerHTML = `
            <td>${req.type}</td>
            <td>${req.content}</td>
            <td>${req.requester}</td>
            <td><span class="badge ${statusClass}">${req.status}</span></td>
            <td>${req.memo || '-'}</td>
            <td>${isAdmin ? `
                <div style="display: flex; gap: 4px;">
                    <button class="btn btn-primary btn-sm" onclick="window.showRequestModal('${req.id}')">처리</button>
                    <button class="btn btn-danger btn-sm" onclick="window.confirmDeleteRequest('${req.id}')">삭제</button>
                </div>` : '-'}
            </td>
        `;
        tbody.appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();
}

window.confirmDeleteRequest = (id) => {
    const req = dataManager.adminRequests.find(r => r.id == id); // Use loose equality for safety
    if (!req) return;

    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '요청 삭제 확인';

    form.innerHTML = `
        <div class="detail-info" style="text-align: center; padding: 1.5rem 0;">
            <p>이 ${req.type} 요청을 삭제하시겠습니까?</p>
            <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 0.5rem;">내용: ${req.content}</p>
        </div>
        <div class="modal-actions">
            <button type="button" class="btn btn-danger" onclick="executeRequestDelete('${id}')">삭제 확정</button>
            <button type="button" class="btn" style="background: #e2e8f0;" onclick="closeModal()">취소</button>
        </div>
    `;
};

window.executeRequestDelete = async (id) => {
    // Optimistic update
    dataManager.adminRequests = dataManager.adminRequests.filter(r => r.id != id);
    dataManager.saveLocalAll();

    // UI Update immediately
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '삭제 완료';
    form.innerHTML = `
        <div style="text-align: center; padding: 2rem 0;">
            <i data-lucide="check-circle" style="width: 48px; height: 48px; color: #10b981; margin-bottom: 1rem;"></i>
            <p style="font-weight: 600;">요청이 삭제되었습니다.</p>
        </div>
        <div class="modal-actions">
            <button type="button" class="btn btn-primary" onclick="closeModal()">확인</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
    initRequests();
    updateDashboardStats();

    // Sync in background
    await dataManager.sync('deleteRequest', { id });
};

// Add New Request/Bug/Inventory/Repair
document.getElementById('addRequestBtn').onclick = () => showNewRequestModal('구매'); // Updated to Purchase
document.getElementById('addBugBtn').onclick = () => showNewRequestModal('버그');
document.getElementById('addInventoryBtn').onclick = () => showNewInventoryModal();
document.getElementById('addRepairBtn').onclick = () => showNewRepairModal();

function initRepairs() {
    const tbody = document.getElementById('repairBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Capture admin mode state
    const isAdmin = isAdminMode();

    // Flatten repairs from inventory
    let allRepairs = [];
    dataManager.inventory.forEach(item => {
        if (item.repairs) {
            item.repairs.forEach(r => {
                allRepairs.push({ ...r, itemName: item.name, itemLocation: item.location });
            });
        }
    });

    allRepairs.sort((a, b) => new Date(b.date) - new Date(a.date));

    allRepairs.forEach(rep => {
        const tr = document.createElement('tr');
        const statusClass = rep.status === '대기' ? 'badge-pending' : (rep.status === '완료' ? 'badge-done' : 'badge-progress');

        tr.innerHTML = `
            <td>${rep.itemName}</td>
            <td>${rep.memo || '-'}</td>
            <td>${rep.count}</td>
            <td>${rep.requester}</td>
            <td><span class="badge ${statusClass}">${rep.status}</span></td>
            <td>${rep.admin_memo || '-'}</td>
            <td>
                ${isAdmin ? `<button class="btn btn-primary btn-sm" onclick="showRepairStatusModal('${rep.id}')">관리</button>` : '-'}
            </td>
        `;
        tbody.appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();
}

function showNewRepairModal() {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '수리 요청';

    // 1. Prepare Data
    const availableItems = dataManager.inventory
        .filter(item => getAvailableCount(item) > 0)
        .map(item => ({
            ...item,
            _available: getAvailableCount(item)
        }));

    // 2. Render helper (Grid Cards)
    // 2. Render helper (Vertical List Cards with Checkmark)
    const renderCards = (items) => {
        if (items.length === 0) return '<div style="text-align: center; color: #94a3b8; padding: 2rem;">검색 결과가 없습니다.</div>';

        return items.map(item => `
            <div class="repair-item-card" id="card-${item.id}" onclick="selectRepairItem(${item.id}, ${item._available})">
                <div class="repair-card-info">
                    <div class="repair-card-name">${item.name}</div>
                    <div class="repair-card-meta">
                        <span><i data-lucide="map-pin" style="width:12px; vertical-align:middle;"></i> ${item.location}</span>
                        <span style="width: 1px; height: 10px; background: #cbd5e1;"></span>
                        <span style="color:${item._available <= 1 ? '#ef4444' : '#10b981'}">가용 ${item._available}개</span>
                    </div>
                </div>
                <div class="selection-check" style="color: var(--primary); display: none;">
                    <i data-lucide="check-circle-2" style="width: 20px;"></i>
                </div>
            </div>
        `).join('');
    };

    form.innerHTML = `
        <div class="form-group">
            <label>비품 선택 (검색)</label>
            <div style="position: relative; margin-bottom: 8px;">
                <i data-lucide="search" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #94a3b8; width: 16px;"></i>
                <input type="text" id="repairSearch" placeholder="비품명 검색..." 
                    style="width: 100%; padding: 10px 10px 10px 36px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem;">
            </div>
            
            <input type="hidden" id="selectedRepairItemId" required>
            <div class="repair-item-grid" id="repairGrid">
                ${renderCards(availableItems)}
            </div>
            <p id="selectionFeedback" style="font-size: 0.85rem; color: var(--primary); margin-top: 4px; height: 1.2em; font-weight: 500;"></p>
        </div>

        <div class="form-group">
            <label>수리 개수</label>
            <input type="number" id="repairCount" value="1" min="1" required disabled title="비품을 먼저 선택해주세요">
        </div>
        <div class="form-group">
            <label>요청 사유</label>
            <input type="text" id="repairMemo" required placeholder="예: 구멍 남, 바람 빠짐 등">
        </div>
        <div class="form-group">
            <label>신청자 (자동 입력)</label>
             <div style="padding: 10px; background: #f1f5f9; border-radius: 8px; color: #64748b;">
                ${dataManager.currentUser ? (dataManager.currentUser.id + (dataManager.currentUser.name ? ` (${dataManager.currentUser.name})` : '')) : '로그인 필요'}
            </div>
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">요청하기</button>
            <button type="button" class="btn" onclick="closeModal()">취소</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();

    // Selection Logic attached to window for inline onclick access
    // Selection Logic attached to window for inline onclick access
    window.selectRepairItem = (id, max) => {
        // Update Value
        document.getElementById('selectedRepairItemId').value = id;

        // Update Visuals
        document.querySelectorAll('.repair-item-card').forEach(c => {
            c.classList.remove('selected');
            const check = c.querySelector('.selection-check');
            if (check) check.style.display = 'none';
        });

        const card = document.getElementById(`card-${id}`);
        if (card) {
            card.classList.add('selected');
            const check = card.querySelector('.selection-check');
            if (check) check.style.display = 'block';
        }

        // Update Count Input
        const countInput = document.getElementById('repairCount');
        countInput.disabled = false;
        countInput.max = max;
        if (parseInt(countInput.value) > max) countInput.value = max;

        // Update Feedback Text
        const item = availableItems.find(i => i.id === id);
        if (item) {
            document.getElementById('selectionFeedback').innerText = `선택됨: ${item.name}`;
        }

        // Re-init icons for the newly visible check
        if (window.lucide) lucide.createIcons();
    };


    // Search Logic
    const searchInput = document.getElementById('repairSearch');
    const grid = document.getElementById('repairGrid');

    searchInput.addEventListener('input', (e) => {
        const keyword = e.target.value.toLowerCase();
        const filtered = availableItems.filter(item => item.name.toLowerCase().includes(keyword));
        grid.innerHTML = renderCards(filtered);

        // Maintain selection if still visible
        const currentId = document.getElementById('selectedRepairItemId').value;
        if (currentId && filtered.find(i => i.id == currentId)) {
            const card = document.getElementById(`card-${currentId}`);
            if (card) card.classList.add('selected');
        }
    });

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const itemId = document.getElementById('selectedRepairItemId').value;
            const count = document.getElementById('repairCount').value;

            if (!itemId) {
                alert('비품을 선택해주세요.');
                if (submitBtn) submitBtn.disabled = false;
                return;
            }

            const repairData = {
                id: Date.now(),
                item_id: parseInt(itemId), // Ensure ID is correct type
                count: count,
                date: new Date().toISOString().split('T')[0],
                memo: document.getElementById('repairMemo').value,
                requester: dataManager.currentUser ? (dataManager.currentUser.id + (dataManager.currentUser.name ? ' ' + dataManager.currentUser.name : '')) : '익명',
                status: '대기'
            };

            await dataManager.sync('addRepair', { data: repairData });
            closeModal();
            initRepairs();
            initInventory();
            updateDashboardStats();
            alert('수리 요청이 접수되었습니다.');
        } catch (err) {
            console.error(err);
            alert('오류 발생');
            if (submitBtn) submitBtn.disabled = false;
        }
    };
}

window.showRepairStatusModal = (repairId) => {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '수리 상태 관리';

    // Find repair
    let targetRep = null;
    let targetItem = null;

    dataManager.inventory.forEach(item => {
        if (item.repairs) {
            const r = item.repairs.find(rep => rep.id == repairId);
            if (r) {
                targetRep = r;
                targetItem = item;
            }
        }
    });

    if (!targetRep) return closeModal();

    form.innerHTML = `
        <div class="form-group">
            <label>상태 변경</label>
            <select id="repairStatus" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px;">
                <option value="대기" ${targetRep.status === '대기' ? 'selected' : ''}>대기</option>
                <option value="수리중" ${targetRep.status === '수리중' ? 'selected' : ''}>수리중</option>
                <option value="완료" ${targetRep.status === '완료' ? 'selected' : ''}>완료 (재고 복귀)</option>
            </select>
        </div>
        <div class="form-group">
            <label>관리자 메모</label>
            <textarea id="repairAdminMemo" rows="2" placeholder="처리 내용 등">${targetRep.admin_memo || ''}</textarea>
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">저장</button>
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const newStatus = document.getElementById('repairStatus').value;
            const memo = document.getElementById('repairAdminMemo').value;
            await dataManager.sync('updateRepair', { id: repairId, status: newStatus, admin_memo: memo });

            // Logging
            const freshItem = dataManager.inventory.find(i => i.id == targetItem.id);
            const freshAvailable = freshItem ? getAvailableCount(freshItem) : 0;

            if (newStatus === '수리중') {
                const msg = `${freshItem.name} ${targetRep.count}개가 수리중입니다. (잔여 수량:${freshAvailable}개)`;
                dataManager.sync('logActivity', { message: msg });
            } else if (newStatus === '완료') {
                const msg = `${freshItem.name} ${targetRep.count}개의 수리가 완료되었습니다. (잔여수량:${freshAvailable}개)`;
                await dataManager.sync('logActivity', { message: msg });
            }
            renderRecentActivity();

            closeModal();
            initRepairs();
            initInventory();
            updateDashboardStats(); // available count updates
        } catch (err) {
            console.error(err);
            alert('오류가 발생했습니다.');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };
};

function showNewInventoryModal() {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '신규 물품 추가';

    // Generate location options
    const locationOptions = dataManager.locations.map(loc =>
        `<option value="${loc}">${loc}</option>`
    ).join('');

    form.innerHTML = `
        <div class="form-group">
            <label>물품명</label>
            <input type="text" id="invName" placeholder="예: 농구공" required>
        </div>
        <div class="form-group">
            <label>위치</label>
            <select id="invLocation" required style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px;">
                ${locationOptions}
            </select>
        </div>
        <div class="form-group">
            <label>수량</label>
            <input type="number" id="invQuantity" value="1" min="1" required>
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">추가하기</button>
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const newItem = {
                name: document.getElementById('invName').value,
                location: document.getElementById('invLocation').value,
                quantity: parseInt(document.getElementById('invQuantity').value)
            };

            await dataManager.sync('addInventoryItem', { data: newItem });

            closeModal();
            initInventory(); // Refresh grid
            // updateDashboardStats();
        } catch (err) {
            console.error(err);
            alert('오류 발생');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };
}

window.showLocationManager = () => {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '위치 목록 관리';

    const renderLocationList = () => {
        return dataManager.locations.map(loc => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; border-bottom: 1px solid #f1f5f9;">
                <span>${loc}</span>
                <button type="button" class="btn btn-danger btn-sm" onclick="deleteLocationAction('${loc}')">삭제</button>
            </div>
        `).join('');
    };

    form.innerHTML = `
        <div class="form-group" style="display: flex; gap: 8px;">
            <input type="text" id="newLocationInput" placeholder="새 위치 명칭" style="flex: 1;">
            <button type="button" class="btn btn-primary" onclick="addLocationAction()">추가</button>
        </div>
        <div style="max-height: 300px; overflow-y: auto; margin-bottom: 1rem; border: 1px solid #e2e8f0; border-radius: 8px;">
            ${renderLocationList()}
        </div>
        <div class="modal-actions">
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;
};

window.addLocationAction = async () => {
    const input = document.getElementById('newLocationInput');
    const newLoc = input.value.trim();
    if (newLoc && !dataManager.locations.includes(newLoc)) {
        await dataManager.sync('addLocation', { location: newLoc });
        showLocationManager(); // Re-render modal
    } else if (dataManager.locations.includes(newLoc)) {
        alert('이미 존재하는 위치입니다.');
    }
    input.focus();
};

window.deleteLocationAction = async (loc) => {
    if (confirm(`'${loc}' 위치를 삭제하시겠습니까?\n해당 위치의 비품은 'none'으로 변경됩니다.`)) {
        await dataManager.sync('deleteLocation', { location: loc });
        showLocationManager(); // Re-render modal
        initInventory(); // Refresh background list
    }
};

window.toggleAllInventory = (source) => {
    const checkboxes = document.querySelectorAll('.inv-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
    updateBulkBtnState();
};

window.updateBulkBtnState = () => {
    const checked = document.querySelectorAll('.inv-checkbox:checked').length;
    const btn = document.getElementById('bulkUpdateBtn');
    if (btn) btn.style.display = checked > 0 ? 'inline-block' : 'none';
};

window.showBulkLocationModal = () => {
    const checked = Array.from(document.querySelectorAll('.inv-checkbox:checked')).map(cb => parseInt(cb.value));
    if (checked.length === 0) return;

    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '일괄 위치 이동';

    const locationOptions = dataManager.locations.map(loc =>
        `<option value="${loc}">${loc}</option>`
    ).join('');

    form.innerHTML = `
        <div class="form-group">
            <p>선택한 <b>${checked.length}개</b>의 물품을 다음 위치로 이동합니다.</p>
        </div>
        <div class="form-group">
            <label>새 위치</label>
            <select id="bulkLocationSelect" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px;">
                ${locationOptions}
            </select>
        </div>
        <div class="modal-actions">
            <button type="button" class="btn btn-primary" onclick="executeBulkLocationUpdate([${checked}])">이동</button>
            <button type="button" class="btn" onclick="closeModal()">취소</button>
        </div>
    `;
};

window.executeBulkLocationUpdate = async (ids) => {
    const newLocation = document.getElementById('bulkLocationSelect').value;
    await dataManager.sync('updateBulkLocation', { ids, newLocation });
    closeModal();
    initInventory();
    alert('위치가 변경되었습니다.');
};

function showNewRequestModal(defaultType) {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '구매 요청';

    form.innerHTML = `
        <div class="form-group">
            <label>구분</label>
            <select id="newReqType">
                <option value="구매" selected>구매</option>
            </select>
        </div>
        <div class="form-group">
            <label>내용</label>
            <textarea id="newReqContent" placeholder="상세 내용을 입력하세요" required></textarea>
        </div>
        <div class="form-group">
            <label>신청자 (자동 입력)</label>
             <div style="padding: 10px; background: #f1f5f9; border-radius: 8px; color: #64748b;">
                ${dataManager.currentUser ? (dataManager.currentUser.id + (dataManager.currentUser.name ? ` (${dataManager.currentUser.name})` : '')) : '로그인 필요'}
            </div>
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">신청하기</button>
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const requestData = {
                type: document.getElementById('newReqType').value,
                content: document.getElementById('newReqContent').value,
                requester: dataManager.currentUser ? (dataManager.currentUser.id + (dataManager.currentUser.name ? ' ' + dataManager.currentUser.name : '')) : '익명'
            };

            await dataManager.sync('addRequest', { data: requestData });

            closeModal();
            initRequests();
            alert('신청되었습니다.');
        } catch (err) {
            console.error(err);
            alert('오류 발생');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };
}

window.showRequestModal = (id) => {
    const req = dataManager.adminRequests.find(r => r.id == id); // Use loose equality for safety
    if (!req) return;

    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '요청 처리';

    form.innerHTML = `
        <div class="form-group">
            <label>처리 상태</label>
            <select id="reqStatus">
                <option value="대기" ${req.status === '대기' ? 'selected' : ''}>대기</option>
                <option value="진행" ${req.status === '진행' ? 'selected' : ''}>진행 중</option>
                <option value="완료" ${req.status === '완료' ? 'selected' : ''}>완료</option>
            </select>
        </div>
        <div class="form-group">
            <label>관리자 메모</label>
            <textarea id="reqMemo" rows="3">${req.memo || ''}</textarea>
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">저장하기</button>
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const status = document.getElementById('reqStatus').value;
            const memo = document.getElementById('reqMemo').value;

            await dataManager.sync('updateRequest', { id, status, memo });

            if (req.type === '구매' && status === '완료') {
                const msg = `요청하신 ${req.content} 구매가 완료 되었습니다.`;
                await dataManager.sync('logActivity', { message: msg });
                renderRecentActivity();
            }

            closeModal();
            initRequests();
        } catch (err) {
            console.error(err);
            alert('오류 발생');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };
};


// Admin Mode - Refactored to be automatic based on role
function updateAdminState() {
    const isAdmin = isAdminMode();
    const isMaster = dataManager.currentUser && dataManager.currentUser.role === 'master';
    const isManager = dataManager.currentUser && dataManager.currentUser.role === 'manager';

    // console.log(`[DEBUG] Updating Admin State. Role: ${dataManager.currentUser?.role}, isAdmin: ${isAdmin}`);

    // Refresh Logic 
    renderTimetable();
    initInventory();
    initRequests();
    if (typeof initRepairs === 'function') initRepairs();

    // Toggle Base Schedule Button
    const baseBtn = document.getElementById('baseScheduleBtn');
    if (baseBtn) {
        baseBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }

    // Toggle Master Sidebar Item
    const adminSidebarBtn = document.getElementById('adminManageSidebarBtn');
    if (adminSidebarBtn) {
        adminSidebarBtn.style.display = isMaster && isAdmin ? 'flex' : 'none';
    }

    // Toggle Dashboard Stats Grid (Admin only)
    const statsGrid = document.getElementById('dashboardStatsGrid');
    if (statsGrid) {
        statsGrid.style.display = isAdmin ? 'grid' : 'none';
    }

    // Toggle Teacher Stats Grid (Non-Admin only)
    const teacherStatsGrid = document.getElementById('teacherStatsGrid');
    if (teacherStatsGrid) {
        // Show if logged in AND not admin
        if (dataManager.currentUser && !isAdmin) {
            teacherStatsGrid.style.display = 'grid';
            updateTeacherDashboardStats();
        } else {
            teacherStatsGrid.style.display = 'none';
        }
    }

    // Toggle Greeting Edit Button
    const greetingBtn = document.getElementById('greetingEditBtn');
    if (greetingBtn) {
        greetingBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }
}

function initGreeting() {
    const textEl = document.getElementById('greetingText');
    const btn = document.getElementById('greetingEditBtn');

    // 1. Load from DataManager
    if (dataManager.greeting && textEl) {
        textEl.innerText = dataManager.greeting;
    }

    // 2. Click Handler
    if (btn && textEl) {
        btn.onclick = async () => {
            const current = textEl.innerText;
            const newText = prompt('새로운 인사말을 입력하세요:', current);
            if (newText && newText.trim() !== '') {
                try {
                    await dataManager.sync('updateGreeting', { text: newText.trim() });
                    textEl.innerText = newText.trim();
                    alert('인사말이 변경되어 모든 컴퓨터에 적용됩니다.');
                } catch (err) {
                    console.error(err);
                    alert('인사말 변경 중 오류가 발생했습니다.');
                }
            }
        };
    }
}

// ==========================================
// Base Schedule Editor Logic
// ==========================================
let tempBaseSchedule = [];
let currentBaseLocation = '체육관';
let isBulkMode = false;

window.showBaseScheduleEditor = () => {
    document.getElementById('baseScheduleModal').style.display = 'block';

    // Deep copy current base schedule to temp
    tempBaseSchedule = JSON.parse(JSON.stringify(dataManager.baseSchedule));

    currentBaseLocation = '체육관';

    // Reset UI
    const tabs = document.querySelectorAll('#baseScheduleModal .tab-btn');
    tabs.forEach(t => t.classList.remove('active'));
    tabs[0].classList.add('active'); // First one (Gym)

    // Reset Bulk Mode
    isBulkMode = false;
    document.getElementById('bulkClassSelect').style.display = 'none';
    const bulkBtn = document.getElementById('bulkToggleBtn');
    if (bulkBtn) {
        bulkBtn.classList.remove('active', 'btn-primary');
        bulkBtn.classList.add('btn-outline');
        bulkBtn.innerHTML = '<i data-lucide="layers" style="width: 14px; margin-right: 4px;"></i> 일괄 등록';
    }

    renderBaseScheduleGrid('체육관');
};

window.closeBaseScheduleModal = () => {
    document.getElementById('baseScheduleModal').style.display = 'none';
};

window.switchBaseLocation = (loc, btn) => {
    currentBaseLocation = loc;
    document.querySelectorAll('#baseScheduleModal .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderBaseScheduleGrid(loc);
};

window.renderBaseScheduleGrid = (loc) => {
    const container = document.getElementById('baseScheduleGrid');
    const table = document.createElement('table');
    table.className = 'data-table';
    table.style.minWidth = '600px';

    // Header
    // Style Injection for Centering & Bulk Checkbox
    if (!document.getElementById('baseScheduleStyles')) {
        const style = document.createElement('style');
        style.id = 'baseScheduleStyles';
        style.innerHTML = `
            .base-schedule-cell { position: relative; }
            .base-input { text-align: center; text-align-last: center; }
            .base-checkbox-overlay {
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(255, 255, 255, 0.5);
                display: flex; justify-content: flex-end; align-items: flex-start;
                padding: 4px;
                cursor: pointer;
                border: 2px solid transparent;
            }
            .base-checkbox-overlay:hover {
                background: rgba(255, 255, 255, 0.2);
                border-color: #3b82f6;
            }
            .bulk-check {
                width: 18px; height: 18px;
                cursor: pointer;
            }
            th { text-align: center !important; }
        `;
        document.head.appendChild(style);
    }

    const days = ['월요일', '화요일', '수요일', '목요일', '금요일'];
    let thead = '<thead><tr><th style="width: 80px; text-align: center;">교시</th>';
    days.forEach(d => thead += `<th style="text-align: center;">${d}</th>`);
    thead += '</tr></thead>';

    // Body
    let tbody = '<tbody>';
    const periods = ['1교시', '2교시', '3교시', '4교시', '점심시간', '5교시', '6교시'];

    // Get Bulk Target Class
    const bulkSelect = document.getElementById('bulkClassSelect');
    const bulkTarget = bulkSelect ? bulkSelect.value : '';

    periods.forEach(p => {
        tbody += `<tr><td style="font-weight:bold; text-align:center; vertical-align: middle;">${p}</td>`;
        days.forEach(d => {
            // Find existing in temp buffer
            const found = tempBaseSchedule.find(s => s.day === d && s.period === p && s.location === loc);
            const val = found ? found.class : '';

            let inputHtml = '';
            if (p === '점심시간') {
                inputHtml = `<input type="text" 
                            class="base-input" 
                            data-day="${d}" 
                            data-period="${p}" 
                            data-loc="${loc}" 
                            value="${val}" 
                            placeholder="-"
                            style="width: 100%; border: none; padding: 12px; text-align: center; background: transparent;">`;
            } else {
                // Generate Options
                let options = '<option value="">-</option>';
                // Populate from Admins (Users)
                // Filter out 'pending' users if desired, but mostly just all users
                const users = dataManager.admins || [];
                // Sort by ID naturally (e.g. 1-1, 1-2...)
                users.slice().sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })).forEach(u => {
                    if (u.status !== 'pending') { // Only approved users
                        const selected = val === u.id ? 'selected' : '';
                        options += `<option value="${u.id}" ${selected}>${u.id}</option>`;
                    }
                });

                inputHtml = `<select class="base-input"
                            data-day="${d}" 
                            data-period="${p}" 
                            data-loc="${loc}"
                            style="width: 100%; border: none; padding: 12px; text-align: center; background: transparent; appearance: none; -webkit-appearance: none;">
                            ${options}
                            </select>`;
            }

            // Determine checkbox state
            let isChecked = false;
            if (isBulkMode && bulkTarget && val === bulkTarget) {
                isChecked = true;
            }

            tbody += `
                <td style="padding: 0;" class="base-schedule-cell">
                    ${inputHtml}
                    ${isBulkMode ? `
                        <div class="base-checkbox-overlay" onclick="handleBulkCheck('${d}', '${p}', '${loc}', this)">
                            <input type="checkbox" class="bulk-check" ${isChecked ? 'checked' : ''} style="pointer-events: none;">
                        </div>
                    ` : ''}
                </td>
            `;
        });
        tbody += '</tr>';
    });
    tbody += '</tbody>';

    table.innerHTML = thead + tbody;
    container.innerHTML = '';
    container.appendChild(table);

    // Add listeners
    container.querySelectorAll('.base-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const day = e.target.dataset.day;
            const period = e.target.dataset.period;
            const loc = e.target.dataset.loc;
            const val = e.target.value.trim();

            // Remove existing
            tempBaseSchedule = tempBaseSchedule.filter(s => !(s.day === day && s.period === period && s.location === loc));

            // Add new if not empty
            if (val) {
                tempBaseSchedule.push({ day, period, location: loc, class: val });
            }
        });
    });
    if (window.lucide) lucide.createIcons();
};

window.toggleBulkRegistration = () => {
    isBulkMode = !isBulkMode;
    const btn = document.getElementById('bulkToggleBtn');
    const select = document.getElementById('bulkClassSelect');

    if (isBulkMode) {
        // Activate
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-primary', 'active');
        btn.innerHTML = '<i data-lucide="check" style="width: 14px; margin-right: 4px;"></i> 등록 종료';
        select.style.display = 'inline-block';

        // Populate Select if empty
        if (select.options.length <= 1) {
            const users = dataManager.admins || [];
            users.slice().sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })).forEach(u => {
                if (u.status !== 'pending') {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.innerText = u.id;
                    select.appendChild(opt);
                }
            });
        }
    } else {
        // Deactivate
        btn.classList.remove('btn-primary', 'active');
        btn.classList.add('btn-outline');
        btn.innerHTML = '<i data-lucide="layers" style="width: 14px; margin-right: 4px;"></i> 일괄 등록';
        select.style.display = 'none';
        select.value = ""; // Reset selection
    }

    // Add Listener for Select Change to re-render checkboxes
    if (!select.getAttribute('data-listened')) {
        select.addEventListener('change', () => renderBaseScheduleGrid(currentBaseLocation));
        select.setAttribute('data-listened', 'true');
    }

    renderBaseScheduleGrid(currentBaseLocation);
};

window.handleBulkCheck = (day, period, loc, overlay) => {
    const select = document.getElementById('bulkClassSelect');
    const targetClass = select.value;

    if (!targetClass) {
        alert('일괄 등록할 학반을 먼저 선택해주세요.');
        select.focus();
        return;
    }

    const checkbox = overlay.querySelector('input[type="checkbox"]');
    const isChecked = !checkbox.checked; // Toggle state because we clicked overlay

    // Update Data
    // Remove existing
    tempBaseSchedule = tempBaseSchedule.filter(s => !(s.day === day && s.period === period && s.location === loc));

    // Add new if checked (set to target class)
    if (isChecked) {
        tempBaseSchedule.push({ day, period, location: loc, class: targetClass });
    }
    // If unchecked, it remains removed (empty)

    // Re-render to show update (and update underlying input/select)
    // Optimization: Just update visuals if performance is key, but re-render is safer for syncing inputs.
    renderBaseScheduleGrid(loc);
};

window.saveBaseSchedule = async () => {
    if (confirm('기본 시간표를 저장하시겠습니까?\n(기존 기본 시간표는 모두 대체됩니다)')) {
        await dataManager.sync('replaceBaseSchedule', { schedule: tempBaseSchedule });
        closeBaseScheduleModal();
        renderTimetable();
        alert('기본 시간표가 저장되었습니다.');
    }
};

function isAdminMode() {
    if (!dataManager.currentUser) return false;
    const role = dataManager.currentUser.role;
    return role === 'master' || role === 'manager';
}

function updateDateDisplay() {
    const now = new Date();
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' };
    document.getElementById('currentDateDisplay').innerText = now.toLocaleDateString('ko-KR', options);
}

function showConnectionStatus(isCloud) {
    const statusText = document.getElementById('connectionText');
    const statusIcon = document.querySelector('#connectionStatus i');
    const container = document.getElementById('connectionStatus');

    if (!statusText || !container) return; // Sidebar not present

    const msg = (arguments.length > 1 && arguments[1]) ? arguments[1] : (isCloud ? '클라우드 연결됨' : '오프라인 모드');
    statusText.innerText = msg;

    if (isCloud) {
        container.style.color = '#0284c7';
        if (statusIcon) statusIcon.setAttribute('data-lucide', 'cloud');
    } else {
        container.style.color = '#ef4444';
        if (statusIcon) statusIcon.setAttribute('data-lucide', 'wifi-off');
    }

    if (window.lucide) lucide.createIcons();
}

window.showEditInventoryModal = (id) => {
    const item = dataManager.inventory.find(i => i.id == id);
    if (!item) return;

    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = `'${item.name}' 수량 수정`;

    form.innerHTML = `
        <div class="form-group">
            <label>총 수량</label>
            <input type="number" id="editQty" value="${item.quantity}" min="0" required>
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">저장하기</button>
            <button type="button" class="btn" onclick="closeModal()">취소</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const newQty = parseInt(document.getElementById('editQty').value);
        await dataManager.sync('updateInventoryItem', { id: id, quantity: newQty });
        closeModal();
        initInventory();
    };
};

// --- Admin Auth Modals ---

// --- Admin Auth Modals (Corrected) ---

window.showLoginModal = () => {
    // Legacy dynamic modal code removed.
    // Use the static modal defined in index.html which uses the correct submitLogin()
    closeAuthModals();
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.style.display = 'block';
        // Reset form if needed
        document.getElementById('loginForm').reset();
    } else {
        console.error('Login modal not found!');
    }
};

window.showRegisterModal = () => {
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '관리자 등록 신청';

    form.innerHTML = `
        <div class="form-group">
            <label>아이디</label>
            <input type="text" id="regId" placeholder="사용할 이름을 입력하세요" required>
        </div>
        <div class="form-group">
            <label>비밀번호 (숫자 4자리)</label>
            <input type="password" id="regPw" maxlength="4" placeholder="****" required>
        </div>
        <div class="form-group">
            <label>비밀번호 확인</label>
            <input type="password" id="regPwConfirm" maxlength="4" placeholder="****" required>
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">신청하기</button>
            <button type="button" class="btn" onclick="showLoginModal()">이전</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('regId').value;
        const pw = document.getElementById('regPw').value;
        const pwConfirm = document.getElementById('regPwConfirm').value;

        if (pw !== pwConfirm) return alert('비밀번호가 일치하지 않습니다.');
        if (!/^\d{4}$/.test(pw)) return alert('비밀번호는 숫자 4자리여야 합니다.');

        try {
            await dataManager.sync('register', { id, password: pw });
            alert('등록 신청되었습니다. Master 관리자의 승인 후 로그인 가능합니다.');
            showLoginModal();
        } catch (err) {
            alert('등록 실패: ' + err.message);
        }
    };
};

window.showChangePasswordModal = () => {
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '비밀번호 변경';

    const options = dataManager.admins.map(a => `<option value="${a.id}">${a.id}</option>`).join('');

    form.innerHTML = `
        <div class="form-group">
            <label>대상 ID</label>
            <select id="cpId" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px;">
                 <option value="" disabled selected>선택하세요</option>
                 ${options}
            </select>
        </div>
        <div class="form-group">
            <label>현재 비밀번호</label>
            <input type="password" id="oldPw" maxlength="4" required>
        </div>
        <div class="form-group">
            <label>새 비밀번호 (숫자 4자리)</label>
            <input type="password" id="newPw" maxlength="4" required>
        </div>
        <div class="form-group">
            <label>새 비밀번호 확인</label>
            <input type="password" id="newPwConfirm" maxlength="4" required>
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">변경하기</button>
            <button type="button" class="btn" onclick="showLoginModal()">이전</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('cpId').value;
        const oldPw = document.getElementById('oldPw').value;
        const newPw = document.getElementById('newPw').value;
        const confirmPw = document.getElementById('newPwConfirm').value;

        if (newPw !== confirmPw) return alert('새 비밀번호가 일치하지 않습니다.');
        if (!/^\d{4}$/.test(newPw)) return alert('비밀번호는 숫자 4자리여야 합니다.');

        try {
            await dataManager.sync('changePassword', { id, oldPassword: oldPw, newPassword: newPw });
            alert('비밀번호가 변경되었습니다. 다시 로그인해주세요.');
            showLoginModal();
        } catch (err) {
            alert('변경 요청 완료 (오류 발생 시 미반영될 수 있음)');
        }
    };
};

window.renderAdminManage = async () => {
    // 🔥 새로운 유저 신청이 실시간으로 보이도록 시트에서 최신 데이터를 다시 불러옵니다.
    await dataManager.init();

    const container = document.getElementById('adminListContainer');
    if (!container) return;

    // Remove redundant init() to keep local optimistic updates
    // await dataManager.init(); 

    // Update Admin State again just in case rights changed
    updateAdminState();

    if (!dataManager.admins || dataManager.admins.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #64748b; padding: 1rem;">등록된 관리자가 없습니다.</p>';
        return;
    }

    // Render Table-like structure or List
    const listHtml = dataManager.admins.map(user => {
        const isPending = user.status === 'pending';
        const roleSelect = isPending ?
            `<span class="badge" style="background: #f59e0b">pending</span>` :
            `<select onchange="changeAdminRole('${user.id}', this.value)" style="padding: 4px 8px; border-radius: 4px; border: 1px solid #cbd5e1; background: white; font-size: 0.9rem;">
                <option value="master" ${user.status === 'master' ? 'selected' : ''}>Master</option>
                <option value="manager" ${user.status === 'manager' ? 'selected' : ''}>Manager</option>
                <option value="teacher" ${user.status === 'teacher' ? 'selected' : ''}>Teacher</option>
             </select>`;

        return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f1f5f9; background: white;">
            <div style="display: flex; align-items: center; gap: 20px; flex: 1;">
                <div style="min-width: 80px;">
                    <span style="font-size: 0.8rem; color: #94a3b8; display: block;">학반/ID</span>
                    <span style="font-weight: 700; color: #1e293b;">${user.id}</span>
                </div>
                <div style="min-width: 100px;">
                    <span style="font-size: 0.8rem; color: #94a3b8; display: block;">이름</span>
                    <span style="color: #475569;">${user.name || '-'}</span>
                </div>
                <div style="min-width: 60px;">
                    <span style="font-size: 0.8rem; color: #94a3b8; display: block;">비번</span>
                    <span style="color: #6366f1; font-family: monospace; font-weight: bold;">${user.password || '****'}</span>
                </div>
                <div style="min-width: 100px;">
                    <span style="font-size: 0.8rem; color: #94a3b8; display: block;">권한</span>
                    ${roleSelect}
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                ${isPending ? `<button class="btn btn-sm btn-primary" onclick="confirmAdminAction('${user.id}', 'approve')">승인</button>` : ''}
                ${user.status !== 'master' || (user.status === 'master' && dataManager.currentUser.id !== user.id) ? `<button class="btn btn-sm btn-danger" style="background: #fee2e2; color: #ef4444;" onclick="confirmAdminAction('${user.id}', 'delete')">삭제</button>` : ''}
            </div>
        </div>
        `;
    }).join('');

    container.innerHTML = `<div style="background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">${listHtml}</div>`;
};

window.confirmAdminAction = async (targetId, action) => {
    if (!confirm(`${targetId} 사용자에 대해 '${action}' 작업을 수행하시겠습니까?`)) return;

    // Direct local update via sync internal method for instant feedback
    dataManager.applyLocalUpdate('adminAction', { targetId, act: action });
    renderAdminManage();

    // Await sync in the background
    await dataManager.sync('adminAction', { targetId, act: action });
};

window.changeAdminRole = async (targetId, newRole) => {
    if (!confirm(`${targetId} 사용자의 권한을 '${newRole}'(으)로 변경하시겠습니까?`)) {
        renderAdminManage(); // Revert selection if cancelled
        return;
    }

    dataManager.applyLocalUpdate('adminAction', { targetId, act: 'update_role', data: { role: newRole } });
    renderAdminManage();

    await dataManager.sync('adminAction', { targetId, act: 'update_role', data: { role: newRole } });
};

/* =========================================
   Dashboard Weekly Facility Scheduler
   ========================================= */
let dashboardWeekStart = getMonday(new Date());
let dashboardFacility = '체육관';

function getMonday(d) {
    d = new Date(d);
    var day = d.getDay(),
        diff = d.getDate() - day + (day == 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

window.initDashboardScheduler = () => {
    dashboardWeekStart = getMonday(new Date());
    renderDashboardWeekly();
};

window.changeDashboardWeek = (offset) => {
    dashboardWeekStart.setDate(dashboardWeekStart.getDate() + offset);
    renderDashboardWeekly();
};

window.switchDashboardFacility = (loc, btn) => {
    dashboardFacility = loc;
    // Update active tab UI
    const container = document.querySelector('.weekly-scheduler-section .facility-tabs');
    if (container) {
        container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    renderDashboardWeekly();
};

window.renderDashboardWeekly = () => {
    try {
        const container = document.getElementById('dashboardWeeklyGrid');
        const rangeDisplay = document.getElementById('dashboardWeekRange');

        if (!container) return;

        // Calculate dates for Mon-Fri
        const weekDates = [];
        for (let i = 0; i < 5; i++) {
            const d = new Date(dashboardWeekStart);
            d.setDate(d.getDate() + i);
            weekDates.push(d);
        }

        // Update Date Range Display
        const startStr = `${weekDates[0].getMonth() + 1}월 ${weekDates[0].getDate()}일`;
        const endStr = `${weekDates[4].getMonth() + 1}월 ${weekDates[4].getDate()}일`;
        if (rangeDisplay) rangeDisplay.innerText = `${startStr} ~ ${endStr}`;

        // Render Table
        let html = '<table class="timetable" style="min-width: 600px;">';

        // Header
        const days = ['월요일', '화요일', '수요일', '목요일', '금요일'];
        html += '<thead><tr><th style="width: 80px; background: #f8fafc;">교시</th>';
        weekDates.forEach((date, i) => {
            const isToday = new Date().toDateString() === date.toDateString();
            const style = isToday ? 'background: #eff6ff; color: #1d4ed8;' : '';
            html += `<th style="${style}">${days[i]}<br><span style="font-size:0.8em; font-weight:400;">(${date.getMonth() + 1}/${date.getDate()})</span></th>`;
        });
        html += '</tr></thead><tbody>';

        const periods = ['1교시', '2교시', '3교시', '4교시', '점심시간', '5교시', '6교시'];

        periods.forEach(period => {
            html += `<tr><td class="time-cell">${period}</td>`;

            weekDates.forEach((date, i) => {
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const dayName = days[i];

                // 1. Get Base Schedule
                const base = (dataManager.baseSchedule || []).find(s =>
                    s.day === dayName && s.period === period && s.location === dashboardFacility
                );
                const baseClass = base ? base.class : '';

                // 2. Get Special Requests (Approved or Pending)
                const specials = (dataManager.weeklySchedule || []).filter(s => {
                    if (!s.date) return false;
                    let recordDate = s.date;
                    if (typeof s.date === 'string' && s.date.includes('T')) {
                        const d = new Date(s.date);
                        const year = d.getFullYear();
                        const month = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        recordDate = `${year}-${month}-${day}`;
                    }
                    return recordDate === dateStr && s.period === period && s.location === dashboardFacility;
                });

                const approvedList = specials.filter(s => s.status === '승인');
                const pendings = specials.filter(s => s.status === '대기');

                let cellContent = '';

                if (approvedList.length > 0) {
                    const classes = approvedList.map(a => a.class).join(', ');
                    cellContent = `<span class="cell-special-approved">${classes}</span>`;
                } else {
                    if (baseClass) {
                        cellContent += `<span style="color: #64748b;">${baseClass}</span>`;
                    }
                    if (pendings.length > 0) {
                        pendings.forEach(p => {
                            cellContent += `<span class="cell-special-pending">대기: ${p.class}</span>`;
                        });
                    }
                }

                html += `<td class="dash-td" onclick="showBookingModal('${dateStr}', '${period}', '${dashboardFacility}')" style="cursor: pointer;"><div class="dash-cell-scroll">${cellContent || '-'}</div></td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) {
        console.error('renderDashboardWeekly failed:', e);
    }
};

// --- Dashboard Interactions ---

// Helper to switch tabs
window.switchTab = (tabId) => {
    // Close modal if open
    window.closeModal();

    const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (navItem) {
        navItem.click();
    }
};

// Helper for Pending Approval Modal
window.processApproval = (id, isApproved) => {
    // Close the pending list modal first? 
    // Actually, approveAndClose/deleteAndClose might expect to be called from detailed modal?
    // They generally use dataManager to find the item.
    // However, they might try to manipulate 'modal' (which is the same global modal).
    // If I am in "Pending List" modal, calling these might overwrite the modal content with "Confirm Delete" or "Conflict" content.
    // This is DESIRED behavior (flow: List -> Confirm/Action -> Result).

    if (isApproved) {
        approveAndClose(id);
    } else {
        deleteAndClose(id);
    }
};

// 2. My Reservations Modal (New)
window.showMyReservationsModal = () => {
    if (!dataManager.currentUser) return;
    const myId = dataManager.currentUser.id;

    // Filter my bookings (active)
    const myBookings = (dataManager.weeklySchedule || [])
        .filter(s => s.class === myId && (s.status === '대기' || s.status === '승인' || s.status === '승인됨'));

    // Sort by Date
    myBookings.sort((a, b) => new Date(a.date) - new Date(b.date));

    const modal = document.getElementById('modal');
    if (!modal) return;
    modal.style.display = 'block';

    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '내 예약 관리 (이번 주)';

    if (myBookings.length === 0) {
        form.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <p style="color: var(--text-muted);">이번 주 예약 내역이 없습니다.</p>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn" onclick="closeModal()">닫기</button>
            </div>
        `;
        return;
    }

    let listHtml = '<div class="return-list" style="max-height: 400px; overflow-y: auto;">';
    myBookings.forEach(p => {
        // Fix for Timezone issue
        const d = new Date(p.date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const dayName = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];

        const statusBadge = p.status === '승인' || p.status === '승인됨'
            ? '<span class="badge badge-done">승인됨</span>'
            : '<span class="badge badge-pending">대기중</span>';

        listHtml += `
            <div class="return-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border);">
                <div style="width: 100%;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span class="badge" style="background: #f1f5f9; color: #475569;">${dateStr} (${dayName})</span>
                        <span class="badge" style="background: #e0f2fe; color: #0369a1;">${p.location}</span>
                    </div>
                    <div style="font-weight: 600; font-size: 1.1rem; margin-bottom: 0.5rem;">
                        ${p.period} - ${statusBadge}
                    </div>
                    
                    <div style="display: flex; gap: 0.5rem; margin-top: 1rem; justify-content: flex-end;">
                        <button class="btn btn-sm btn-danger" onclick="cancelMyBooking(${p.id})">예약 취소</button>
                    </div>
                </div>
            </div>
        `;
    });
    listHtml += '</div>';

    // Add Close Button
    listHtml += `
        <div class="modal-actions" style="border-top: 1px solid var(--border); margin-top: 1rem; padding-top: 1rem;">
             <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;

    form.innerHTML = listHtml;
};

// 3. Cancel My Booking Logic
window.cancelMyBooking = async (id) => {
    if (!confirm('정말 이 예약을 취소하시겠습니까? (기본 시간표로 돌아갑니다)')) return;

    await dataManager.sync('deleteBooking', { id });
    dataManager.sync('logActivity', { message: `${dataManager.currentUser.id}이 예약을 취소했습니다.` });

    // Refresh UI
    showMyReservationsModal(); // Refresh the list in the modal
    renderTimetable();
    renderDashboardWeekly();
    updateDashboardStats();
    updateTeacherDashboardStats();

    alert('예약이 취소되었습니다.');
};

// 4. My Unreturned Items Modal (New)
window.showMyRentalsModal = () => {
    if (!dataManager.currentUser) return;
    const myId = dataManager.currentUser.id;

    // Aggregate my unreturned rentals across all inventory items
    const myRentals = [];
    if (dataManager.inventory) {
        dataManager.inventory.forEach(item => {
            (item.rentals || []).forEach(r => {
                if (r.class === myId && !r.returned) {
                    myRentals.push({
                        ...r,
                        itemName: item.name,
                        itemId: item.id
                    });
                }
            });
        });
    }

    // Sort by Date (Recent first?) or Oldest first? Oldest first to encourage return.
    myRentals.sort((a, b) => new Date(a.date) - new Date(b.date));

    const modal = document.getElementById('modal');
    if (!modal) return;
    modal.style.display = 'block';

    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '내 미반납 비품 관리';

    if (myRentals.length === 0) {
        form.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <i data-lucide="check-circle" style="width: 48px; height: 48px; color: #10b981; margin-bottom: 1rem;"></i>
                <p style="color: var(--text-muted);">현재 미반납된 비품이 없습니다.</p>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn" onclick="closeModal()">닫기</button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    let listHtml = '<div class="return-list" style="max-height: 400px; overflow-y: auto;">';
    myRentals.forEach(r => {
        // Fix for Timezone issue
        const d = new Date(r.date);
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const dayName = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
        const dateStr = `${month}월 ${day}일 (${dayName})`;

        listHtml += `
            <div class="return-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border);">
                <div style="width: 100%;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span class="badge" style="background: #fff1f2; color: #be123c;">${dateStr} 대여</span>
                        <span class="badge" style="background: #f1f5f9; color: #475569;">${r.count}개</span>
                    </div>
                    <div style="font-weight: 600; font-size: 1.1rem; margin-bottom: 0.5rem;">
                        ${r.itemName}
                    </div>
                    
                    <div style="display: flex; gap: 0.5rem; margin-top: 1rem; justify-content: flex-end;">
                        <button class="btn btn-sm btn-primary" onclick="returnMyRental(${r.itemId}, ${r.id})">반납하기</button>
                    </div>
                </div>
            </div>
        `;
    });
    listHtml += '</div>';

    // Add Close Button
    listHtml += `
        <div class="modal-actions" style="border-top: 1px solid var(--border); margin-top: 1rem; padding-top: 1rem;">
             <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;

    form.innerHTML = listHtml;
    if (window.lucide) lucide.createIcons();
};

// 5. Return My Rental Logic (New)
window.returnMyRental = async (itemId, rentalId) => {
    const item = dataManager.inventory.find(i => i.id == itemId);
    const rental = item ? item.rentals.find(r => r.id == rentalId) : null;

    if (!item || !rental) {
        alert('대여 정보를 찾을 수 없습니다.');
        return;
    }

    if (!confirm(`${item.name} (${rental.count}개)를 반납하시겠습니까?`)) return;

    await dataManager.sync('returnItem', { rentalId });

    // Log Activity
    const msg = `${dataManager.currentUser.id}이 ${item.name} ${rental.count}개를 반납했습니다.`;
    dataManager.sync('logActivity', { message: msg });

    // Update UI
    initInventory(); // Refresh inventory list
    updateDashboardStats(); // Refresh admin stats
    updateTeacherDashboardStats(); // Refresh teacher stats
    showMyRentalsModal(); // Refresh modal list
    renderRecentActivity(); // Refresh activity log

    alert('반납되었습니다.');
};

// 1. Pending Timetable Approvals Modal
window.showPendingApprovalsModal = () => {
    // Determine target list: All pending bookings
    let pendings = (dataManager.weeklySchedule || []).filter(s => s.status === '대기');

    // Filter by permission (Admin sees all, Teacher sees only owned/related)
    // canApproveBooking logic is now updated to handle both Admin and Owner
    pendings = pendings.filter(s => canApproveBooking(s));

    const modal = document.getElementById('modal');
    if (!modal) return;
    modal.style.display = 'block';

    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '대기중인 시간표 승인';

    if (pendings.length === 0) {
        form.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <p style="color: var(--text-muted);">대기 중인 승인 요청이 없습니다.</p>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn" onclick="closeModal()">닫기</button>
            </div>
        `;
        return;
    }

    let listHtml = '<div class="return-list" style="max-height: 400px; overflow-y: auto;">';

    // Sort logic (optional: by date/period)
    pendings.sort((a, b) => new Date(a.date) - new Date(b.date));

    pendings.forEach(p => {
        // Fix for Timezone issue: Parse ISO string to Date object and get local date components
        const d = new Date(p.date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const dayName = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];

        listHtml += `
            <div class="return-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border);">
                <div style="width: 100%;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span class="badge" style="background: #f1f5f9; color: #475569;">${dateStr} (${dayName})</span>
                        <span class="badge" style="background: #e0f2fe; color: #0369a1;">${p.location}</span>
                    </div>
                    <div style="font-weight: 600; font-size: 1.1rem; margin-bottom: 0.5rem;">
                        ${p.period} - ${p.class}
                    </div>
                    ${p.content ? `<div style="font-size: 0.9rem; color: #666; background: #f8fafc; padding: 0.5rem; border-radius: 4px;">사유: ${p.content}</div>` : ''}
                    
                    <div style="display: flex; gap: 0.5rem; margin-top: 1rem; justify-content: flex-end;">
                        <button class="btn btn-sm btn-outline" onclick="processApproval(${p.id}, false)">거절</button>
                        <button class="btn btn-sm btn-primary" onclick="processApproval(${p.id}, true)">승인</button>
                    </div>
                </div>
            </div>
        `;
    });

    listHtml += '</div>';

    // Add Close Button
    listHtml += `
        <div class="modal-actions" style="border-top: 1px solid var(--border); margin-top: 1rem; padding-top: 1rem;">
             <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;

    form.innerHTML = listHtml;
    form.onsubmit = (e) => e.preventDefault();
};

// 2. Unreturned Items Modal
window.showUnreturnedItemsModal = () => {
    const unreturnedItems = [];
    dataManager.inventory.forEach(item => {
        if (item.rentals) {
            item.rentals.forEach(r => {
                if (!r.returned) {
                    unreturnedItems.push({
                        itemId: item.id,
                        rentalId: r.id,
                        itemName: item.name,
                        renterClass: r.class,
                        count: r.count,
                        date: r.date
                    });
                }
            });
        }
    });

    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '미반납 비품 현황';

    if (unreturnedItems.length === 0) {
        form.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <p style="color: var(--text-muted);">미반납된 비품이 없습니다.</p>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn" style="background: #f1f5f9;" onclick="switchTab('inventory')">비품/대여 관리로 이동</button>
                <button type="button" class="btn" onclick="closeModal()">닫기</button>
            </div>
        `;
        return;
    }

    let listHtml = '<div class="return-list" style="max-height: 400px; overflow-y: auto;">';
    unreturnedItems.forEach(u => {
        let displayDate = u.date;
        if (u.date && u.date.includes('T')) {
            const d = new Date(u.date);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            displayDate = `${year}-${month}-${day}`;
        }

        listHtml += `
            <div class="return-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border);">
                <div>
                    <div style="font-weight: 600;">${u.itemName} (${u.count}개)</div>
                    <div style="font-size: 0.9rem; color: var(--text-muted);">${u.renterClass} - ${displayDate}</div>
                </div>
                <button type="button" class="btn btn-primary btn-sm" onclick="processReturn(${u.itemId}, ${u.rentalId})">반납</button>
            </div>
        `;
    });
    listHtml += '</div>';

    form.innerHTML = `
        ${listHtml}
        <div class="modal-actions">
            <button type="button" class="btn" style="background: #f1f5f9;" onclick="switchTab('inventory')">비품/대여 관리로 이동</button>
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;
    form.onsubmit = (e) => e.preventDefault();
};

// 3. Request Status Modal (Purchase, Repair, Bug)
window.showRequestStatusModal = (type) => {
    let requests = [];
    let title = '';
    let targetTab = '';

    if (type === '구매') {
        title = '구매 요청 현황';
        requests = dataManager.adminRequests.filter(r => r.type === '구매');
        targetTab = 'requests';
    } else if (type === '수리') {
        title = '수리 요청 현황';
        // Aggregate repairs from inventory items
        dataManager.inventory.forEach(item => {
            if (item.repairs) {
                item.repairs.forEach(r => {
                    if (r.status !== '완료') { // Show active repairs
                        requests.push({
                            type: '수리',
                            itemName: item.name,
                            content: r.reason || r.memo, // Use reason or memo
                            class: r.requester || r.reporter, // Use requester (correct) or reporter (fallback)
                            count: r.count || 1,
                            status: r.status,
                            date: r.date
                        });
                    }
                });
            }
        });
        targetTab = 'repairs';
    } else if (type === '버그') {
        title = '버그 수정 요청 현황';
        requests = dataManager.adminRequests.filter(r => r.type === '버그');
        targetTab = 'bugs';
    }

    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = title;

    if (requests.length === 0) {
        form.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <p style="color: var(--text-muted);">요청 내역이 없습니다.</p>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn" style="background: #f1f5f9;" onclick="switchTab('${targetTab}')">해당 관리 탭으로 이동</button>
                <button type="button" class="btn" onclick="closeModal()">닫기</button>
            </div>
        `;
        return;
    }

    let listHtml = '<div class="return-list" style="max-height: 400px; overflow-y: auto;">';
    requests.forEach(r => {
        const badgeClass = r.status === '대기' ? 'badge-stat-pending' : (r.status === '완료' ? 'badge-done' : 'badge-stat-progress');

        // Determine Display Title (Item Name or Type)
        let displayTitle = '';
        if (type === '수리') displayTitle = `[${r.itemName}] ${r.count}개`; // Show Item Name + Count
        else if (type === '구매') displayTitle = r.item || '구매 요청';
        else displayTitle = '버그 신고';

        // Determine Applicant Name
        // adminRequests use 'requester', repairs use 'reporter' (mapped to 'class' in line 2006? No, check mapping above)
        // Line 2006: class: r.reporter. So for Repairs, it's in r.class property of the local object 'requests'.
        // For adminRequests (Purchase/Bug), raw object has 'requester'.
        // Let's standardize: `r.requester` for direct requests.
        // My previous mapping for repairs was:
        /*
            requests.push({
                type: '수리',
                ...
                class: r.reporter, // using reporter as applicant (mapped to 'class' key)
            });
        */
        // So for repairs, it is in `r.class`.
        // For Purchase/Bug, it is in `r.requester`.

        const applicantName = r.class || r.requester || r.applicant || '익명';

        // Determine Content
        const contentText = r.content || r.reason || '-';

        let displayDate = r.date || '-';
        if (displayDate !== '-' && displayDate.includes('T')) {
            const d = new Date(displayDate);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            displayDate = `${year}-${month}-${day}`;
        }

        listHtml += `
            <div class="return-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border);">
                <div style="width: 100%;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <div style="font-weight: 600;">
                            ${displayTitle} 
                            <span class="badge ${badgeClass}" style="font-size: 0.7rem; margin-left: 4px;">${r.status || '대기'}</span>
                        </div>
                        <div style="font-size: 0.8rem; color: #94a3b8;">${displayDate}</div>
                    </div>
                    <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 2px;">
                        <span style="font-weight: 500; color: #64748b;">${applicantName}</span>
                    </div>
                    <div style="font-size: 0.9rem; color: #334155;">
                        ${contentText}
                    </div>
                </div>
            </div>
        `;
    });
    listHtml += '</div>';

    form.innerHTML = `
        ${listHtml}
        <div class="modal-actions">
            <button type="button" class="btn" style="background: #f1f5f9;" onclick="switchTab('${targetTab}')">해당 관리 탭으로 이동</button>
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;
    form.onsubmit = (e) => e.preventDefault();
};

/* --- Bulk Rental (Sports Day Mode) Logic --- */
let bulkCart = []; // { id, name, location, count, max }
let currentBulkRequester = ''; // Store the requester name

// New Button Handler (Replaces Toggle)
window.openBulkRentalModal = () => {
    // Auto-fill from User
    if (!dataManager.currentUser) {
        alert('로그인이 필요합니다.');
        return;
    }
    const name = dataManager.currentUser.id + (dataManager.currentUser.name ? ' ' + dataManager.currentUser.name : '');
    currentBulkRequester = name;
    showBulkRentalModal();
};

/* Deprecated Toggle Logic (Kept for safety but unused) */
window.toggleBulkRentalMode = () => {
    // ...
};

window.closeBulkRentalModal = () => {
    document.getElementById('bulkRentalModal').style.display = 'none';
    const toggle = document.getElementById('bulkRentalToggle');
    if (toggle) toggle.checked = false; // Uncheck when closed

    // Reset Cart
    bulkCart = [];
    currentBulkRequester = '';
};

window.showBulkRentalModal = () => {
    const modal = document.getElementById('bulkRentalModal');
    modal.style.display = 'block';

    // Update Requester Display
    const requesterDisplay = document.getElementById('bulkRequesterDisplay');
    if (requesterDisplay) {
        requesterDisplay.innerText = `신청자: ${currentBulkRequester}`;
    }

    bulkCart = []; // Reset cart on open
    renderBulkCart();
    renderBulkItems(); // Initial Render
};

// Render Item List (Upper Pane)
window.renderBulkItems = () => {
    const keyword = document.getElementById('bulkItemSearch').value.toLowerCase();
    const tbody = document.getElementById('bulkItemBody');
    tbody.innerHTML = '';

    // Filter Items
    const items = dataManager.inventory.filter(item => {
        if (!item.name.toLowerCase().includes(keyword)) return false;

        // Calculate *Real* Available (Total - Rentals - Repairs - CART)
        const cartItem = bulkCart.find(c => c.id === item.id);
        const cartCount = cartItem ? cartItem.count : 0;
        const available = getAvailableCount(item) - cartCount; // Dynamic availability

        return available > 0; // Only show items that can be rented
    });

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; color:#94a3b8;">대여 가능한 비품이 없습니다.</td></tr>';
        return;
    }

    items.forEach(item => {
        // Recalculate available for passing to row (redundant but safe)
        const cartItem = bulkCart.find(c => c.id === item.id);
        const cartCount = cartItem ? cartItem.count : 0;
        const available = getAvailableCount(item) - cartCount;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div style="font-weight:600;">${item.name}</div>
                <div style="font-size:0.8rem; color:#64748b;">${item.location}</div>
            </td>
            <td style="text-align:center; color: var(--primary); font-weight:600;">${available}</td>
            <td style="text-align:center;">
                <div class="bulk-qty-control">
                    <button class="qty-btn" onclick="updateBulkEntryQty(${item.id}, -1)">-</button>
                    <input type="number" id="bulk-qty-${item.id}" value="1" min="1" max="${available}" class="qty-display" readonly>
                    <button class="qty-btn" onclick="updateBulkEntryQty(${item.id}, 1, ${available})">+</button>
                </div>
            </td>
            <td style="text-align:center;">
                <button class="bulk-add-btn" onclick="addToBulkCart(${item.id}, ${available})">담기</button>
            </td>
        `;
        tbody.appendChild(row);
    });
};

window.filterBulkItems = () => {
    renderBulkItems();
};

window.updateBulkEntryQty = (id, delta, max) => {
    const input = document.getElementById(`bulk-qty-${id}`);
    let val = parseInt(input.value) || 1;
    val += delta;
    if (val < 1) val = 1;
    if (max && val > max) val = max;
    input.value = val;
};

// Cart Logic
window.addToBulkCart = (itemId, maxAvailable) => {
    const qtyInput = document.getElementById(`bulk-qty-${itemId}`);
    const qtyToAdd = parseInt(qtyInput.value) || 1;

    if (qtyToAdd > maxAvailable) {
        alert('잔여 수량을 초과할 수 없습니다.');
        return;
    }

    const item = dataManager.inventory.find(i => i.id === itemId);
    const existing = bulkCart.find(c => c.id === itemId);

    if (existing) {
        existing.count += qtyToAdd;
    } else {
        bulkCart.push({
            id: item.id,
            name: item.name,
            location: item.location,
            count: qtyToAdd,
            max: getAvailableCount(item) // Original max
        });
    }

    // Refresh UI
    renderBulkItems(); // Updates available counts in list
    renderBulkCart();
};

window.removeFromBulkCart = (itemId) => {
    bulkCart = bulkCart.filter(c => c.id !== itemId);
    renderBulkItems();
    renderBulkCart();
};

// Update Cart Qty (Local)
window.updateBulkCartQty = (itemId, delta) => {
    const cartItem = bulkCart.find(c => c.id === itemId);
    if (!cartItem) return;

    // Recalculate Max Available: (Current Available in Inventory + Current in Cart)
    const item = dataManager.inventory.find(i => i.id === itemId);
    const availableInInv = getAvailableCount(item);
    const maxTotal = availableInInv + cartItem.count;

    let newCount = cartItem.count + delta;
    if (newCount < 1) newCount = 1;
    if (newCount > maxTotal) newCount = maxTotal;

    cartItem.count = newCount;

    // Refresh UI
    renderBulkItems();
    renderBulkCart();
};

window.renderBulkCart = () => {
    const tbody = document.getElementById('bulkCartBody');
    const emptyMsg = document.getElementById('bulkCartEmpty');
    const countBadge = document.getElementById('bulkCartCount');

    tbody.innerHTML = '';
    countBadge.innerText = `${bulkCart.length}종`;

    if (bulkCart.length === 0) {
        emptyMsg.style.display = 'block';
    } else {
        emptyMsg.style.display = 'none';
        bulkCart.forEach(c => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div style="font-weight:600;">${c.name}</div>
                    <div style="font-size:0.8rem; color:#64748b;">${c.location}</div>
                </td>
                <td style="text-align:center;">-</td>
                <td style="text-align:center;">
                    <div class="bulk-qty-control">
                        <button class="qty-btn" onclick="updateBulkCartQty(${c.id}, -1)">-</button>
                        <span style="width:30px; text-align:center; font-weight:bold;">${c.count}</span>
                        <button class="qty-btn" onclick="updateBulkCartQty(${c.id}, 1)">+</button>
                    </div>
                </td>
                <td style="text-align:center;">
                    <button class="qty-btn" style="color:#ef4444; border-color:#ef4444;" onclick="removeFromBulkCart(${c.id})">
                        <i data-lucide="trash-2" style="width:14px;"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
        if (window.lucide) lucide.createIcons();
    }
};

// Final Submission
window.submitBulkRental = async () => {
    // Use the stored global variable
    const requester = currentBulkRequester;

    if (bulkCart.length === 0) {
        alert('장바구니에 담긴 물품이 없습니다.');
        return;
    }
    if (!requester) {
        alert('신청자 정보가 없습니다. 다시 실행해주세요.');
        closeBulkRentalModal();
        return;
    }

    if (!confirm(`신청자: [${requester}]\n총 ${bulkCart.length}종류의 비품을 일괄 대여하시겠습니까?`)) return;

    // Show Loading State
    const btn = document.querySelector('.bulk-footer .btn-primary');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = '처리 중...';

    let successCount = 0;
    let failCount = 0;

    try {
        // Sequential Sync with error isolation
        for (const cartItem of bulkCart) {
            // Generate unique ID for each rental
            const rentalId = Date.now() + Math.floor(Math.random() * 10000);

            const rentalData = {
                id: rentalId,
                item_id: cartItem.id,
                class: requester,
                count: cartItem.count,
                date: new Date().toISOString(),
                reason: '일괄 대여(운동회 모드)',
                returned: false
            };

            // Client-side Update handled by sync
            // dataManager.applyLocalUpdate('addRental', { data: rentalData });

            try {
                // Server Sync (Fire and wait slightly to not flood)
                await dataManager.sync('addRental', { data: rentalData });
                successCount++;
            } catch (innerErr) {
                console.error(`Failed to sync item ${cartItem.name}`, innerErr);
                failCount++;
            }

            // Small delay to prevent rate limiting/network flooding
            await new Promise(r => setTimeout(r, 300));
        }

        // Add Summary Activity Log
        if (successCount > 0) {
            const firstItemName = bulkCart[0].name;
            const extraCount = successCount - 1;
            const logMsg = extraCount > 0
                ? `${requester}에서 ${firstItemName} 외 ${extraCount}건을 일괄 대여하였습니다.`
                : `${requester}에서 ${firstItemName}을(를) 일괄 대여하였습니다.`;

            // Await to ensure local state is updated before rendering
            await dataManager.sync('logActivity', { message: logMsg });
        }

        closeBulkRentalModal();

        // Robust UI Refresh
        try {
            renderRecentActivity(); // Refresh logs first
            initInventory(); // Refresh main table
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
        } catch (uiErr) {
            console.warn('UI Refresh failed after rental', uiErr);
        }

        if (failCount > 0) {
            alert(`일괄 대여가 완료되었으나, ${failCount}건의 서버 동기화가 지연될 수 있습니다.\n(데이터는 저장되었습니다)`);
        } else {
            alert('일괄 대여가 정상적으로 완료되었습니다.');
        }

    } catch (e) {
        console.error(e);
        alert('처리 중 치명적인 오류가 발생했습니다.');
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
};

/* --- Bulk Return Logic --- */
let bulkReturnCart = []; // { itemId, name, location, count, className }

window.showBulkReturnModal = () => {
    const modal = document.getElementById('bulkReturnModal');
    const select = document.getElementById('bulkReturnClassSelect');

    // Populate Class Select (Only classes with active rentals)
    const activeClasses = new Set();
    const dateRegex = /^\d{4}-\d{2}-\d{2}T/; // ISO Date check

    dataManager.inventory.forEach(item => {
        if (item.rentals) {
            item.rentals.forEach(r => {
                if (!r.returned) {
                    // Check 'class' first, then legacy 'requester'
                    let name = r.class || r.requester;

                    // Permission Check: If not admin, only show own class
                    if (!isAdminMode() && dataManager.currentUser) {
                        if (name !== dataManager.currentUser.id) return;
                    }

                    // Filter out bad data (dates, empty strings)
                    if (name && typeof name === 'string' && name.length < 20 && !dateRegex.test(name)) {
                        activeClasses.add(name);
                    }
                }
            });
        }
    });

    select.innerHTML = '<option value="">반납할 학급 선택 (대여 중인 반만 표시됨)</option>';
    select.disabled = false; // Reset disabled state (default)

    if (activeClasses.size === 0) {
        const opt = document.createElement('option');
        opt.text = "(현재 대여 중인 학급이 없습니다)";
        opt.disabled = true;
        select.appendChild(opt);
    } else {
        Array.from(activeClasses).sort().forEach(cls => {
            const opt = document.createElement('option');
            opt.value = cls;
            opt.text = cls;
            select.appendChild(opt);
        });
    }

    modal.style.display = 'block';
    bulkReturnCart = [];
    document.getElementById('bulkReturnItemBody').innerHTML = '';
    document.getElementById('bulkReturnTargetDisplay').innerText = '반납자: 학급을 선택해주세요';
    renderBulkReturnCart();

    // Auto-select and lock for non-admin users
    if (!isAdminMode() && dataManager.currentUser) {
        if (activeClasses.has(dataManager.currentUser.id)) {
            select.value = dataManager.currentUser.id;
            select.disabled = true; // Lock the dropdown
            onBulkReturnClassChange(); // Load list immediately
        }
    }
};

window.closeBulkReturnModal = () => {
    document.getElementById('bulkReturnModal').style.display = 'none';
    bulkReturnCart = [];
};

window.onBulkReturnClassChange = () => {
    const select = document.getElementById('bulkReturnClassSelect');
    const className = select.value;
    const display = document.getElementById('bulkReturnTargetDisplay');

    if (className) {
        display.innerText = `반납자: ${className}`;
        renderBulkReturnItems(className);
    } else {
        display.innerText = '반납자: 학급을 선택해주세요';
        document.getElementById('bulkReturnItemBody').innerHTML = '';
    }

    // Reset cart when class changes (safety)
    bulkReturnCart = [];
    renderBulkReturnCart();
};

window.renderBulkReturnItems = (className) => {
    const tbody = document.getElementById('bulkReturnItemBody');
    tbody.innerHTML = '';

    // Find items rented by this class
    const rentedItems = [];
    dataManager.inventory.forEach(item => {
        if (!item.rentals) return;

        // Aggregate active rental count for this class
        const totalRented = item.rentals
            .filter(r => (r.class === className || r.requester === className) && !r.returned)
            .reduce((sum, r) => sum + (r.count || 0), 0);

        if (totalRented > 0) {
            rentedItems.push({
                ...item,
                rentedCount: totalRented
            });
        }
    });

    if (rentedItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; color:#94a3b8;">대여 중인 물품이 없습니다.</td></tr>';
        return;
    }

    rentedItems.forEach(item => {
        // Calculate remaining rent count (Total Rented - Already in Return Cart)
        const cartItem = bulkReturnCart.find(c => c.itemId === item.id);
        const inCart = cartItem ? cartItem.count : 0;
        const availableReturn = item.rentedCount - inCart;

        // Skip if 0 available to return (optional: show disabled)
        // if (availableReturn <= 0) return;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div style="font-weight:600;">${item.name}</div>
                <div style="font-size:0.8rem; color:#64748b;">대여중: ${item.rentedCount}개</div>
            </td>
            <td style="text-align:center; color: var(--danger); font-weight:600;">${item.rentedCount}</td>
            <td style="text-align:center;">
                <div class="bulk-qty-control">
                    <button class="qty-btn" onclick="updateBulkReturnQty(${item.id}, -1)">-</button>
                    <input type="number" id="bulk-return-qty-${item.id}" value="${availableReturn}" min="1" max="${availableReturn}" class="qty-display" readonly>
                    <button class="qty-btn" onclick="updateBulkReturnQty(${item.id}, 1, ${availableReturn})">+</button>
                </div>
            </td>
            <td style="text-align:center;">
                <button class="bulk-add-btn" onclick="addToBulkReturnCart(${item.id}, ${availableReturn}, '${className}')">담기</button>
            </td>
        `;
        tbody.appendChild(row);
    });
};

window.updateBulkReturnQty = (id, delta, max) => {
    const input = document.getElementById(`bulk-return-qty-${id}`);
    if (!input) return;
    let val = parseInt(input.value) || 1;
    val += delta;
    if (val < 1) val = 1;
    if (max && val > max) val = max;
    input.value = val;
};

window.addToBulkReturnCart = (itemId, maxReturnable, className) => {
    const qtyInput = document.getElementById(`bulk-return-qty-${itemId}`);
    const qtyToAdd = parseInt(qtyInput.value) || 1;

    if (qtyToAdd > maxReturnable) {
        alert('반납 가능 수량을 초과할 수 없습니다.');
        return;
    }

    const item = dataManager.inventory.find(i => i.id === itemId);
    const existing = bulkReturnCart.find(c => c.itemId === itemId);

    if (existing) {
        existing.count += qtyToAdd;
    } else {
        bulkReturnCart.push({
            itemId: item.id,
            name: item.name,
            location: item.location,
            count: qtyToAdd,
            max: maxReturnable, // Store max for cart editing
            className: className
        });
    }

    renderBulkReturnItems(className);
    renderBulkReturnCart();
};

window.removeFromBulkReturnCart = (itemId) => {
    bulkReturnCart = bulkReturnCart.filter(c => c.itemId !== itemId);
    const className = document.getElementById('bulkReturnClassSelect').value;
    renderBulkReturnItems(className);
    renderBulkReturnCart();
};

// Update Logic for CART (Return)
window.updateBulkReturnCartQty = (itemId, delta) => {
    const cartItem = bulkReturnCart.find(c => c.itemId === itemId);
    if (!cartItem) return;

    // We need to know the 'true max' which is (Remaining in list + Current in cart)
    // But simplistically: The item knows its 'rentedCount'.
    // Max for this cart item = Total Rented by class

    // Find original item to get total rented
    const item = dataManager.inventory.find(i => i.id === itemId);
    const totalRented = item ? item.rentals
        .filter(r => (r.class === cartItem.className || r.requester === cartItem.className) && !r.returned)
        .reduce((sum, r) => sum + (r.count || 0), 0) : cartItem.count;

    let newCount = cartItem.count + delta;
    if (newCount < 1) newCount = 1;
    if (newCount > totalRented) newCount = totalRented;

    cartItem.count = newCount;

    const className = document.getElementById('bulkReturnClassSelect').value;
    renderBulkReturnItems(className); // Update available counts in list
    renderBulkReturnCart();
};

window.renderBulkReturnCart = () => {
    const tbody = document.getElementById('bulkReturnCartBody');
    const emptyMsg = document.getElementById('bulkReturnCartEmpty');
    const countBadge = document.getElementById('bulkReturnCartCount');

    tbody.innerHTML = '';
    countBadge.innerText = `${bulkReturnCart.length}종`;

    if (bulkReturnCart.length === 0) {
        emptyMsg.style.display = 'block';
    } else {
        emptyMsg.style.display = 'none';
        bulkReturnCart.forEach(c => {
            // Find total rented again for max calculation in UI
            const item = dataManager.inventory.find(i => i.id === c.itemId);
            const totalRented = item ? item.rentals
                .filter(r => (r.class === c.className || r.requester === c.className) && !r.returned)
                .reduce((sum, r) => sum + (r.count || 0), 0) : c.count;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div style="font-weight:600;">${c.name}</div>
                    <div style="font-size:0.8rem; color:#64748b;">${c.location}</div>
                </td>
                <td style="text-align:center;">-</td>
                <td style="text-align:center;">
                    <div class="bulk-qty-control">
                        <button class="qty-btn" onclick="updateBulkReturnCartQty(${c.itemId}, -1)">-</button>
                        <span style="width:30px; text-align:center; font-weight:bold;">${c.count}</span>
                        <button class="qty-btn" onclick="updateBulkReturnCartQty(${c.itemId}, 1)">+</button>
                    </div>
                </td>
                <td style="text-align:center;">
                    <button class="qty-btn" style="color:#ef4444; border-color:#ef4444;" onclick="removeFromBulkReturnCart(${c.itemId})">
                        <i data-lucide="trash-2" style="width:14px;"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
        if (window.lucide) lucide.createIcons();
    }
};

window.submitBulkReturn = async () => {
    const className = document.getElementById('bulkReturnClassSelect').value;

    if (bulkReturnCart.length === 0) {
        alert('반납할 물품이 없습니다.');
        return;
    }
    if (!className) {
        alert('학급이 선택되지 않았습니다.');
        return;
    }

    if (!confirm(`[${className}]의 물품 ${bulkReturnCart.length}종을 일괄 반납하시겠습니까?`)) return;

    const btn = document.querySelector('#bulkReturnModal .btn-primary');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = '처리 중...';

    let successCount = 0;
    let failCount = 0;

    try {
        for (const cartItem of bulkReturnCart) {
            const payload = {
                itemId: cartItem.itemId,
                class: className,
                count: cartItem.count
            };

            // Client-side Update is handled by dataManager.sync internally now
            /* dataManager.applyLocalUpdate('partialReturn', payload); */

            try {
                // Server Sync
                await dataManager.sync('partialReturn', payload);
                successCount++;
            } catch (innerErr) {
                console.error(innerErr);
                failCount++;
            }

            await new Promise(r => setTimeout(r, 300));
        }

        // Add Summary Log
        if (successCount > 0) {
            const firstItemName = bulkReturnCart[0].name;
            const extraCount = successCount - 1;
            const logMsg = extraCount > 0
                ? `${className}에서 ${firstItemName} 외 ${extraCount}건을 일괄 반납하였습니다.`
                : `${className}에서 ${firstItemName}을(를) 일괄 반납하였습니다.`;

            await dataManager.sync('logActivity', { message: logMsg });
        }

        closeBulkRentalModal();

        // Robust UI Refresh
        try {
            renderRecentActivity();
            initInventory();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
        } catch (uiErr) {
            console.warn('UI Refresh failed after action', uiErr);
        }

        if (failCount > 0) {
            alert(`일괄 반납이 완료되었으나, ${failCount}건의 동기화가 지연될 수 있습니다.`);
        } else {
            alert('일괄 반납이 완료되었습니다.');
        }

    } catch (e) {
        console.error(e);
        alert('오류가 발생했습니다.');
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
};

window.showRegisterModal = () => {
    closeAuthModals();
    document.getElementById('registerModal').style.display = 'block';
};

// ✅ Explicit State Transition Function
window.enterAppMode = () => {
    console.log('[DEBUG] enterAppMode called');

    // 1. DOM State Switch
    document.body.classList.remove('auth-mode');
    document.body.classList.add('app-mode');

    const authSec = document.getElementById('authSection');
    const mainSec = document.getElementById('mainAppSection');

    if (authSec) authSec.style.display = 'none';
    if (mainSec) mainSec.style.display = 'flex'; // Ensure Flexbox layout

    // 2. Data & UI Initialization
    updateView(); // Updates user info in header, etc.

    // Initialize specific components if they haven't been loaded
    if (typeof updateDashboardStats === 'function') updateDashboardStats();
    if (typeof renderRecentActivity === 'function') renderRecentActivity();
    if (typeof updateAdminState === 'function') updateAdminState();

    console.log('[DEBUG] enterAppMode completed');
};

// ✅ Explicit Login Result Modal Helper
window.showLoginResultModal = (isSuccess, message) => {
    const modal = document.getElementById('loginResultModal');
    const icon = document.getElementById('loginResultIcon');
    const title = document.getElementById('loginResultTitle');
    const msg = document.getElementById('loginResultMessage');
    const btn = document.getElementById('loginResultBtn');

    if (!modal || !icon || !title || !msg || !btn) return;

    if (isSuccess) {
        icon.setAttribute('data-lucide', 'check-circle');
        icon.style.color = 'var(--primary)';
        title.innerText = '로그인 성공';
        btn.onclick = () => {
            modal.style.display = 'none';
            enterAppMode(); // Trigger transition only after user confirmation
        };
    } else {
        icon.setAttribute('data-lucide', 'x-circle');
        icon.style.color = 'var(--danger)';
        title.innerText = '로그인 실패';
        btn.onclick = () => {
            modal.style.display = 'none';
        };
    }

    msg.innerText = message;
    lucide.createIcons(); // Refresh icon
    modal.style.display = 'block';
};

window.submitLogin = async () => {
    console.log('[DEBUG] submitLogin called');
    const id = document.getElementById('loginUserSelect').value;
    const pw = document.getElementById('loginPassword').value;

    if (!id || !pw) return alert('아이디와 비밀번호를 모두 입력해주세요.');

    try {
        const res = await dataManager.login(id, pw);

        if (res.success) {
            console.log('[DEBUG] Login successful');

            // 1. Close Modal immediately
            closeAuthModals();

            // 2. Force Data Loaded State
            dataManager.isLoaded = true;

            // 3. Show Success Modal instead of auto-transition
            // enterAppMode(); <-- Commented out for Modal flow

            /* Old Alert Logic Commented Out
            setTimeout(() => {
                if (typeof showConnectionStatus === 'function') {
                    showConnectionStatus(true, `환영합니다, ${res.name || id} 선생님!`);
                }
            }, 500);
            */

            showLoginResultModal(true, `환영합니다, ${res.name || id} 선생님!`);

        } else {
            console.warn('[DEBUG] Login failed:', res.message);
            // alert(res.message || '로그인 실패'); <-- Old Alert Commented Out
            showLoginResultModal(false, res.message || '로그인 실패');
        }
    } catch (e) {
        console.error('[CRITICAL] Login Error:', e);
        // alert('로그인 처리 중 오류가 발생했습니다.'); <-- Old Alert Commented Out
        showLoginResultModal(false, '로그인 처리 중 오류가 발생했습니다.');
    }
};

window.submitRegister = async () => {
    const id = document.getElementById('regId').value;
    const name = document.getElementById('regName').value;
    const pw = document.getElementById('regPassword').value;
    const cpw = document.getElementById('regConfirmPassword').value;

    if (!id || !pw || !cpw) return alert('필수 항목을 모두 입력해주세요.');
    if (pw !== cpw) return alert('비밀번호가 일치하지 않습니다.');
    if (!/^\d{4}$/.test(pw)) return alert('비밀번호는 숫자 4자리여야 합니다.');

    const res = await dataManager.register({ id, name, password: pw });
    if (res.success) {
        // alert('회원 신청이 완료되었습니다. 관리자 승인 후 이용 가능합니다.');
        showLoginResultModal(true, '회원 신청이 완료되었습니다. 승인 대기중.');
        closeAuthModals();
        showLoginModal();
    } else {
        // alert(res.message || '회원 신청 중 오류가 발생했습니다.');
        showLoginResultModal(false, res.message || '회원 신청 오류');
    }
};

window.handleLogout = () => {
    if (confirm('로그아웃 하시겠습니까?')) {
        dataManager.logout();
        updateView();
        location.reload(); // Reset everything
    }
};

window.showProfileEditModal = () => {
    const user = dataManager.currentUser;
    if (!user) return;

    document.getElementById('editId').value = user.id;
    document.getElementById('editName').value = user.name || '';
    document.getElementById('editPassword').value = '';
    document.getElementById('profileEditModal').style.display = 'block';
};

window.submitProfileEdit = async () => {
    const name = document.getElementById('editName').value;
    const pw = document.getElementById('editPassword').value;

    if (pw && !/^\d{4}$/.test(pw)) return alert('비밀번호는 숫자 4자리여야 합니다.');

    const payload = {
        name,
        password: pw || undefined // Only send if changed
    };

    try {
        await dataManager.sync('updateProfile', { id: dataManager.currentUser.id, data: payload });
        // alert('정보가 수정되었습니다. 다음 로그인 때 반영될 수 있습니다.');
        showLoginResultModal(true, '정보가 수정되었습니다.');
        closeAuthModals();

        // Update local session
        dataManager.currentUser.name = name;
        if (typeof STORAGE_KEYS !== 'undefined') {
            localStorage.setItem(STORAGE_KEYS.USER_SESSION, JSON.stringify(dataManager.currentUser));
        } else {
            localStorage.setItem('gs_user_session', JSON.stringify(dataManager.currentUser));
        }
    } catch (err) {
        // alert('수정 중 오류가 발생했습니다.');
        showLoginResultModal(false, '수정 중 오류가 발생했습니다.');
    }
};
