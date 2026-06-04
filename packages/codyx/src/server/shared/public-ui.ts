// Static UI assets the browser fetches without app-managed credentials, e.g.
// the manifest link in <head>. These bypass auth so the page can install/render
// the manifest icons even when a server password is configured.
export const PUBLIC_UI_PATHS = new Set<string>([
  "/",
  "/index.html",
  "/site.webmanifest",
  "/mufasa.jpg",
  "/mufasa-grayscale.jpg",
  "/social-share.png",
  "/social-share-zen.png",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
])

export function isPublicUIPath(method: string, pathname: string) {
  if (method !== "GET") return false
  if (PUBLIC_UI_PATHS.has(pathname)) return true
  if (pathname.startsWith("/assets/")) return true
  if (pathname === "/favicon.ico" || pathname.startsWith("/favicon")) return true
  if (pathname === "/apple-touch-icon.png" || pathname.startsWith("/apple-touch-icon-")) return true
  return false
}
