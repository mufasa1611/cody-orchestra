import type { Plugin, AuthHook, AuthOuathResult } from "@cody/plugin";
import { GitLabOAuthFlow } from "./oauth-flow.js";
import { CallbackServer } from "./callback-server.js";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * GitLab OAuth constants
 */
// IMPORTANT: The bundled client ID below is from gitlab-vscode-extension and is registered
// with redirect URI: vscode://gitlab.gitlab-workflow/authentication
// This will NOT work with Cody's local HTTP callback server.
// To fix: Set GITLAB_OAUTH_CLIENT_ID environment variable with your own client ID.
const BUNDLED_CLIENT_ID =
  process.env.GITLAB_OAUTH_CLIENT_ID ||
  "1d89f9fdb23ee96d4e603201f6861dab6e143c5c3c00469a018a2d94bdc03d4e";
const GITLAB_COM_URL = "https://gitlab.com";
const OAUTH_SCOPES = ["api"];

function resolveInstanceUrl(): string {
  return process.env.GITLAB_INSTANCE_URL || GITLAB_COM_URL;
}

/**
 * Debug logging to file (doesn't break UI)
 */
function debugLog(message: string, data?: unknown): void {
  try {
    const homeDir = os.homedir();
    const logDir = path.join(homeDir, ".local", "share", "opencode", "log");

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logPath = path.join(logDir, "gitlab-auth.log");
    const timestamp = new Date().toISOString();
    const logLine = data
      ? `[${timestamp}] ${message}: ${JSON.stringify(data)}\n`
      : `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logPath, logLine);
  } catch {
    // Ignore logging errors
  }
}

/**
 * Get Cody auth file path
 */
function getAuthPath(): string {
  const homeDir = os.homedir();
  const xdgDataHome = process.env.XDG_DATA_HOME;

  if (xdgDataHome) {
    return path.join(xdgDataHome, "opencode", "auth.json");
  }

  if (process.platform !== "win32") {
    return path.join(homeDir, ".local", "share", "opencode", "auth.json");
  }

  return path.join(homeDir, ".opencode", "auth.json");
}

/**
 * Save OAuth auth data to Cody's auth.json
 */
async function saveOAuthData(
  access: string,
  refresh: string,
  expires: number,
  enterpriseUrl: string
): Promise<void> {
  const authPath = getAuthPath();
  const authDir = path.dirname(authPath);

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  let authData: Record<string, unknown> = {};
  if (fs.existsSync(authPath)) {
    const content = fs.readFileSync(authPath, "utf-8");
    authData = JSON.parse(content);
  }

  authData.gitlab = {
    type: "oauth",
    access,
    refresh,
    expires,
    enterpriseUrl,
  };

  fs.writeFileSync(authPath, JSON.stringify(authData, null, 2));
  fs.chmodSync(authPath, 0o600);
}

/**
 * Save PAT auth data to Cody's auth.json
 */
async function savePATData(key: string, enterpriseUrl: string): Promise<void> {
  const authPath = getAuthPath();
  const authDir = path.dirname(authPath);

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  let authData: Record<string, unknown> = {};
  if (fs.existsSync(authPath)) {
    const content = fs.readFileSync(authPath, "utf-8");
    authData = JSON.parse(content);
  }

  authData.gitlab = {
    type: "api",
    key,
    enterpriseUrl,
  };

  fs.writeFileSync(authPath, JSON.stringify(authData, null, 2));
  fs.chmodSync(authPath, 0o600);
}

/**
 * Mutex to prevent concurrent token refresh attempts
 */
let refreshInProgress: Promise<void> | null = null;

/**
 * Refresh OAuth token if expired or expiring soon
 */
async function refreshTokenIfNeeded(
  authData: any,
  auth: () => Promise<any>,
  fallbackUrl: string
): Promise<{ apiKey: string; instanceUrl: string }> {
  const now = Date.now();
  const expiryBuffer = 5 * 60 * 1000;
  const isExpired = authData.expires <= now + expiryBuffer;

  if (!isExpired) {
    debugLog("Token is still valid", {
      expiresAt: new Date(authData.expires).toISOString(),
      expiresIn: Math.round((authData.expires - now) / 1000 / 60) + " minutes",
    });
    return {
      apiKey: authData.access,
      instanceUrl: authData.enterpriseUrl || fallbackUrl,
    };
  }

  if (refreshInProgress) {
    debugLog("Token refresh already in progress, waiting...");
    await refreshInProgress;
    const refreshedAuthData = await auth();
    if (refreshedAuthData && refreshedAuthData.type === "oauth") {
      return {
        apiKey: refreshedAuthData.access,
        instanceUrl: refreshedAuthData.enterpriseUrl || fallbackUrl,
      };
    }
    throw new Error("Failed to get refreshed auth data");
  }

  debugLog("Token expired or expiring soon, refreshing...", {
    expiresAt: new Date(authData.expires).toISOString(),
    expired: authData.expires <= now,
  });

  refreshInProgress = (async () => {
    try {
      const instanceUrl = authData.enterpriseUrl || fallbackUrl;
      const flow = new GitLabOAuthFlow({
        instanceUrl,
        clientId: BUNDLED_CLIENT_ID,
        scopes: OAUTH_SCOPES,
        method: "auto",
      });

      debugLog("Calling exchangeRefreshToken...");
      const newTokens = await flow.exchangeRefreshToken(authData.refresh);
      const newExpiry = Date.now() + newTokens.expires_in * 1000;

      debugLog("Token refresh successful", {
        newExpiresAt: new Date(newExpiry).toISOString(),
        expiresIn: Math.round(newTokens.expires_in / 60) + " minutes",
      });

      await saveOAuthData(newTokens.access_token, newTokens.refresh_token, newExpiry, instanceUrl);
      debugLog("New tokens saved successfully");
    } catch (error) {
      debugLog("Token refresh failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      if (error instanceof Error && error.message.includes("401")) {
        debugLog("Refresh token appears to be revoked (401), clearing auth data");
        const authPath = getAuthPath();
        if (fs.existsSync(authPath)) {
          const content = fs.readFileSync(authPath, "utf-8");
          const authDataFile = JSON.parse(content);
          delete authDataFile.gitlab;
          fs.writeFileSync(authPath, JSON.stringify(authDataFile, null, 2));
        }
      }

      throw error;
    }
  })();

  try {
    await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }

  const refreshedAuthData = await auth();
  if (refreshedAuthData && refreshedAuthData.type === "oauth") {
    return {
      apiKey: refreshedAuthData.access,
      instanceUrl: refreshedAuthData.enterpriseUrl || fallbackUrl,
    };
  }

  throw new Error("Failed to get refreshed auth data after token refresh");
}

/**
 * GitLab Auth Plugin
 */
export const gitlabAuthPlugin: Plugin = async (_input) => {
  const authHook: AuthHook = {
    provider: "gitlab",

    async loader(auth) {
      const authData = await auth();

      if (!authData) {
        return {};
      }

      if (authData.type === "oauth") {
        try {
          const result = await refreshTokenIfNeeded(authData, auth, resolveInstanceUrl());
          return {
            ...result,
            clientId: BUNDLED_CLIENT_ID,
          };
        } catch (error) {
          debugLog("Failed to refresh token in loader", {
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            apiKey: authData.access,
            instanceUrl: authData.enterpriseUrl || resolveInstanceUrl(),
            clientId: BUNDLED_CLIENT_ID,
          };
        }
      }

      if (authData.type === "api") {
        const instanceUrl =
          (authData as { enterpriseUrl?: string }).enterpriseUrl || resolveInstanceUrl();
        return {
          apiKey: authData.key,
          instanceUrl,
        };
      }

      return {};
    },

    methods: [
      {
        type: "oauth",
        label: "GitLab OAuth",
        prompts: [],
        async authorize(): Promise<AuthOuathResult> {
          const instanceUrl = resolveInstanceUrl();

          let normalizedUrl: string;
          try {
            const url = new URL(instanceUrl);
            normalizedUrl = `${url.protocol}//${url.host}`;
          } catch {
            throw new Error(`Invalid GitLab instance URL: ${instanceUrl}`);
          }

          const { generateSecret, generateCodeChallengeFromVerifier } = await import("./pkce.js");
          const codeVerifier = generateSecret(43);
          const codeChallenge = generateCodeChallengeFromVerifier(codeVerifier);
          const state = generateSecret(32);

          const callbackServer = new CallbackServer({
            port: 8080,
            host: "127.0.0.1",
            timeout: 120000,
          });

          await callbackServer.start();
          const redirectUri = callbackServer.getCallbackUrl();
          const callbackPromise = callbackServer.waitForCallback();

          const params = new URLSearchParams({
            client_id: BUNDLED_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: "code",
            state,
            scope: OAUTH_SCOPES.join(" "),
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
          });

          const authUrl = `${normalizedUrl}/oauth/authorize?${params.toString()}`;

          const { exec } = await import("child_process");
          const platform = process.platform;
          const openCommand =
            platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
          exec(`${openCommand} "${authUrl}"`);

          return {
            method: "auto",
            url: authUrl,
            instructions:
              "Your browser will open for authentication. The callback will be handled automatically.",
            async callback() {
              debugLog("callback() called");
              try {
                debugLog("Waiting for callback...");
                const result = await callbackPromise;
                debugLog("Received callback", { hasCode: !!result.code, hasState: !!result.state });

                if (result.state !== state) {
                  debugLog("State mismatch", { expected: state, received: result.state });
                  await callbackServer.close();
                  return { type: "failed" };
                }
                debugLog("State verified");

                debugLog("Exchanging code for tokens...");
                const flow = new GitLabOAuthFlow({
                  instanceUrl: normalizedUrl,
                  clientId: BUNDLED_CLIENT_ID,
                  scopes: OAUTH_SCOPES,
                  method: "auto",
                });

                const tokens = await flow.exchangeAuthorizationCode(
                  result.code,
                  codeVerifier,
                  redirectUri
                );
                debugLog("Token exchange successful");

                await callbackServer.close();

                const expiresAt = Date.now() + tokens.expires_in * 1000;
                debugLog("Tokens received", { expiresAt: new Date(expiresAt).toISOString() });

                debugLog("Saving auth data...");
                await saveOAuthData(
                  tokens.access_token,
                  tokens.refresh_token,
                  expiresAt,
                  normalizedUrl
                );
                debugLog("Auth data saved successfully");

                return {
                  type: "success",
                  provider: normalizedUrl,
                  access: tokens.access_token,
                  refresh: tokens.refresh_token,
                  expires: expiresAt,
                };
              } catch (error) {
                debugLog("Error in callback", {
                  error: error instanceof Error ? error.message : String(error),
                  stack: error instanceof Error ? error.stack : undefined,
                });

                try {
                  await callbackServer.close();
                } catch (closeError) {
                  // Ignore close errors
                }

                return { type: "failed" };
              }
            },
          };
        },
      },
      {
        type: "api",
        label: "GitLab Personal Access Token",
        prompts: [
          {
            type: "text",
            key: "token",
            message: "Personal Access Token",
            placeholder: "glpat-xxxxxxxxxxxxxxxxxxxx",
            validate: (value: string) => {
              if (!value) {
                return "Token is required";
              }
              if (!value.startsWith("glpat-")) {
                return "Token should start with glpat-";
              }
              return undefined;
            },
          },
        ],
        async authorize(inputs?: Record<string, string>) {
          const instanceUrl = resolveInstanceUrl();
          const token = inputs?.token;

          if (!token) {
            return { type: "failed" };
          }

          let normalizedUrl: string;
          try {
            const url = new URL(instanceUrl);
            normalizedUrl = `${url.protocol}//${url.host}`;
          } catch {
            return { type: "failed" };
          }

          try {
            const response = await fetch(`${normalizedUrl}/api/v4/user`, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            if (!response.ok) {
              return { type: "failed" };
            }

            debugLog("Saving PAT auth data...");
            await savePATData(token, normalizedUrl);
            debugLog("PAT auth data saved successfully");

            return {
              type: "success",
              key: token,
              provider: normalizedUrl,
            };
          } catch {
            return { type: "failed" };
          }
        },
      },
    ],
  };

  return {
    auth: authHook,
  };
};

export default gitlabAuthPlugin;
