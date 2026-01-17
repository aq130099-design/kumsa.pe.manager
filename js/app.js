/**
 * UI Controller for Geumsa P.E. System
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Show loading state
    const body = document.body;
    const loader = document.createElement('div');
    loader.id = 'appLoader';
    loader.innerHTML = '<div class="spinner"></div><p>구글 시트에서 데이터를 불러오는 중...</p>';
    body.appendChild(loader);

    await dataManager.init();

    // Remove loader
    loader.remove();

    // Show connection status
    showConnectionStatus(dataManager.isCloudConnected);

    initDashboard();
    initTabs();
    initTimetable();
    initInventory();
    initRequests();
    initRepairs();
    initAdminMode();
    updateDateDisplay();
    updateAdminState(); // Force UI to match initial admin state (hidden stats)
});

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

function updateDashboardStats() {
    // 대기 중인 승인: weeklySchedule 중 status 가 '대기'인 것
    const pendingCount = dataManager.weeklySchedule.filter(s => s.status === '대기').length;

    // 미반납 비품: inventory 대여 중 returned 가 false 인 대여 건수 합계
    const unreturnedCount = dataManager.inventory.reduce((sum, item) => {
        return sum + item.rentals.filter(r => !r.returned).length;
    }, 0);

    const pendingEl = document.getElementById('statPendingApprovals');
    if (pendingEl) pendingEl.innerText = `${pendingCount}건`;

    document.getElementById('statUnreturnedItems').innerText = `${unreturnedCount}건`;

    // 1. Purchase Requests (구매)
    const purchases = dataManager.adminRequests.filter(r => r.type === '구매');
    const purPending = purchases.filter(r => r.status === '대기').length;
    const purProgress = purchases.filter(r => r.status === '진행').length;

    const purPendingEl = document.getElementById('statPurchasePending');
    const purProgressEl = document.getElementById('statPurchaseProgress');
    if (purPendingEl) purPendingEl.innerText = `대기 ${purPending}건`;
    if (purProgressEl) purProgressEl.innerText = `진행 ${purProgress}건`;

    // 2. Repair Requests (수리) -> from Inventory
    let repairPending = 0;
    let repairProgress = 0;
    dataManager.inventory.forEach(item => {
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

    // 3. Bug Reports (버그)
    const bugs = dataManager.adminRequests.filter(r => r.type === '버그');
    const bugPending = bugs.filter(r => r.status === '대기').length;
    const bugProgress = bugs.filter(r => r.status === '진행').length;

    const bugPendingEl = document.getElementById('statBugPending');
    const bugProgressEl = document.getElementById('statBugProgress');
    if (bugPendingEl) bugPendingEl.innerText = `대기 ${bugPending}건`;
    if (bugProgressEl) bugProgressEl.innerText = `진행 ${bugProgress}건`;
}

// Tab Management
function initTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Handle Admin Management Sidebar Click separately
            const tabId = item.getAttribute('data-tab');

            if (tabId === 'adminManage') {
                // Trigger render when tab is clicked
                renderAdminManage();
            }

            navItems.forEach(nav => nav.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            item.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            document.getElementById('pageTitle').innerText = item.innerText.trim();
        });
    });
}

// Timetable Rendering
function initTimetable() {
    const dateInput = document.getElementById('timetableDate');
    const filterBtns = document.querySelectorAll('.filter-btn');

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

function showDetailModal(booking, isSpecial) {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '예약 상세 정보';

    const isAdmin = isAdminMode();
    const isPending = !booking.status || booking.status === '대기';

    form.innerHTML = `
        <div class="detail-info">
            <div class="info-row"><span>장소</span><strong>${booking.location}</strong></div>
            <div class="info-row"><span>교시</span><strong>${booking.period}</strong></div>
            <div class="info-row"><span>학급</span><strong>${booking.class}</strong></div>
            <div class="info-row"><span>상태</span><span class="badge ${isPending ? 'badge-pending' : 'badge-done'}">${booking.status}</span></div>
            ${isSpecial ? '<div class="info-row"><span>구분</span><strong>특별 예약</strong></div>' : ''}
        </div>
        <div class="modal-actions">
            ${isAdmin && isPending ? `
                <button type="button" class="btn btn-primary" onclick="approveAndClose(${booking.id})">승인하기</button>
                <button type="button" class="btn btn-danger" onclick="deleteAndClose(${booking.id})">반려/삭제</button>
            ` : ''}
            <button type="button" class="btn" style="background: #e2e8f0;" onclick="closeModal()">닫기</button>
        </div>
    `;
    form.onsubmit = (e) => e.preventDefault();
}

// Global helper for modal actions
window.approveAndClose = async (id) => {
    const booking = dataManager.weeklySchedule.find(b => b.id === id);
    await dataManager.sync('approveBooking', { id });

    if (booking) {
        const dateStr = formatDateForLog(booking.date);
        const msg = `${booking.class}에서 신청한 ${dateStr} ${booking.period} ${booking.location} 사용이 승인되었습니다.`;
        dataManager.sync('logActivity', { message: msg });
        renderRecentActivity();
    }

    closeModal();
    renderTimetable();
    updateDashboardStats();
    alert('승인되었습니다.');
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
    lucide.createIcons();
    renderTimetable();
    updateDashboardStats();
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
                <label>내용 (예: 1-1, 1학년 전체 등)</label>
                <input type="text" id="targetClass" required>
            </div>
            <button type="submit" class="btn btn-primary">신청하기</button>
        `;
    } else {
        document.getElementById('modalTitle').innerText = `${period} 예약 (${location})`;
        form.innerHTML = `
            <div class="form-group">
                <label>신청 학급</label>
                <input type="text" id="targetClass" placeholder="예: 5-2" required>
            </div>
            <button type="submit" class="btn btn-primary">신청하기</button>
        `;
    }

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const targetClass = document.getElementById('targetClass').value;
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
                    <button class="btn btn-sm" style="background: #f1f5f9;" onclick="showReturnListModal(${item.id})">반납</button>` : ''}
                    ${isAdmin ? `
                    <button class="btn btn-sm" style="background: #e2e8f0;" onclick="showEditInventoryModal('${item.id}')">수정</button>
                    <button class="btn btn-danger btn-sm" onclick="confirmDeleteInventoryItem(${item.id})">삭제</button>` : ''}
                </div>
            </td>
        `;

        tbody.appendChild(tr);
    });
    lucide.createIcons();
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
            <label>대여 학급</label>
            <input type="text" id="rentalClass" placeholder="예: 3-1" required>
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
        const targetClass = document.getElementById('rentalClass').value;
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

    const activeRentals = item.rentals.filter(r => !r.returned);

    let listHtml = '<div class="return-list">';
    activeRentals.forEach(r => {
        listHtml += `
            <div class="return-item">
                <span><b>${r.class}</b> (${r.count}개)</span>
                <button type="button" class="btn btn-primary btn-sm" onclick="processReturn(${item.id}, ${r.id})">반납</button>
            </div>
        `;
    });
    listHtml += '</div>';

    form.innerHTML = `
        ${listHtml}
        <div class="modal-actions">
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;
    form.onsubmit = (e) => e.preventDefault();
    lucide.createIcons();
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
        lucide.createIcons();
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
    lucide.createIcons();
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
    lucide.createIcons();
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
    lucide.createIcons();
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
    lucide.createIcons();
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
            <label>신청자 (학급/이름)</label>
            <input type="text" id="repairRequester" required placeholder="예: 6-1 홍길동">
        </div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-primary">요청하기</button>
            <button type="button" class="btn" onclick="closeModal()">취소</button>
        </div>
    `;
    lucide.createIcons();

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
        lucide.createIcons();
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
                requester: document.getElementById('repairRequester').value,
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
            <label>신청자</label>
            <input type="text" id="newReqRequester" placeholder="이름" required>
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
                requester: document.getElementById('newReqRequester').value
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


// Admin Mode
function initAdminMode() {
    const toggle = document.getElementById('adminModeToggle');
    if (!toggle) return;

    toggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            // Turning ON
            if (!dataManager.currentUser) {
                e.preventDefault();
                e.target.checked = false; // Revert visual
                showLoginModal();
            } else {
                updateAdminState();
            }
        } else {
            // Turning OFF
            if (confirm('관리자 모드를 종료하고 로그아웃 하시겠습니까?')) {
                dataManager.logout();
                updateAdminState();
                initInventory();
            } else {
                e.preventDefault();
                e.target.checked = true; // Revert
            }
        }
    });
}

function updateAdminState() {
    const isAdmin = isAdminMode();
    const toggle = document.getElementById('adminModeToggle');

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
    const isMaster = dataManager.currentUser && dataManager.currentUser.role === 'master';
    const adminSidebarBtn = document.getElementById('adminManageSidebarBtn');
    if (adminSidebarBtn) {
        adminSidebarBtn.style.display = isMaster && isAdmin ? 'flex' : 'none';
    }

    // Toggle Dashboard Stats Grid
    const statsGrid = document.getElementById('dashboardStatsGrid');
    if (statsGrid) {
        statsGrid.style.display = isAdmin ? 'grid' : 'none';
    }
}

// ==========================================
// Base Schedule Editor Logic
// ==========================================
let tempBaseSchedule = [];
let currentBaseLocation = '체육관';

window.showBaseScheduleEditor = () => {
    document.getElementById('baseScheduleModal').style.display = 'block';

    // Deep copy current base schedule to temp
    tempBaseSchedule = JSON.parse(JSON.stringify(dataManager.baseSchedule));

    currentBaseLocation = '체육관';

    // Reset UI
    const tabs = document.querySelectorAll('#baseScheduleModal .tab-btn');
    tabs.forEach(t => t.classList.remove('active'));
    tabs[0].classList.add('active'); // First one (Gym)

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
    const days = ['월요일', '화요일', '수요일', '목요일', '금요일'];
    let thead = '<thead><tr><th style="width: 80px;">교시</th>';
    days.forEach(d => thead += `<th>${d}</th>`);
    thead += '</tr></thead>';

    // Body
    let tbody = '<tbody>';
    const periods = ['1교시', '2교시', '3교시', '4교시', '점심시간', '5교시', '6교시'];

    periods.forEach(p => {
        tbody += `<tr><td style="font-weight:bold; text-align:center;">${p}</td>`;
        days.forEach(d => {
            // Find existing in temp buffer
            const found = tempBaseSchedule.find(s => s.day === d && s.period === p && s.location === loc);
            const val = found ? found.class : '';

            tbody += `
                <td style="padding: 0;">
                    <input type="text" 
                        class="base-input" 
                        data-day="${d}" 
                        data-period="${p}" 
                        data-loc="${loc}" 
                        value="${val}" 
                        placeholder="-"
                        style="width: 100%; border: none; padding: 12px; text-align: center; background: transparent;">
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
    return document.getElementById('adminModeToggle').checked;
}

function updateDateDisplay() {
    const now = new Date();
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' };
    document.getElementById('currentDateDisplay').innerText = now.toLocaleDateString('ko-KR', options);
}

function showConnectionStatus(isCloud) {
    const statusDiv = document.createElement('div');
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '1rem';
    statusDiv.style.right = '1rem';
    statusDiv.style.padding = '0.5rem 1rem';
    statusDiv.style.borderRadius = '20px';
    statusDiv.style.fontSize = '0.85rem';
    statusDiv.style.fontWeight = '600';
    statusDiv.style.zIndex = '9999';
    statusDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
    statusDiv.style.transition = 'all 0.3s ease';

    if (isCloud) {
        statusDiv.style.background = '#e0f2fe';
        statusDiv.style.color = '#0284c7';
        statusDiv.innerHTML = '<i data-lucide="cloud" style="vertical-align: text-bottom; margin-right: 4px; width: 16px;"></i> 클라우드 연결됨';
    } else {
        statusDiv.style.background = '#fef2f2';
        statusDiv.style.color = '#ef4444';
        statusDiv.innerHTML = '<i data-lucide="wifi-off" style="vertical-align: text-bottom; margin-right: 4px; width: 16px;"></i> 오프라인 모드';
    }

    document.body.appendChild(statusDiv);
    lucide.createIcons();

    // Fade out after 5 seconds
    setTimeout(() => {
        statusDiv.style.opacity = '0.5';
    }, 5000);
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

window.showLoginModal = () => {
    modal.style.display = 'block';
    const form = document.getElementById('modalForm');
    document.getElementById('modalTitle').innerText = '관리자 로그인';

    // Dropdown options
    const options = dataManager.admins.map(a => `<option value="${a.id}">${a.id}</option>`).join('');

    form.innerHTML = `
        <div class="form-group">
            <label>관리자 선택</label>
            <select id="loginId" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px;">
                <option value="" disabled selected>선택하세요</option>
                ${options}
            </select>
        </div>
        <div class="form-group">
            <label>비밀번호 (숫자 4자리)</label>
            <input type="password" id="loginPw" maxlength="4" placeholder="****" required style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px;">
        </div>
        <div class="modal-actions" style="flex-wrap: wrap;">
            <button type="submit" class="btn btn-primary" style="flex: 1;">로그인</button>
            <button type="button" class="btn" onclick="closeModal()">취소</button>
        </div>
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; display: flex; gap: 8px; justify-content: center;">
            <button type="button" class="btn btn-sm" onclick="showRegisterModal()">관리자 등록</button>
            <button type="button" class="btn btn-sm" onclick="showChangePasswordModal()">비밀번호 변경</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = '로그인 중...';
        }

        const id = document.getElementById('loginId').value;
        const pw = document.getElementById('loginPw').value;

        try {
            if (!id) throw new Error('관리자를 선택해주세요.');

            const result = await dataManager.login(id, pw);
            if (result.success) {
                document.getElementById('adminModeToggle').checked = true;
                closeModal();
                updateAdminState();
                alert(`환영합니다, ${id}님 (${result.role})`);
            } else {
                alert(result.message || '로그인 실패');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = '로그인';
                }
            }
        } catch (err) {
            alert(err.message || '로그인 처리 중 오류 발생');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = '로그인';
            }
        }
    };
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
    const container = document.getElementById('adminListContainer');
    if (!container) return;

    container.innerHTML = '<p style="padding: 1rem; text-align: center;">데이터 로딩 중...</p>';

    // Force refresh data
    await dataManager.init();

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
             </select>`;

        return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f1f5f9; background: white;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-weight: 600; font-size: 1.05rem;">${user.id}</span> 
                ${roleSelect}
            </div>
            <div>
                ${isPending ? `<button class="btn btn-sm btn-primary" onclick="confirmAdminAction('${user.id}', 'approve')">승인</button>` : ''}
                ${user.status !== 'master' || (user.status === 'master' && dataManager.currentUser.id !== user.id) ? `<button class="btn btn-sm btn-danger" onclick="confirmAdminAction('${user.id}', 'delete')">삭제</button>` : ''}
            </div>
        </div>
        `;
    }).join('');

    container.innerHTML = `<div style="background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">${listHtml}</div>`;
};

window.confirmAdminAction = async (targetId, action) => {
    if (!confirm(`${targetId} 사용자에 대해 '${action}' 작업을 수행하시겠습니까?`)) return;

    await dataManager.sync('adminAction', { targetId, act: action });
    await dataManager.init();

    // Refresh Tab Panel instead of Modal
    renderAdminManage();
};

window.changeAdminRole = async (targetId, newRole) => {
    if (!confirm(`${targetId} 사용자의 권한을 '${newRole}'(으)로 변경하시겠습니까?`)) {
        renderAdminManage(); // Revert selection if cancelled
        return;
    }

    await dataManager.sync('adminAction', { targetId, act: 'update_role', data: { role: newRole } });
    await dataManager.init();
    renderAdminManage();
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
            const base = dataManager.baseSchedule.find(s =>
                s.day === dayName && s.period === period && s.location === dashboardFacility
            );
            const baseClass = base ? base.class : '';

            // 2. Get Special Requests (Approved or Pending)
            const specials = dataManager.weeklySchedule.filter(s => {
                if (!s.date) return false;
                let recordDate = s.date;
                // Handle ISO string from Sheets (which comes as UTC or ISO)
                if (typeof s.date === 'string' && s.date.includes('T')) {
                    const d = new Date(s.date);
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    recordDate = `${year}-${month}-${day}`;
                }
                return recordDate === dateStr && s.period === period && s.location === dashboardFacility;
            });

            // Logic: 
            // - If Approved exists, it OVERRIDES Base.
            // - If Pending exists, it shows BELOW Base (or alone).

            const approved = specials.find(s => s.status === '승인');
            const pendings = specials.filter(s => s.status === '대기');

            let cellContent = '';

            if (approved) {
                // Approved overrides everything
                cellContent = `<span class="cell-special-approved">${approved.class}</span>`;
            } else {
                // Show Base
                if (baseClass) {
                    cellContent += `<span style="color: #64748b;">${baseClass}</span>`;
                }

                // Append Pending beneath
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

// 1. Pending Timetable Approvals Modal
window.showPendingApprovalsModal = () => {
    const pendings = dataManager.weeklySchedule.filter(s => s.status === '대기');

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
    pendings.forEach(p => {
        let displayDate = p.date;
        if (p.date && p.date.includes('T')) {
            const d = new Date(p.date);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            displayDate = `${year}-${month}-${day}`;
        }

        listHtml += `
            <div class="return-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border);">
                <div>
                    <div style="font-weight: 600;">${displayDate} (${p.period})</div>
                    <div style="font-size: 0.9rem; color: var(--text-muted);">${p.location} - ${p.class}</div>
                </div>
                <button type="button" class="btn btn-primary btn-sm" onclick="approveAndClose(${p.id})">승인</button>
            </div>
        `;
    });
    listHtml += '</div>';

    form.innerHTML = `
        ${listHtml}
        <div class="modal-actions">
            <button type="button" class="btn" style="background: #f1f5f9;" onclick="switchTab('timetable')">시간표 관리로 이동</button>
            <button type="button" class="btn" onclick="closeModal()">닫기</button>
        </div>
    `;
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
    // Prompt first
    const name = prompt("신청자(학년-반 또는 동아리명)를 먼저 입력해주세요:", "");
    if (name && name.trim()) {
        currentBulkRequester = name.trim();
        showBulkRentalModal();
    }
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
        lucide.createIcons();
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
            renderDashboardStats(); // Refresh stats
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

                    // Filter out bad data (dates, empty strings)
                    if (name && typeof name === 'string' && name.length < 20 && !dateRegex.test(name)) {
                        activeClasses.add(name);
                    }
                }
            });
        }
    });

    select.innerHTML = '<option value="">반납할 학급 선택 (대여 중인 반만 표시됨)</option>';
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
        lucide.createIcons();
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
            renderDashboardStats();
        } catch (uiErr) {
            console.warn('UI Refresh failed after return', uiErr);
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
