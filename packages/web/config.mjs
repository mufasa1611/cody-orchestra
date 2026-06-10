const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://cody.ai" : `https://${stage}.cody.ai`,
  console: stage === "production" ? "https://cody.ai/auth" : `https://${stage}.cody.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/your-org/cody",
  discord: "https://cody.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
