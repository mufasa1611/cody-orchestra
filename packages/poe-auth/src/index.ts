import type { Plugin, AuthHook } from "@cody/plugin";
import crypto from "crypto";
import http from "http";
import open from "open";

const CLIENT_ID = "client_728290227fc048cc9262091a1ea197ea";
const POE_AUTHORIZE_URL = "https://poe.com/oauth/authorize";
const POE_TOKEN_URL = "https://api.poe.com/token";
const OAUTH_SCOPES = "apikey:create";

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateSecret(length: number): string {
  return base64UrlEncode(crypto.randomBytes(length));
}

function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
}

function getExpiry(expiresIn: number | null | undefined): number {
  if (expiresIn == null) return Number.MAX_SAFE_INTEGER;
  return Date.now() + expiresIn * 1000;
}

async function authorize(): Promise<{
  url: string;
  instructions: string;
  method: "auto";
  callback(): Promise<
    { type: "success"; access: string; refresh: string; expires: number } | { type: "failed" }
  >;
}> {
  const codeVerifier = generateSecret(43);
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateSecret(32);

  // Start local callback server
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start server");
  const port = address.port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  const authUrl = `${POE_AUTHORIZE_URL}?${params.toString()}`;

  // Wait for callback
  const callbackPromise = new Promise<{ code: string; state: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth callback timeout"));
    }, 120000);

    server.once("request", (req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${error}</p></body></html>`);
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code || !returnedState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>Missing Parameters</h1></body></html>`);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body><h1>Authentication Successful</h1><p>You can close this tab.</p></body></html>`
      );
      clearTimeout(timeout);
      server.close();
      resolve({ code, state: returnedState });
    });
  });

  // Open browser
  await open(authUrl);

  return {
    url: authUrl,
    instructions:
      "Complete authorization in your browser. This window will close automatically.",
    method: "auto" as const,
    callback: async () => {
      try {
        const result = await callbackPromise;

        if (result.state !== state) {
          return { type: "failed" as const };
        }

        // Exchange code for API key
        const tokenParams = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code: result.code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        });

        const response = await fetch(POE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: tokenParams.toString(),
        });

        if (!response.ok) {
          return { type: "failed" as const };
        }

        const data = (await response.json()) as {
          api_key: string;
          api_key_expires_in: number | null;
        };

        return {
          type: "success" as const,
          access: data.api_key,
          refresh: data.api_key,
          expires: getExpiry(data.api_key_expires_in),
        };
      } catch {
        return { type: "failed" as const };
      }
    },
  };
}

export const PoeAuthPlugin: Plugin = async (_input) => {
  const authHook: AuthHook = {
    provider: "poe",
    async loader(getAuth) {
      const auth = await getAuth();
      if (auth.type === "api") {
        return { apiKey: auth.key };
      }
      if (auth.type !== "oauth") {
        return {};
      }
      if (auth.expires < Date.now()) {
        throw new Error("Poe API key expired. Run `cody providers login` again.");
      }
      return { apiKey: auth.access };
    },
    methods: [
      {
        label: "Login with Poe (browser)",
        type: "oauth" as const,
        prompts: [],
        authorize,
      },
      {
        label: "Manually enter API Key",
        type: "api" as const,
        prompts: [
          {
            type: "text" as const,
            key: "key",
            message: "API Key",
            placeholder: "Enter your Poe API key",
          },
        ],
        async authorize(inputs) {
          const key = inputs?.key;
          if (!key) return { type: "failed" as const };
          return { type: "success" as const, key };
        },
      },
    ],
  };

  return {
    auth: authHook,
  };
};

export default PoeAuthPlugin;