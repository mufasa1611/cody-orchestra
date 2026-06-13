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
}) {
  const name = escapeHtml(input.displayName)
  const body = [
    `<p>Hello ${name},</p>`,
    `<p>Your Codyx installer verification code is:</p>`,
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${input.code}</p>`,
    `<p>This code expires in 10 minutes. If you did not start the installer, ignore this email.</p>`,
    `<p>Codyx uses this address only for installer verification and essential service or security notices.</p>`,
  ].join("")
  const form = new FormData()
  form.set("from", input.sender)
  form.set("to", input.email)
  form.set("subject", "Your Codyx installer verification code")
  form.set(
    "text",
    `Hello ${input.displayName},\n\nYour Codyx installer verification code is ${input.code}.\n\nThis code expires in 10 minutes.`,
  )
  form.set("html", body)
  form.set("o:tracking", "no")
  form.set("o:tracking-clicks", "no")
  form.set("o:tracking-opens", "no")
  const response = await fetch(
    `${input.apiBase.replace(/\/$/, "")}/v3/${encodeURIComponent(input.domain)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${input.sendingKey}`)}`,
      },
      body: form,
    },
  )
  if (!response.ok) throw new Error(`Mailgun rejected the verification email with status ${response.status}`)
}

export async function sendAdminNotification(input: {
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
  code: string
}) {
  const form = new FormData()
  form.set("from", input.sender)
  form.set("to", input.adminEmail)
  form.set("subject", `[installer] Verification code generated for ${input.userEmail}`)
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
      `Code: ${input.code}`,
    ].join("\n"),
  )
  const response = await fetch(
    `${input.apiBase.replace(/\/$/, "")}/v3/${encodeURIComponent(input.domain)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${input.sendingKey}`)}`,
      },
      body: form,
    },
  )
  if (!response.ok) console.warn(`Admin notification failed: Mailgun returned ${response.status}`)
}
