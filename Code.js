/**
 * Code.gs
 * H & D logistics Attendance Dashboard
 */

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1Ds8JNQbyOOYh4Gmw7jN_f9MN3yCV0OyOLyIsnmEqntk/edit";
const LOGO_FILE_ID = "11e1Oyu7UipWhLcd6sPKuNigW303ffJyn";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("H & D Dashboard")
    .addItem("Open Dashboard", "showDashboardSidebar")
    .addToUi();
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getLogoDataUrl() {
  // New reliable method for embedding Google Drive images
  return "https://lh3.googleusercontent.com/d/" + LOGO_FILE_ID;
}

function getSafeScriptUrl() {
  try {
    return ScriptApp.getService().getUrl();
  } catch(e) {
    return '';
  }
}

function showDashboardSidebar() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.initialPage = 'home';
  template.logoDataUrl = getLogoDataUrl();
  template.scriptUrl = getSafeScriptUrl(); 
  
  const html = template.evaluate().setTitle("H & D logistics").setWidth(1000);
  SpreadsheetApp.getUi().showSidebar(html);
}

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : "home";
  const template = HtmlService.createTemplateFromFile('Index');
  template.initialPage = page;
  template.logoDataUrl = getLogoDataUrl();
  template.scriptUrl = getSafeScriptUrl(); 

  return template.evaluate()
    .setTitle("H & D logistics")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---------- Spreadsheet helpers ---------- */
function _getSpreadsheet() {
  return SpreadsheetApp.openByUrl(SHEET_URL);
}

function _ensureSheets() {
  const ss = _getSpreadsheet();
  if (!ss.getSheetByName("Employees")) {
    const s = ss.insertSheet("Employees");
    s.appendRow(["EmployeeID", "Full Name", "Designation", "Joining Date", "Contact", "Email", "Password"]);
    s.appendRow(["ADMIN001", "Admin User", "HR Manager", "2024-01-01", "9999999999", "admin@hdlogistics.com", "admin123"]);
  }
  if (!ss.getSheetByName("Attendance")) {
    const s = ss.insertSheet("Attendance");
    s.appendRow(["Date", "EmployeeID", "Status"]);
  }
  if (!ss.getSheetByName("Holidays")) {
    const s = ss.insertSheet("Holidays");
    s.appendRow(["Date", "Holiday Name"]);
  }
  return ss;
}

/* ---------- Server API ---------- */
function getCurrentUser() {
  try {
    const email = Session.getActiveUser().getEmail();
    return { email: email || "", name: email ? email.split("@")[0] : "" };
  } catch (e) {
    return { email: "", name: "" };
  }
}

function validateCredentials(email, password) {
  if (!email || !password) throw new Error("Email and password are required.");
  const ss = _ensureSheets();
  const sheet = ss.getSheetByName("Employees");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowEmail = String(row[5] || "").trim();
    const rowPass = String(row[6] || "").trim();
    if (rowEmail.toLowerCase() === String(email).toLowerCase() && rowPass === String(password)) {
      return {
        email: rowEmail,
        name: String(row[1] || "").trim() || rowEmail.split("@")[0],
        employeeId: String(row[0] || "").trim(),
        designation: String(row[2] || "").trim(),
        contact: String(row[4] || "").trim(),
        joiningDate: String(row[3] || "").trim()
      };
    }
  }
  throw new Error("Invalid email or password.");
}

function getEmployees() {
  const ss = _ensureSheets();
  const sheet = ss.getSheetByName("Employees");
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    rows.push({
      rowIndex: i + 1,
      employeeId: r[0] || "",
      fullName: r[1] || "",
      designation: r[2] || "",
      joiningDate: r[3] || "",
      contact: r[4] || "",
      email: r[5] || ""
    });
  }
  return rows;
}

function registerEmployee(emp) {
  const ss = _ensureSheets();
  const sheet = ss.getSheetByName("Employees");
  const lastRow = Math.max(1, sheet.getLastRow());
  const data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat() : [];
  if (data.indexOf(emp.EmployeeID) !== -1) {
    throw new Error("EmployeeID already exists.");
  }
  sheet.appendRow([emp.EmployeeID, emp.FullName, emp.Designation, emp.JoiningDate, emp.Contact, emp.Email, emp.Password || ""]);
  return { success: true, message: "Employee registered." };
}

function removeEmployee(employeeId) {
  const ss = _ensureSheets();
  const sheet = ss.getSheetByName("Employees");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(employeeId)) {
      sheet.deleteRow(i + 1);
      const att = ss.getSheetByName("Attendance");
      const attData = att.getDataRange().getValues();
      for (let j = attData.length - 1; j >= 1; j--) {
        if (String(attData[j][1]) === String(employeeId)) {
          att.deleteRow(j + 1);
        }
      }
      return { success: true, message: "Employee removed." };
    }
  }
  throw new Error("Employee not found.");
}

function getAttendanceForDate(dateStr) {
  const ss = _ensureSheets();
  const employees = getEmployees();
  const att = ss.getSheetByName("Attendance");
  const attData = att.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < attData.length; i++) {
    const row = attData[i];
    const d = Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    if (d === dateStr) {
      map[row[1]] = row[2];
    }
  }
  const result = employees.map(e => {
    return {
      employeeId: e.employeeId,
      fullName: e.fullName,
      status: map[e.employeeId] || "Pending"
    };
  });
  return result;
}

function markAttendanceBulk(dateStr, selections) {
  const ss = _ensureSheets();
  const att = ss.getSheetByName("Attendance");
  const attData = att.getDataRange().getValues();
  const existing = {};
  for (let i = 1; i < attData.length; i++) {
    const row = attData[i];
    const d = Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    if (d === dateStr) {
      existing[row[1]] = { rowIndex: i + 1, status: row[2] };
    }
  }
  selections.forEach(s => {
    if (existing[s.employeeId]) {
      att.getRange(existing[s.employeeId].rowIndex, 3).setValue(s.status);
    } else {
      att.appendRow([new Date(dateStr), s.employeeId, s.status]);
    }
  });
  return { success: true, message: "Attendance Marked Successfully" };
}

function getCountsForDateRange(startDateStr, endDateStr) {
  const ss = _ensureSheets();
  const att = ss.getSheetByName("Attendance");
  const attData = att.getDataRange().getValues();
  const counts = { Present: 0, Absent: 0, Leave: 0, WeeklyOff: 0, TotalWorkingDays: 0 };
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  for (let i = 1; i < attData.length; i++) {
    const row = attData[i];
    const d = new Date(row[0]);
    if (d >= start && d <= end) {
      const status = String(row[2] || "").toUpperCase();
      if (status === "P") counts.Present++;
      else if (status === "A") counts.Absent++;
      else if (status === "L") counts.Leave++;
      else if (status === "W/O" || status === "WO" || status === "WEEKLY OFF") counts.WeeklyOff++;
    }
  }
  counts.TotalWorkingDays = counts.Present + counts.WeeklyOff;
  return counts;
}

function getSummaryMatrix(year, month) {
  const ss = _ensureSheets();
  const employees = getEmployees();
  const att = ss.getSheetByName("Attendance");
  const attData = att.getDataRange().getValues();
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const days = [];
  for (let d = 1; d <= end.getDate(); d++) {
    days.push(d);
  }
  const map = {};
  for (let i = 1; i < attData.length; i++) {
    const row = attData[i];
    const d = new Date(row[0]);
    if (d.getFullYear() === year && (d.getMonth() + 1) === month) {
      const day = d.getDate();
      map[`${day}_${row[1]}`] = String(row[2] || "");
    }
  }
  const matrix = employees.map(emp => {
    const row = { employeeId: emp.employeeId, fullName: emp.fullName, days: [], totals: {P:0,A:0,L:0,WO:0} };
    days.forEach(day => {
      const key = `${day}_${emp.employeeId}`;
      const status = (map[key] || "").toUpperCase();
      const normalized = (status === "WEEKLY OFF") ? "W/O" : status;
      row.days.push(normalized);
      if (normalized === "P") row.totals.P++;
      else if (normalized === "A") row.totals.A++;
      else if (normalized === "L") row.totals.L++;
      else if (normalized === "W/O" || normalized === "WO") row.totals.WO++;
    });
    return row;
  });
  return { year: year, month: month, days: days, matrix: matrix };
}

function exportReportCSV(year, month) {
  const summary = getSummaryMatrix(year, month);
  const days = summary.days;
  const matrix = summary.matrix;
  
  const header = ["EmployeeID", "Full Name"].concat(days.map(d => String(d))).concat(["P","A","L","W/O"]);
  const values = [];
  values.push(header);

  matrix.forEach(r => {
    const row = [r.employeeId || '', r.fullName || '']
      .concat(r.days.map(s => s ? s : ''))
      .concat([r.totals.P || 0, r.totals.A || 0, r.totals.L || 0, r.totals.WO || 0]);
    values.push(row);
  });
  
  const filename = Utilities.formatString("Attendance_%d_%02d", year, month);
  const ss = SpreadsheetApp.create(filename);
  const sh = ss.getActiveSheet();
  sh.setName("Attendance Matrix");
  
  sh.getRange(1,1,values.length, values[0].length).setValues(values);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(2, 240); 
  for (let c = 3; c <= 2 + days.length; c++) {
    sh.setColumnWidth(c, 60);
  }
  
  const totalsStart = 3 + days.length;
  for (let c = totalsStart; c <= totalsStart + 3; c++) {
    sh.setColumnWidth(c, 80);
  }

  const sundayCols = [];
  for (let i = 0; i < days.length; i++) {
    const dayNum = days[i];
    const dt = new Date(year, month - 1, dayNum);
    const dow = dt.getDay();
    if (dow === 0) {
      sundayCols.push(3 + i);
    }
  }

  const headerRange = sh.getRange(1,1,1, header.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#f8fafc");

  sundayCols.forEach(colIndex => {
    sh.getRange(1, colIndex).setBackground("#fff6f6").setFontColor("#b91c1c");
    const lastRow = values.length;
    sh.getRange(2, colIndex, lastRow - 1, 1).setFontColor("#b91c1c");
    sh.getRange(2, colIndex, lastRow - 1, 1).setBackground("#fff7f7");
  });
  
  for (let i = 0; i < days.length; i++) {
    const dayNum = days[i];
    const dt = new Date(year, month - 1, dayNum);
    const weekday = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt.getDay()];
    const col = 3 + i;
    const headerCell = sh.getRange(1, col);
    headerCell.setValue(String(dayNum) + " (" + weekday + ")");
  }

  sh.getRange(1,1).setFontWeight("bold");
  sh.getRange(1,2).setFontWeight("bold");
  sh.getRange(2, 3 + days.length, values.length - 1, 4).setNumberFormat("0");
  
  const url = ss.getUrl();
  const id = ss.getId();
  return { url: url, id: id, name: filename };
}

function getHolidays() {
  const ss = _ensureSheets();
  const sheet = ss.getSheetByName("Holidays");
  const data = sheet.getDataRange().getValues();
  const holidays = [];
  for (let i = 1; i < data.length; i++) {
    holidays.push({ date: Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "yyyy-MM-dd"), name: data[i][1] || "" });
  }
  return holidays;
}

function addHoliday(dateStr, name) {
  const ss = _ensureSheets();
  const sheet = ss.getSheetByName("Holidays");
  sheet.appendRow([new Date(dateStr), name]);
  return { success: true };
}