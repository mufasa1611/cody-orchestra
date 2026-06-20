export function feedbackPage(name?: string, email?: string, sent?: boolean, error?: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Codyx — Send Feedback</title>
<style>
*,:after,:before{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.card{max-width:520px;width:100%;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px}
h1{font-size:24px;font-weight:600;margin-bottom:4px}
p{color:#8b949e;font-size:14px;margin-bottom:28px;line-height:1.5}
label{display:block;font-size:13px;font-weight:500;color:#e6edf3;margin-bottom:6px}
input,textarea{width:100%;padding:10px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:14px;outline:none;transition:border-color .15s}
input:focus,textarea:focus{border-color:#2f81f7}
textarea{resize:vertical;min-height:120px;font-family:inherit}
.form-group{margin-bottom:16px}
button{padding:10px 24px;background:#238636;border:none;border-radius:6px;color:#fff;font-size:14px;font-weight:500;cursor:pointer;width:100%}
button:hover{background:#2ea043}
button:disabled{opacity:.6;cursor:not-allowed}
.success{background:#23863622;border:1px solid #23863644;border-radius:8px;padding:16px;text-align:center;margin-bottom:20px}
.success p{color:#3fb950;font-size:14px;margin-bottom:0}
.error{background:#da363322;border:1px solid #da363344;border-radius:8px;padding:12px;text-align:center;margin-bottom:20px}
.error p{color:#f85149;font-size:13px;margin-bottom:0}
.footer{margin-top:24px;text-align:center;font-size:12px;color:#8b949e}
.footer a{color:#58a6ff;text-decoration:none}
.footer a:hover{text-decoration:underline}
.field-row{display:flex;gap:12px}
.field-row .form-group{flex:1}
.hint{font-size:12px;color:#8b949e;margin-top:4px}
#toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:14px;z-index:100;display:none;max-width:400px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
#toast.error{background:#da3633;color:#fff;display:block}
@media(max-width:480px){.field-row{flex-direction:column}.card{padding:24px}}
</style>
</head>
<body>

<div class="card">
${sent ? `<div class="success"><p>Thank you for your feedback! We appreciate your input.</p></div>` : ""}
${error ? `<div class="error"><p>${error}</p></div>` : ""}
${
  !sent
    ? `
<h1>Send Feedback</h1>
<p>Share your thoughts, report a bug, or suggest a feature.</p>
<form id="feedback-form" onsubmit="submitFeedback(event)">
  <div class="field-row">
    <div class="form-group">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" maxlength="100" placeholder="Your name" value="${escapeHtml(name ?? "")}">
    </div>
    <div class="form-group">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" maxlength="254" placeholder="you@example.com" value="${escapeHtml(email ?? "")}">
    </div>
  </div>
  <div class="form-group">
    <label for="message">Message</label>
    <textarea id="message" name="message" maxlength="5000" placeholder="Describe your feedback..." required></textarea>
    <div class="hint" id="char-count">0 / 5000</div>
  </div>
  <button type="submit" id="submit-btn">Send Feedback</button>
</form>
`
    : ""
}
<div class="footer">Built by <a href="https://github.com/mufasa1611">M. Farid (Mufasa)</a></div>
</div>

<div id="toast" class="toast"></div>

${
  !sent
    ? `
<script>
const API = window.location.origin

function escapeHtml(s) {
  if (!s) return ""
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;").replace(/"/g,"&quot;")
}

function showToast(msg, type) {
  const t = document.getElementById("toast")
  t.textContent = msg
  t.className = "toast " + type
  setTimeout(() => { t.className = "toast" }, 4000)
}

document.getElementById("message").addEventListener("input", function() {
  document.getElementById("char-count").textContent = this.value.length + " / 5000"
})

async function submitFeedback(e) {
  e.preventDefault()
  const btn = document.getElementById("submit-btn")
  btn.disabled = true
  btn.textContent = "Sending..."

  const name = document.getElementById("name").value.trim()
  const email = document.getElementById("email").value.trim()
  const message = document.getElementById("message").value.trim()

  if (!message) {
    showToast("Please enter a message.", "error")
    btn.disabled = false
    btn.textContent = "Send Feedback"
    return
  }

  try {
    const res = await fetch(API + "/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, message }),
    })
    if (res.ok) {
      window.location.href = window.location.pathname + "?sent=1"
    } else {
      const data = await res.json().catch(() => ({}))
      showToast(data.message || "Failed to send feedback.", "error")
      btn.disabled = false
      btn.textContent = "Send Feedback"
    }
  } catch {
    showToast("Network error. Please try again.", "error")
    btn.disabled = false
    btn.textContent = "Send Feedback"
  }
}
</script>
`
    : ""
}
</body>
</html>`
}

function escapeHtml(s: string | undefined) {
  if (!s) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
}
