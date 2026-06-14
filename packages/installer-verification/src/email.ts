function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export async function sendVerificationEmail(input: {
  apiBase: string
  domain: string
  sendingKey: string
  sender: string
  email: string
  displayName: string
  code: string
  purpose?: "installer" | "webui-registration"
}) {
  const name = escapeHtml(input.displayName)
  const account = input.purpose === "webui-registration"
  const subject = account ? "Your Codyx account verification code" : "Your Codyx installer verification code"
  const activity = account ? "remote Codyx account setup" : "the Codyx installer"
  const body = [
    `<p>Hello ${name},</p>`,
    `<p>Your Codyx ${account ? "account" : "installer"} verification code is:</p>`,
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${input.code}</p>`,
    `<p>This code expires in 10 minutes. If you did not start ${activity}, ignore this email.</p>`,
    `<p>Codyx uses this address only for verification and essential service or security notices.</p>`,
  ].join("")
  const form = new FormData()
  form.set("from", input.sender)
  form.set("to", input.email)
  form.set("subject", subject)
  form.set(
    "text",
    `Hello ${input.displayName},\n\nYour Codyx ${account ? "account" : "installer"} verification code is ${input.code}.\n\nThis code expires in 10 minutes.`,
  )
  form.set("html", body)
  form.set("o:tracking", "no")
  form.set("o:tracking-clicks", "no")
  form.set("o:tracking-opens", "no")
  const response = await fetch(`${input.apiBase.replace(/\/$/, "")}/v3/${encodeURIComponent(input.domain)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`api:${input.sendingKey}`)}`,
    },
    body: form,
  })
  if (!response.ok) throw new Error(`Mailgun rejected the verification email with status ${response.status}`)
}

export async function sendAdminRegistrationNotification(input: {
  apiBase: string
  domain: string
  sendingKey: string
  sender: string
  adminEmail: string
  userEmail: string
  displayName: string
  installId: string
  installerVersion: string
  platform: string
  verifiedAt: string
  purpose?: "installer" | "webui-registration"
}) {
  const form = new FormData()
  form.set("from", input.sender)
  form.set("to", input.adminEmail)
  form.set(
    "subject",
    input.purpose === "webui-registration"
      ? `[webui] Verified account registration ${input.displayName}`
      : `[installer] Verified installation ${input.installId}`,
  )
  form.set("o:tracking", "no")
  form.set("o:tracking-clicks", "no")
  form.set("o:tracking-opens", "no")
  form.set(
    "text",
    [
      `User: ${input.displayName}`,
      `Email: ${input.userEmail}`,
      `Install ID: ${input.installId}`,
      `Installer Version: ${input.installerVersion}`,
      `Platform: ${input.platform}`,
      `Email Verified At: ${input.verifiedAt}`,
    ].join("\n"),
  )
  const response = await fetch(`${input.apiBase.replace(/\/$/, "")}/v3/${encodeURIComponent(input.domain)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`api:${input.sendingKey}`)}`,
    },
    body: form,
  })
  if (!response.ok) throw new Error(`Mailgun rejected the admin notification with status ${response.status}`)
}

export async function sendAdminUninstallNotification(input: {
  apiBase: string
  domain: string
  sendingKey: string
  sender: string
  adminEmail: string
  userEmail: string
  displayName: string
  installId: string
  commandId: string
}) {
  const form = new FormData()
  form.set("from", input.sender)
  form.set("to", input.adminEmail)
  form.set("subject", `[installer] Uninstall completed: ${input.displayName}`)
  form.set("o:tracking", "no")
  form.set("o:tracking-clicks", "no")
  form.set("o:tracking-opens", "no")
  form.set(
    "text",
    [
      `User: ${input.displayName}`,
      `Email: ${input.userEmail}`,
      `Install ID: ${input.installId}`,
      `Command ID: ${input.commandId}`,
      `Uninstall completed at: ${new Date().toISOString()}`,
    ].join("\n"),
  )
  const response = await fetch(`${input.apiBase.replace(/\/$/, "")}/v3/${encodeURIComponent(input.domain)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`api:${input.sendingKey}`)}`,
    },
    body: form,
  })
  if (!response.ok) throw new Error(`Mailgun rejected the uninstall notification with status ${response.status}`)
}
