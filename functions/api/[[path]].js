const SHEET_ID = '1Ds8JNQbyOOYh4Gmw7jN_f9MN3yCV0OyOLyIsnmEqntk';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID;

function b64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function textB64url(text) {
  return b64url(new TextEncoder().encode(text));
}
async function hmacKey(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function googleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = textB64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = textB64url(JSON.stringify({ iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const unsigned = header + '.' + claim;
  const pem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64url(sig);
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'Could not authenticate with Google Sheets.');
  return data.access_token;
}
async function sheetRequest(env, path, options = {}) {
  const token = await googleToken(env);
  const response = await fetch(SHEETS_API + path, { ...options, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Google Sheets request failed.');
  return data;
}
async function readRange(env, range) {
  const data = await sheetRequest(env, '/values/' + encodeURIComponent(range));
  return data.values || [];
}
async function appendRow(env, range, values) {
  return sheetRequest(env, '/values/' + encodeURIComponent(range) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: [values] }) });
}
async function updateRow(env, range, values) {
  return sheetRequest(env, '/values/' + encodeURIComponent(range) + '?valueInputOption=USER_ENTERED', { method: 'PUT', body: JSON.stringify({ values: [values] }) });
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
async function session(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(env), Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - signature.length % 4) % 4)), c => c.charCodeAt(0)), new TextEncoder().encode(payload));
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4)));
    return valid && claims.exp > Date.now() / 1000 ? claims : null;
  } catch { return null; }
}
async function makeSession(user, env) {
  const payload = textB64url(JSON.stringify({ user, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(payload));
  return payload + '.' + b64url(sig);
}
const clean = v => String(v ?? '').trim();
const employee = row => ({ employeeId: clean(row[0]), fullName: clean(row[1]), designation: clean(row[2]), joiningDate: clean(row[3]), contact: clean(row[4]), email: clean(row[5]) });
async function employees(env) { return (await readRange(env, 'Employees!A2:G')).map(employee).filter(e => e.employeeId); }
async function route(request, env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.SESSION_SECRET) return json({ error: 'Cloudflare secrets are not configured. See README.' }, 503);
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/login' && request.method === 'POST') {
    const { userId, password } = await request.json();
    if (!userId || !password) return json({ error: 'User ID and password are required.' }, 400);
    const rows = await readRange(env, 'Employees!A2:G');
    const row = rows.find(r => (clean(r[0]).toLowerCase() === clean(userId).toLowerCase() || clean(r[5]).toLowerCase() === clean(userId).toLowerCase()) && clean(r[6]) === String(password));
    if (!row) return json({ error: 'Invalid User ID or password.' }, 401);
    const user = employee(row), token = await makeSession({ employeeId: user.employeeId, name: user.fullName, email: user.email }, env);
    return json({ token, user });
  }
  const auth = await session(request, env);
  if (!auth) return json({ error: 'Please sign in again.' }, 401);
  if (path === '/api/employees' && request.method === 'GET') return json(await employees(env));
  if (path === '/api/employees' && request.method === 'POST') {
    const e = await request.json();
    if (!e.employeeId || !e.fullName || !e.password) return json({ error: 'Employee ID, full name, and password are required.' }, 400);
    const rows = await readRange(env, 'Employees!A2:G');
    if (rows.some(r => clean(r[0]).toLowerCase() === clean(e.employeeId).toLowerCase())) return json({ error: 'Employee ID already exists.' }, 409);
    await appendRow(env, 'Employees!A:G', [e.employeeId, e.fullName, e.designation || '', e.joiningDate || '', e.contact || '', e.email || '', e.password]);
    return json({ success: true });
  }
  if (path.startsWith('/api/employees/') && request.method === 'DELETE') {
    const id = decodeURIComponent(path.split('/').pop());
    const rows = await readRange(env, 'Employees!A2:G');
    const index = rows.findIndex(r => clean(r[0]) === id);
    if (index < 0) return json({ error: 'Employee not found.' }, 404);
    const info = await sheetRequest(env, '?fields=sheets(properties(sheetId,title))');
    const employeeSheet = info.sheets?.find(s => s.properties.title === 'Employees')?.properties.sheetId;
    const attendanceSheet = info.sheets?.find(s => s.properties.title === 'Attendance')?.properties.sheetId;
    const requests = [{ deleteDimension: { range: { sheetId: employeeSheet, dimension: 'ROWS', startIndex: index + 1, endIndex: index + 2 } } }];
    const attendance = await readRange(env, 'Attendance!A2:C');
    const rowIndices = attendance.map((r, i) => clean(r[1]) === id ? i + 1 : -1).filter(i => i >= 0).sort((a, b) => b - a);
    rowIndices.forEach(i => requests.push({ deleteDimension: { range: { sheetId: attendanceSheet, dimension: 'ROWS', startIndex: i + 1, endIndex: i + 2 } } }));
    if (requests.some(r => r.deleteDimension.range.sheetId == null)) return json({ error: 'Employees or Attendance sheet tab is missing.' }, 500);
    await sheetRequest(env, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
    return json({ success: true });
  }
  if (path === '/api/attendance' && request.method === 'GET') {
    const date = url.searchParams.get('date');
    const [emps, rows] = await Promise.all([employees(env), readRange(env, 'Attendance!A2:C')]);
    const map = {};
    rows.forEach(r => { if (clean(r[0]).slice(0, 10) === date) map[clean(r[1])] = clean(r[2]); });
    return json(emps.map(e => ({ ...e, status: map[e.employeeId] || '' })));
  }
  if (path === '/api/attendance' && request.method === 'POST') {
    const { date, selections } = await request.json();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Array.isArray(selections) || !selections.length) return json({ error: 'Choose a date and at least one employee.' }, 400);
    const allowed = new Set(['P', 'A', 'L', 'W/O']);
    const rows = await readRange(env, 'Attendance!A2:C');
    for (const item of selections) {
      if (!allowed.has(item.status)) return json({ error: 'Invalid attendance status.' }, 400);
      const idx = rows.findIndex(r => clean(r[0]).slice(0, 10) === date && clean(r[1]) === clean(item.employeeId));
      if (idx >= 0) await updateRow(env, `Attendance!A${idx + 2}:C${idx + 2}`, [date, item.employeeId, item.status]);
      else await appendRow(env, 'Attendance!A:C', [date, item.employeeId, item.status]);
    }
    return json({ success: true });
  }
  if (path === '/api/summary' && request.method === 'GET') {
    const [year, month] = (url.searchParams.get('month') || '').split('-').map(Number);
    if (!year || month < 1 || month > 12) return json({ error: 'Month must be YYYY-MM.' }, 400);
    const [emps, rows] = await Promise.all([employees(env), readRange(env, 'Attendance!A2:C')]);
    const days = new Date(year, month, 0).getDate();
    const matrix = emps.map(e => {
      const status = Array(days).fill('');
      rows.forEach(r => { const date = new Date(r[0]); if (clean(r[1]) === e.employeeId && date.getFullYear() === year && date.getMonth() + 1 === month) status[date.getDate() - 1] = clean(r[2]); });
      return { ...e, days: status };
    });
    return json({ year, month, days: Array.from({ length: days }, (_, i) => i + 1), matrix });
  }
  if (path === '/api/holidays' && request.method === 'GET') return json((await readRange(env, 'Holidays!A2:B')).filter(r => r[0]).map(r => ({ date: clean(r[0]).slice(0, 10), name: clean(r[1]) })));
  return json({ error: 'Not found.' }, 404);
}
export async function onRequest({ request, env }) {
  try { return await route(request, env); }
  catch (error) { return json({ error: error.message || 'Unexpected server error.' }, 500); }
}
