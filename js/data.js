/**
 * Data Management for Geumsa P.E. System
 */

const API_URL = "https://script.google.com/macros/s/AKfycbzF-YU-_3O9x1_0T_YohyyfMP3tO7uZyZa-WYRurfVktF6pOw-4YbSYadOzSo7oGa3F/exec";

const STORAGE_KEYS = {
    BASE_SCHEDULE: 'gs_base_schedule',
    WEEKLY_SCHEDULE: 'gs_weekly_schedule',
    WEEKLY_SCHEDULE: 'gs_weekly_schedule',
    INVENTORY: 'gs_inventory',
    RENTALS: 'gs_rentals',
    ADMIN_REQUESTS: 'gs_admin_requests',
    LOCATIONS: 'gs_locations',
    ACTIVITY_LOGS: 'gs_activity_logs'
};

const defaultLocations = [
    '체육전담실',
    '체육관 무대 옆 창고',
    '체육관 무대 뒤 창고'
];

// Seed Data
// Seed Data
const defaultBaseSchedule = [];

const defaultInventory = [];

const defaultAdminRequests = [];

class DataManager {
    constructor() {
        this.baseSchedule = [];
        this.weeklySchedule = [];
        this.inventory = [];
        this.adminRequests = [];
        this.locations = [];
        this.activityLogs = [];
        this.isLoaded = false;
        this.isCloudConnected = false;
        this.admins = [];
        this.currentUser = null;
    }

    async init() {
        try {
            const response = await this.fetchWithTimeout(API_URL, { method: 'GET' }, 10000); // 10s timeout
            const data = await response.json();

            this.baseSchedule = data.baseSchedule || [];
            this.weeklySchedule = data.weeklySchedule || [];

            // Robust Inventory Parsing
            this.inventory = (data.inventory || []).map(item => ({
                ...item,
                rentals: Array.isArray(item.rentals) ? item.rentals : [],
                repairs: Array.isArray(item.repairs) ? item.repairs : []
            }));

            this.admins = data.admins || [];
            this.adminRequests = data.adminRequests || [];
            this.locations = data.locations || defaultLocations;
            this.activityLogs = data.activityLogs || [];

            this.isLoaded = true;
            this.isCloudConnected = true;
            console.log("Data loaded from Google Sheets");
        } catch (error) {
            console.error("Failed to load data from Google Sheets, using local fallback", error);
            this.loadFromLocal();
        }
    }

    async fetchWithTimeout(resource, options = {}, timeout = 10000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    }

    async login(id, password) {
        try {
            const response = await this.fetchWithTimeout(API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'login', id, password })
            }, 8000); // 8s timeout for login
            const result = await response.json();
            if (result.success) {
                this.currentUser = { id, role: result.role };
            }
            return result;
        } catch (e) {
            console.error(e);
            return { success: false, message: "서버 연결 오류 / 타임아웃" };
        }
    }

    logout() {
        this.currentUser = null;
    }

    loadFromLocal() {
        this.baseSchedule = JSON.parse(localStorage.getItem(STORAGE_KEYS.BASE_SCHEDULE)) || defaultBaseSchedule;
        this.weeklySchedule = JSON.parse(localStorage.getItem(STORAGE_KEYS.WEEKLY_SCHEDULE)) || [];
        this.inventory = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVENTORY)) || defaultInventory;
        this.adminRequests = JSON.parse(localStorage.getItem(STORAGE_KEYS.ADMIN_REQUESTS)) || defaultAdminRequests;
        this.locations = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCATIONS)) || defaultLocations;
        this.activityLogs = JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVITY_LOGS)) || [];
        this.isLoaded = true;
        this.isCloudConnected = false;
    }

    async sync(action, payload) {
        try {
            // Optimistic update locally
            this.applyLocalUpdate(action, payload);

            // Sync to Google Sheets
            // Fire and forget (optional await) or wait? 
            // For stability, we generally don't block UI on sync unless critical, 
            // but fetching logic uses it.
            // Using fetchWithTimeout but logic here is 'no-cors' for GAS simple triggers sometimes, 
            // but we use 'POST' with body.

            await this.fetchWithTimeout(API_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({ action, ...payload })
            }, 10000);

            console.log(`Synced action: ${action}`);
        } catch (error) {
            console.error(`Sync failed for ${action}:`, error);
        }
    }

    applyLocalUpdate(action, payload) {
        // GAS sync will eventually refresh everything, but we update locally for immediate feedback
        if (action === 'addBooking') {
            const id = Date.now();
            payload.data.id = id;
            payload.data.status = '대기'; // Ensure status is sent
            this.weeklySchedule.push({ ...payload.data });
        } else if (action === 'approveBooking') {
            const b = this.weeklySchedule.find(s => s.id == payload.id);
            if (b) b.status = '승인';
        } else if (action === 'addInventoryItem') {
            const id = Date.now();
            payload.data.id = id;
            payload.data.status = '정상'; // Ensure status is sent
            // payload.data.rentals is not needed for Sheet column if we use normalized relational table, 
            // but we can send empty string to avoid "undefined" in legacy column
            payload.data.rentals = '[]';
            this.inventory.push({ ...payload.data, rentals: [], status: '정상' });
        } else if (action === 'addRental') {
            // For addRental, payload.data needs 'returned' field
            payload.data.returned = false;
            const item = this.inventory.find(i => i.id == payload.data.item_id);
            if (item) item.rentals.push({ id: Date.now(), ...payload.data, returned: false });
        } else if (action === 'returnItem') {
            this.inventory.forEach(item => {
                const rental = item.rentals.find(r => r.id == payload.rentalId);
                if (rental) rental.returned = true;
            });
        } else if (action === 'addLocation') {
            if (!this.locations.includes(payload.location)) {
                this.locations.push(payload.location);
            }
        } else if (action === 'deleteLocation') {
            this.locations = this.locations.filter(l => l !== payload.location);
            // Cascade delete: Update items with this location to 'none'
            this.inventory.forEach(item => {
                if (item.location === payload.location) {
                    item.location = 'none';
                }
            });
        } else if (action === 'updateBulkLocation') {
            this.inventory.forEach(item => {
                if (payload.ids.includes(item.id)) {
                    item.location = payload.newLocation;
                }
            });
        } else if (action === 'addRequest') {
            const id = Date.now();
            payload.data.id = id;
            payload.data.status = '대기';
            payload.data.memo = '';
            this.adminRequests.push({ ...payload.data });
        } else if (action === 'updateRequest') {
            const req = this.adminRequests.find(r => r.id == payload.id);
            if (req) {
                req.status = payload.status;
                req.memo = payload.memo;
            }
        } else if (action === 'addRepair') {
            const item = this.inventory.find(i => i.id == payload.data.item_id);
            if (item) {
                if (!item.repairs) item.repairs = [];
                item.repairs.push({ ...payload.data, status: '대기' });
            }
        } else if (action === 'updateRepair') {
            // Find repair across all items? Or payload has item_id?
            // Usually update action might just have repair ID.
            // We iterate inventory to find the repair.
            this.inventory.forEach(item => {
                if (item.repairs) {
                    const r = item.repairs.find(rep => rep.id == payload.id);
                    if (r) {
                        if (payload.status) r.status = payload.status;
                        if (payload.admin_memo !== undefined) r.admin_memo = payload.admin_memo;
                    }
                }
            });
        } else if (action === 'deleteBooking') {
            this.weeklySchedule = this.weeklySchedule.filter(s => s.id !== payload.id);
        } else if (action === 'deleteInventoryItem') {
            this.inventory = this.inventory.filter(i => i.id != payload.id);
        } else if (action === 'deleteRequest') {
            this.adminRequests = this.adminRequests.filter(r => r.id != payload.id);
        } else if (action === 'replaceBaseSchedule') {
            this.baseSchedule = payload.schedule;
        } else if (action === 'updateInventoryItem') {
            const item = this.inventory.find(i => i.id == payload.id);
            if (item) item.quantity = payload.quantity;
        } else if (action === 'logActivity') {
            const date = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
            // Prepend new log. Keep max 20 locally.
            this.activityLogs = [{ timestamp: date, message: payload.message }, ...this.activityLogs].slice(0, 20);
        }
        // Save to local as backup
        this.saveLocalAll();
    }

    saveLocalAll() {
        localStorage.setItem(STORAGE_KEYS.BASE_SCHEDULE, JSON.stringify(this.baseSchedule));
        localStorage.setItem(STORAGE_KEYS.WEEKLY_SCHEDULE, JSON.stringify(this.weeklySchedule));
        localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(this.inventory));
        localStorage.setItem(STORAGE_KEYS.ADMIN_REQUESTS, JSON.stringify(this.adminRequests));
        localStorage.setItem(STORAGE_KEYS.LOCATIONS, JSON.stringify(this.locations));
        localStorage.setItem(STORAGE_KEYS.ACTIVITY_LOGS, JSON.stringify(this.activityLogs));
    }

    getScheduleForDate(dateString) {
        const date = new Date(dateString);
        const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        const dayOfWeek = days[date.getDay()];
        const specials = this.weeklySchedule.filter(s => {
            if (!s.date) return false;

            let recordDate = s.date;
            // Handle ISO string from Sheets (which comes as UTC)
            // Convert it back to local YYYY-MM-DD to match user's selected date
            if (s.date.includes('T')) {
                const d = new Date(s.date);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                recordDate = `${year}-${month}-${day}`;
            }

            return recordDate === dateString;
        });
        const bases = this.baseSchedule.filter(s => s.day === dayOfWeek);
        return { specials, bases };
    }
}

const dataManager = new DataManager();
