# 구글 스프레드시트 연동 가이드 (v4.0 전용)

이 가이드는 현재 버전(v4.0)의 고도화된 기능(수량 기반 대여, 다중 예약, 버그 신고 등)을 구글 스프레드시트와 실시간 연동하기 위한 절차를 설명합니다.

---

## 1단계: 구글 스프레드시트 준비

새 스프레드시트를 생성하고 아래 시트(탭)들을 만듭니다. 각 시트의 첫 번째 줄은 아래 컬럼명을 정확히 입력하세요.

### 📋 시트 구조 및 컬럼명
1.  **BaseSchedule** (기초 시간표)
    `A1: day`, `B1: period`, `C1: location`, `D1: class`
2.  **WeeklySchedule** (주간 예약)
    `A1: id`, `B1: date`, `C1: period`, `D1: location`, `E1: class`, `F1: status`
3.  **Inventory** (비품 목록)
    `A1: id`, `B1: name`, `C1: location`, `D1: quantity`, `E1: rentals` (JSON string), `F1: status`
4.  **Rentals**: `id`, `item_id`, `class`, `count`, `date`, `returned`
5.  **AdminRequests** (관리 요청)
    `A1: id`, `B1: type`, `C1: content`, `D1: requester`, `E1: status`, `F1: memo`
6.  **Locations** (위치 목록)
    `A1: name` (데이터는 A2부터 아래로 나열)

---

## 2단계: Google Apps Script 설정

1.  스프레드시트 상단 메뉴: **확장 프로그램 > Apps Script** 클릭.
2.  왼쪽 메뉴에서 기본으로 생성되어 있는 **`Code.gs`** 파일을 클릭합니다.
3.  기본적으로 들어있는 `function myFunction() {...}` 코드를 **모두 삭제**한 뒤, 아래 코드를 복사하여 그 자리에 그대로 붙여넣습니다.

```javascript
/* Google Apps Script for Geumsa P.E. System v4.1 */
const SS = SpreadsheetApp.getActiveSpreadsheet();

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const base = getSheetData("BaseSchedule");
  const weekly = getSheetData("WeeklySchedule");
  const inventory = getInventoryWithDetails();
  const requests = getSheetData("AdminRequests");
  const locationsList = ss.getSheetByName("Locations").getDataRange().getValues().slice(1).flat().filter(String);
  const admins = getAdminList(); // Fetch admin list (names only)

  return ContentService.createTextOutput(JSON.stringify({
      baseSchedule: base,
      weeklySchedule: weekly,
      inventory: inventory,
      adminRequests: requests,
      locations: locationsList.length > 0 ? locationsList : ['체육전담실', '체육관 무대 옆 창고', '체육관 무대 뒤 창고'],
      activityLogs: getLogs(),
      admins: admins
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const params = JSON.parse(e.postData.contents);
  const action = params.action;
  const data = params.data;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let result = "Success"; 

  try {
    if (action === "login") {
        return ContentService.createTextOutput(JSON.stringify(loginAdmin(params.id, params.password))).setMimeType(ContentService.MimeType.JSON);
    }
    else if (action === "register") {
        registerAdmin(params.id, params.password);
        result = JSON.stringify({ success: true });
        return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
    }
    else if (action === "changePassword") {
        changePassword(params.id, params.oldPassword, params.newPassword);
        result = JSON.stringify({ success: true });
        return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
    }
    else if (action === "adminAction") {
        manageAdmin(params.targetId, params.act, params.data);
         result = JSON.stringify({ success: true });
        return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
    }
    else if (action === "addBooking") {
        if (params.data.class) params.data.class = "'" + params.data.class;
        addRow("WeeklySchedule", params.data);
    }
    else if (action === "addInventoryItem") addRow("Inventory", params.data);
    else if (action === "approveBooking") updateStatus("WeeklySchedule", params.id, "승인");
    else if (action === "deleteBooking") {
        const sheet = ss.getSheetByName("WeeklySchedule");
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const idIndex = headers.indexOf("id");
        if (idIndex !== -1) {
            for (let i = 1; i < data.length; i++) {
                if (data[i][idIndex] == params.id) {
                     sheet.deleteRow(i + 1);
                     break;
                }
            }
        }
    }
    else if (action === "addRental") addRow("Rentals", params.data);
    else if (action === "returnItem") {
      const sheet = ss.getSheetByName("Rentals");
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == params.rentalId) {
          const returnedCol = data[0].indexOf("returned") + 1;
          sheet.getRange(i + 1, returnedCol).setValue(true);
          break;
        }
      }
    }
    else if (action === "addRequest") addRow("AdminRequests", params.data);
    else if (action === "updateRequest") updateRequestField(params.id, params.status, params.memo);
    else if (action === "logActivity") logActivity(params.message);
    else if (action === "addRepair") addRow("Repairs", params.data);
    else if (action === "updateRepair") updateRepairInfo(params.id, params.status, params.admin_memo);
    else if (action === "updateInventoryItem") updateInventoryItem(params.id, params.quantity);
    else if (action === 'addLocation') {
        const sheet = ss.getSheetByName("Locations");
        sheet.appendRow([data.location]);
        
    } else if (action === 'deleteLocation') {
        const sheet = ss.getSheetByName("Locations");
        const rows = sheet.getDataRange().getValues();
        const rowIndex = rows.findIndex(r => r[0] == data.location);
        if (rowIndex > -1) sheet.deleteRow(rowIndex + 1);

        // Cascade delete inventory location
        const invSheet = ss.getSheetByName("Inventory");
        const invData = invSheet.getDataRange().getValues();
        invData.forEach((row, i) => {
            if (i > 0 && row[2] == data.location) { 
                invSheet.getRange(i + 1, 3).setValue('none');
            }
        });

    } else if (action === 'updateBulkLocation') {
        const sheet = ss.getSheetByName("Inventory");
        const rows = sheet.getDataRange().getValues();
        rows.forEach((row, i) => {
            if (i > 0 && data.ids.includes(row[0])) { 
                sheet.getRange(i + 1, 3).setValue(data.newLocation);
            }
        });

    } else if (action === 'deleteInventoryItem') {
        const sheet = ss.getSheetByName("Inventory");
        const rows = sheet.getDataRange().getValues();
        const rowIndex = rows.findIndex(r => r[0] == params.id);
        if (rowIndex > -1) sheet.deleteRow(rowIndex + 1);

    } else if (action === 'deleteRequest') {
        const sheet = ss.getSheetByName("AdminRequests");
        const rows = sheet.getDataRange().getValues();
        const rowIndex = rows.findIndex(r => r[0] == params.id);
        if (rowIndex > -1) sheet.deleteRow(rowIndex + 1);
    } else if (action === 'replaceBaseSchedule') {
        const sheet = ss.getSheetByName("BaseSchedule");
        sheet.clearContents();
        sheet.appendRow(["day", "period", "class", "location"]); 
        
        const newRows = params.schedule.map(s => [s.day, s.period, s.class, s.location]);
        if (newRows.length > 0) {
            const range = sheet.getRange(2, 1, newRows.length, newRows[0].length);
            range.setNumberFormat("@"); 
            range.setValues(newRows);
        }
    }
    
    return ContentService.createTextOutput(result);

  } catch (error) {
    if (['login', 'register', 'changePassword', 'adminAction'].includes(action)) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput("Error: " + error.toString());
  }
}

// Helper: 시트 데이터를 JSON 객체 배열로 변환
function getSheetData(sheetName) {
  const sheet = SS.getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  return values.slice(1).map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// Helper: 비품과 대여/수리 내역을 결합하여 가져오기
function getInventoryWithDetails() {
  const items = getSheetData("Inventory");
  const rentals = getSheetData("Rentals");
  const repairs = getSheetData("Repairs");
  return items.map(item => {
    item.rentals = rentals.filter(r => r.item_id == item.id);
    item.repairs = repairs.filter(r => r.item_id == item.id);
    return item;
  });
}

// Helper: 데이터 추가
function addRow(sheetName, data) {
  let sheet = SS.getSheetByName(sheetName);
  if (!sheet) {
    if (sheetName === 'Repairs') {
      sheet = SS.insertSheet('Repairs');
      sheet.appendRow(['id', 'item_id', 'count', 'date', 'memo', 'requester', 'status']);
    } else {
      return; // or throw error
    }
  }
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newRow = headers.map(h => data[h] != null ? data[h] : ""); 
  sheet.appendRow(newRow);
}

// Helper: 상태 업데이트 (예약/요청)
function updateStatus(sheetName, id, status) {
  const sheet = SS.getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) { 
      const statusCol = data[0].indexOf("status") + 1;
      sheet.getRange(i + 1, statusCol).setValue(status);
      break;
    }
  }
}

// Helper: 요청 필드 업데이트 (관리자 요청)
function updateRequestField(id, status, memo) {
  const sheet = SS.getSheetByName("AdminRequests");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      const headers = data[0];
      const statusCol = headers.indexOf("status") + 1;
      const memoCol = headers.indexOf("memo") + 1;
      if (status) sheet.getRange(i + 1, statusCol).setValue(status);
      if (memo) sheet.getRange(i + 1, memoCol).setValue(memo);
      break;
    }
  }
}

// Helper: 활동 로그 기록
function logActivity(message) {
  const ss = SS; 
  let sheet = ss.getSheetByName("ActivityLogs");
  if (!sheet) {
    sheet = ss.insertSheet("ActivityLogs");
    sheet.appendRow(["timestamp", "message"]);
  }
  const date = new Date().toLocaleString("ko-KR", {timeZone: "Asia/Seoul"});
  sheet.appendRow([date, "'" + message]);
}

// Helper: 최근 활동 로그 가져오기
function getLogs() {
  const sheet = SS.getSheetByName("ActivityLogs");
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const startRow = Math.max(2, lastRow - 19); 
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, 2).getValues();
  
  return data.map(r => ({ timestamp: r[0], message: r[1] })).reverse();
}

// Helper: 수리 정보 업데이트 (상태, 관리자메모)
function updateRepairInfo(id, status, memo) {
  const sheet = SS.getSheetByName("Repairs");
  const data = sheet.getDataRange().getValues();
  let found = false;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
       found = true;
       const header = data[0];
       const statusCol = header.indexOf("status") + 1;
       const memoCol = header.indexOf("admin_memo") + 1;
       
       if (status && statusCol > 0) sheet.getRange(i+1, statusCol).setValue(status);
       
       if (memo !== undefined) {
           if (memoCol > 0) {
               sheet.getRange(i+1, memoCol).setValue(memo);
           } else {
               logActivity(`[Error] 'admin_memo' column missing in Repairs sheet`);
           }
       }
       break;
    }
  }
  
  if (!found) logActivity(`[Error] Repair ID not found: ${id}`);
}

// Helper: 비품 수량 수정
function updateInventoryItem(id, quantity) {
  const sheet = SS.getSheetByName("Inventory");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
       const header = data[0];
       const qtyCol = header.indexOf("quantity") + 1;
       sheet.getRange(i+1, qtyCol).setValue(quantity);
       break;
    }
  }
}

// Helper: Admin List (Name/Status only)
function getAdminList() {
  const sheet = SS.getSheetByName("Manage");
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  // Return [{id, status}, ...] (Skip header)
  return data.slice(1).map(r => ({ id: r[0], status: r[2] }));
}

// Helper: Login
function loginAdmin(id, password) {
  const sheet = SS.getSheetByName("Manage");
  if (!sheet) return { success: false, message: "Manage sheet missing" };
  const data = sheet.getDataRange().getValues();
  const user = data.slice(1).find(r => String(r[0]) === String(id));
  
  if (!user) return { success: false, message: "존재하지 않는 사용자입니다." };
  if (String(user[1]) !== String(password)) return { success: false, message: "비밀번호가 일치하지 않습니다." };
  if (user[2] === 'pending') return { success: false, message: "승인 대기 중인 계정입니다." };
  
  return { success: true, role: user[2] };
}

// Helper: Register
function registerAdmin(id, password) {
  let sheet = SS.getSheetByName("Manage");
  if (!sheet) {
    sheet = SS.insertSheet("Manage");
    sheet.appendRow(["id", "password", "status"]);
  }
  const data = sheet.getDataRange().getValues();
  if (data.slice(1).some(r => String(r[0]) === String(id))) throw new Error("이미 존재하는 ID입니다.");
  
  sheet.appendRow([id, password, 'pending']);
  return { success: true };
}

// Helper: Change Password
function changePassword(id, oldPw, newPw) {
  const sheet = SS.getSheetByName("Manage");
  const data = sheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      if (String(data[i][1]) !== String(oldPw)) throw new Error("현재 비밀번호가 일치하지 않습니다.");
      sheet.getRange(i+1, 2).setValue(newPw);
      found = true;
      break;
    }
  }
  if (!found) throw new Error("사용자를 찾을 수 없습니다.");
  return { success: true };
}

// Helper: Manage Admin (Master only)
function manageAdmin(targetId, action, data) {
  const sheet = SS.getSheetByName("Manage");
  const rows = sheet.getDataRange().getValues();
  const rowIndex = rows.findIndex(r => String(r[0]) === String(targetId));
  
  if (rowIndex === -1) throw new Error("Target user not found");
  
  if (action === 'approve') {
    sheet.getRange(rowIndex + 1, 3).setValue('manager');
  } else if (action === 'delete') {
    sheet.deleteRow(rowIndex + 1);
  } else if (action === 'reset_pw') {
    sheet.getRange(rowIndex + 1, 2).setValue(data.newPassword);
  } else if (action === 'update_role') {
    sheet.getRange(rowIndex + 1, 3).setValue(data.role);
  }
  return { success: true };
}

```

3.  상단 **배포 > 새 배포** 클릭.
    - 유형 선택: **웹 앱(Web App)**
    - 설명: `Geumsa P.E. API v4`
    - 다음 사용자 권한으로 실행: **나(Me)**
    - 액세스 권한이 있는 사용자: **모든 사용자(Anyone)**
4.  **배포** 버튼 클릭 후 생성된 **웹 앱 URL**을 복사해둡니다.

---

## 3단계: `js/data.js` 수정

이제 앱이 로컬 저장소 대신 구글 시트 API를 바라보도록 수정해야 합니다.

```javascript
/* js/data.js 수정 가이드 */
const API_URL = "여기에_복사한_웹_앱_URL을_넣으세요";

class DataManager {
    async loadAllData() {
        const response = await fetch(API_URL);
        const data = await response.json();
        this.baseSchedule = data.baseSchedule;
        this.weeklySchedule = data.weeklySchedule;
        this.inventory = data.inventory;
        this.adminRequests = data.adminRequests;
        return data;
    }

    async syncData(action, payload) {
        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action, ...payload })
        });
        return this.loadAllData(); // 변경 후 최신 데이터 다시 로드
    }
}
```

---

## 💡 연동 후 핵심 팁

1.  **초기 로딩**: `app.js`의 `DOMContentLoaded` 시점에 `dataManager.loadAllData()`를 `await`로 호출하여 데이터를 먼저 가져와야 합니다.
2.  **데이터 무결성**: 시트의 `id` 값은 `Date.now()` 등을 사용하여 앱에서 직접 생성하여 보내는 것이 관리가 편합니다.
3.  **성능 최적화**: 구글 시트는 DB에 비해 느릴 수 있으므로, 데이터를 한 번 로드한 뒤에는 `localStorage`에 임시 캐싱하고 변경 시에만 동기화하는 방식을 권장합니다.

---
**이제 구글 스프레드시트 파워로 모든 데이터를 클라우드에서 관리하세요!**
