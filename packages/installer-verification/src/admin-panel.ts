export function adminPanel() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Codyx Admin — Installations</title>
<style>
*,:after,:before{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh}
header{background:#161b22;border-bottom:1px solid #30363d;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:20px;font-weight:600;color:#f0f6fc}
header span{color:#8b949e;font-size:14px}
#app{max-width:1400px;margin:0 auto;padding:24px}
#login{max-width:400px;margin:80px auto;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:32px;text-align:center}
#login h2{font-size:18px;margin-bottom:16px}
#login p{color:#8b949e;font-size:14px;margin-bottom:24px}
#login input{width:100%;padding:10px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:14px;margin-bottom:12px;outline:none}
#login input:focus{border-color:#2f81f7}
#login button,#uninstall-all-btn{padding:10px 20px;background:#238636;border:none;border-radius:6px;color:#fff;font-size:14px;font-weight:500;cursor:pointer}
#login button:hover{background:#2ea043}
#login .error{color:#f85149;font-size:13px;margin-top:8px;display:none}
#dashboard{display:none}
.toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap}
.toolbar .stats{color:#8b949e;font-size:14px}
.toolbar .stats strong{color:#e6edf3}
.btn-logout{padding:6px 14px;background:transparent;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:13px;cursor:pointer}
.btn-logout:hover{background:#21262d}
.btn-uninstall{padding:6px 14px;background:#1f6feb;border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.btn-uninstall:hover{background:#388bfd}
.btn-uninstall:disabled,.btn-uninstall.disabled{opacity:.5;cursor:not-allowed;background:#1f6feb}
.badge.pending{background:#d2992222;color:#d29922;border:1px solid #d2992244}
.badge.acknowledged{background:#1f6feb22;color:#58a6ff;border:1px solid #1f6feb44}
.badge.completed{background:#23863622;color:#3fb950;border:1px solid #23863644}
table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
th{text-align:left;padding:10px 12px;font-size:12px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;background:#0d1117;border-bottom:1px solid #30363d}
td{padding:10px 12px;font-size:13px;border-bottom:1px solid #21262d;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#1c2128}
.mono{font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;font-size:12px;color:#8b949e}
.copy{background:none;border:none;color:#58a6ff;cursor:pointer;font-size:11px;margin-left:4px;text-decoration:underline}
.copy:hover{color:#79c0ff}
.toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:14px;z-index:100;display:none;max-width:400px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.toast.success{background:#238636;color:#fff;display:block}
.toast.error{background:#da3633;color:#fff;display:block}
.badge{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500}
.badge.windows{background:#1f6feb22;color:#58a6ff;border:1px solid #1f6feb44}
.badge.linux{background:#23863622;color:#3fb950;border:1px solid #23863644}
.badge.macos{background:#d2992222;color:#d29922;border:1px solid #d2992244}
.confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:200}
.confirm-box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:24px;max-width:480px;width:90%;text-align:center}
.confirm-box h3{margin-bottom:8px;font-size:16px}
.confirm-box p{color:#8b949e;font-size:14px;margin-bottom:20px;word-break:break-all}
.confirm-actions{display:flex;gap:8px;justify-content:center}
.confirm-actions button{padding:8px 20px;border-radius:6px;font-size:14px;cursor:pointer;border:none}
.confirm-actions .btn-cancel{background:#21262d;color:#e6edf3}
.confirm-actions .btn-confirm{background:#da3633;color:#fff}
.confirm-actions .btn-confirm:hover{background:#f85149}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid #8b949e;border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;padding:40px;color:#8b949e}
.row-banned td{background:#da363322}
.row-active td{background:#23863612}
.btn-ban{padding:6px 8px;background:#da3633;border:none;border-radius:6px;color:#fff;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap}
.btn-ban:hover{background:#f85149}
.btn-ban:disabled{background:#484f58;opacity:.6;cursor:not-allowed}
.btn-unban{padding:6px 8px;background:#238636;border:none;border-radius:6px;color:#fff;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap}
.btn-unban:hover{background:#2ea043}
.badge.banned{background:#da363322;color:#f85149;border:1px solid #da363344}
.badge.active{background:#23863622;color:#3fb950;border:1px solid #23863644}
</style>
</head>
<body>

<header>
<h1>Codyx Installer Admin</h1>
<span id="env-label"></span>
</header>

<div id="app">

<div id="login">
<h2>Admin Access</h2>
<p>Enter your administrator token to manage installations.</p>
<input type="password" id="token-input" placeholder="Administrator token" autocomplete="off">
<button onclick="login()">Authenticate</button>
<div class="error" id="login-error">Invalid token</div>
</div>

<div id="dashboard">
<div class="toolbar">
<div class="stats">Registrations: <strong id="count">0</strong> &middot; Environment: <strong id="dash-env">-</strong></div>
<div>
<button class="btn-logout" onclick="logout()">Logout</button>
</div>
</div>
<table>
<thead>
<tr>
<th>Display Name</th>
<th>Email</th>
<th>Install ID</th>
<th>Machine ID</th>
<th>Platform</th>
<th>Version</th>
<th>Verified</th>
<th>Status</th>
<th>Banned</th>
<th></th>
</tr>
</thead>
<tbody id="table-body">
<tr><td colspan="10" class="empty"><span class="spinner"></span> Loading...</td></tr>
</tbody>
</table>
</div>

</div>

<div class="confirm-overlay" id="confirm-overlay">
<div class="confirm-box">
<h3>Confirm Uninstall</h3>
<p id="confirm-text">Send uninstall command to <strong id="confirm-name"></strong><br><span class="mono" id="confirm-id"></span></p>
<div class="confirm-actions">
<button class="btn-cancel" onclick="closeConfirm()">Cancel</button>
<button class="btn-confirm" id="confirm-btn" onclick="executeUninstall()">Uninstall</button>
</div>
</div>
</div>

<div id="toast" class="toast"></div>

<script>
const API = window.location.origin

function getToken() {
  let t = localStorage.getItem("codyx_admin_token")
  if (!t) t = sessionStorage.getItem("codyx_admin_token")
  return t
}

function setToken(token, persist) {
  if (persist) localStorage.setItem("codyx_admin_token", token)
  else sessionStorage.setItem("codyx_admin_token", token)
}

async function apiFetch(path, opts = {}) {
  const token = getToken()
  if (!token) { showLogin(); return }
  const res = await fetch(API + path, {
    ...opts,
    headers: { ...opts.headers, Authorization: "Bearer " + token },
  })
  if (res.status === 401) { localStorage.removeItem("codyx_admin_token"); sessionStorage.removeItem("codyx_admin_token"); showLogin(); return }
  return res
}

function showLogin() {
  document.getElementById("dashboard").style.display = "none"
  document.getElementById("login").style.display = "block"
  document.getElementById("login-error").style.display = "none"
}

function login() {
  const token = document.getElementById("token-input").value.trim()
  if (!token) return
  setToken(token, true)
  loadDashboard()
}

function logout() {
  localStorage.removeItem("codyx_admin_token")
  sessionStorage.removeItem("codyx_admin_token")
  showLogin()
}

function showToast(msg, type) {
  const t = document.getElementById("toast")
  t.textContent = msg
  t.className = "toast " + type
  setTimeout(() => { t.className = "toast" }, 4000)
}

function fmtDate(ts) {
  if (!ts) return "-"
  return new Date(ts).toLocaleString()
}

let targetInstallId = null

function confirmUninstall(id, name) {
  targetInstallId = id
  document.getElementById("confirm-name").textContent = name || "Unknown"
  document.getElementById("confirm-id").textContent = id
  document.getElementById("confirm-overlay").style.display = "flex"
}

function closeConfirm() {
  targetInstallId = null
  document.getElementById("confirm-overlay").style.display = "none"
}

async function executeUninstall() {
  const id = targetInstallId
  if (!id) return
  const btn = document.getElementById("confirm-btn")
  btn.disabled = true
  btn.textContent = "Uninstalling..."
  closeConfirm()

  const res = await apiFetch("/v1/admin/installations/" + id + "/uninstall", { method: "POST" })
  if (res && res.ok) {
    showToast("Uninstall command sent to " + id, "success")
    loadDashboard()
  } else {
    showToast("Failed to send uninstall command", "error")
  }
  btn.disabled = false
  btn.textContent = "Uninstall"
}

function badge(platform) {
  return '<span class="badge ' + (platform || "windows") + '">' + (platform || "windows") + "</span>"
}

function statusBadge(status) {
  if (!status) return '<span class="badge" style="color:#8b949e">&mdash;</span>'
  if (status === "pending") return '<span class="badge pending">Pending</span>'
  if (status === "acknowledged") return '<span class="badge acknowledged">Processing</span>'
  if (status === "completed") return '<span class="badge completed">Done</span>'
  return '<span class="badge">' + esc(status) + "</span>"
}

async function banInstall(id) {
  const res = await apiFetch("/v1/admin/installations/" + id + "/ban", { method: "POST" })
  if (res && res.ok) {
    const data = await res.json()
    let msg = "Installation banned"
    if (data.uninstall_triggered) msg += " + uninstall triggered"
    if (!data.banned) msg += " (no machine ID - cannot block re-registration)"
    showToast(msg, "success")
    loadDashboard()
  } else {
    const err = await res.json().catch(() => ({}))
    showToast(err.message || "Failed to ban installation", "error")
  }
}

async function unbanInstall(id) {
  const res = await apiFetch("/v1/admin/installations/" + id + "/unban", { method: "POST" })
  if (res && res.ok) {
    showToast("Unbanned " + id, "success")
    loadDashboard()
  } else {
    showToast("Failed to unban installation", "error")
  }
}

async function loadDashboard() {
  const token = getToken()
  if (!token) { showLogin(); return }

  document.getElementById("login").style.display = "none"
  document.getElementById("dashboard").style.display = "block"
  document.getElementById("table-body").innerHTML = '<tr><td colspan="10" class="empty"><span class="spinner"></span> Loading...</td></tr>'

  const res = await apiFetch("/v1/admin/installations")
  if (!res) return
  const data = await res.json()
  const installations = data.installations || []
  const tbody = document.getElementById("table-body")
  document.getElementById("count").textContent = installations.length
  document.getElementById("dash-env").textContent = document.getElementById("env-label").textContent || "production"

  if (installations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">No registrations found.</td></tr>'
    return
  }

  tbody.innerHTML = installations.map((r) => {
    const disabled = r.command_status === "acknowledged" || r.command_status === "completed"
    const btnLabel = r.command_status === "completed" ? "Uninstalled" : "Uninstall"
    let rowClass = ""
    if (r.is_banned) rowClass = " class=\\"row-banned\\""
    else rowClass = " class=\\"row-active\\""
    let midCell
    if (r.machine_id) {
      midCell = "<td><span class=\\"mono\\">" + esc(r.machine_id).slice(0, 8) + "&hellip;</span>" +
        "<button class=\\"copy\\" onclick=\\"copyId('" + esc(r.machine_id) + "')\\">copy</button></td>"
    } else {
      midCell = '<td style="color:#8b949e">&mdash;</td>'
    }
    let banCell
    if (r.is_banned) banCell = "<td><span class=\\"badge banned\\">Banned</span></td>"
    else banCell = "<td><span class=\\"badge active\\">Active</span></td>"
    let banBtn = ""
    if (r.is_banned) {
      banBtn = " <button class=\\"btn-unban\\" onclick=\\"unbanInstall('" + esc(r.install_id) + "')\\">Unban</button>"
    } else if (r.machine_id) {
      banBtn = " <button class=\\"btn-ban\\" onclick=\\"banInstall('" + esc(r.install_id) + "')\\">Ban</button>"
    } else {
      banBtn = " <button class=\\"btn-ban\\" disabled title=\\"No machine ID on record\\">Ban</button>"
    }
    return "<tr" + rowClass + ">" +
      "<td><strong>" + esc(r.display_name) + "</strong></td>" +
      "<td>" + esc(r.email) + "</td>" +
      "<td><span class=\\"mono\\">" + esc(r.install_id).slice(0, 8) + "&hellip;</span>" +
        "<button class=\\"copy\\" onclick=\\"copyId('" + esc(r.install_id) + "')\\">copy</button></td>" +
      midCell +
      "<td>" + badge(r.platform) + "</td>" +
      "<td class=\\"mono\\">" + esc(r.installer_version) + "</td>" +
      "<td>" + fmtDate(r.email_verified_at) + "</td>" +
      "<td>" + statusBadge(r.command_status) + "</td>" +
      banCell +
      '<td><button class="btn-uninstall' + (disabled ? " disabled" : "") + '" onclick="confirmUninstall(' + "'" + esc(r.install_id) + "','" + esc(r.display_name) + "'" + ')"' + (disabled ? " disabled" : "") + ">" + btnLabel + "</button>" + banBtn + "</td>" +
    "</tr>"
  }).join("")
}

function esc(s) {
  if (!s) return ""
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;").replace(/"/g,"&quot;")
}

function copyId(id) {
  navigator.clipboard.writeText(id).then(() => {
    showToast("Install ID copied", "success")
  })
}

loadDashboard()
</script>
</body>
</html>`
}
