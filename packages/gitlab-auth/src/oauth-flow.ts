import { generateSecret, generateCodeChallengeFromVerifier } from './pkce.js';
import { CallbackServer } from './callback-server.js';

export interface OAuthFlowOptions {
  /**
   * GitLab instance URL (e.g., https://gitlab.com)
   */
  instanceUrl: string;

  /**
   * OAuth client ID
   */
  clientId: string;

  /**
   * OAuth scopes to request
   */
  scopes: string[];

  /**
   * OAuth method: 'auto' (callback server) or 'code' (manual paste)
   */
  method: 'auto' | 'code';

  /**
   * Timeout in milliseconds (default: 60000)
   */
  timeout?: number;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  created_at: number;
}

export interface AuthorizationResult {
  code: string;
  state: string;
  codeVerifier: string;
}

/**
 * GitLab OAuth flow implementation
 * Combines patterns from gitlab-vscode-extension and gitlab-lsp
 */
export class GitLabOAuthFlow {
  constructor(private options: OAuthFlowOptions) {}

  /**
   * Start the OAuth authorization flow
   * @returns Authorization result with code, state, and code verifier
   */
  async authorize(): Promise<AuthorizationResult> {
    // Generate PKCE parameters
    const codeVerifier = generateSecret(43);
    const codeChallenge = generateCodeChallengeFromVerifier(codeVerifier);
    const state = generateSecret(32);

    if (this.options.method === 'auto') {
      return this.authorizeWithCallback(codeChallenge, state, codeVerifier);
    } else {
      return this.authorizeWithManualCode(codeChallenge, state, codeVerifier);
    }
  }

  /**
   * Authorize using local callback server
   */
  private async authorizeWithCallback(
    codeChallenge: string,
    state: string,
    codeVerifier: string
  ): Promise<AuthorizationResult> {
    // Create callback server
    const server = new CallbackServer({
      port: 0, // Random port
      host: '127.0.0.1',
      timeout: this.options.timeout || 60000,
    });

    try {
      // Start server and get callback URL
      const callbackPromise = server.waitForCallback();
      const redirectUri = server.getCallbackUrl();

      // Build authorization URL
      const authUrl = this.buildAuthorizationUrl(redirectUri, codeChallenge, state);

      // Try to open browser
      const open = await import('open');
      await open.default(authUrl);

      // Wait for callback
      const result = await callbackPromise;

      // Verify state matches
      if (result.state !== state) {
        throw new Error('State mismatch - possible CSRF attack');
      }

      return {
        code: result.code,
        state: result.state,
        codeVerifier,
      };
    } finally {
      await server.close();
    }
  }

  /**
   * Authorize with manual code entry
   */
  private authorizeWithManualCode(
    codeChallenge: string,
    state: string,
    _codeVerifier: string
  ): Promise<AuthorizationResult> {
    // Use a fixed redirect URI for manual flow
    const redirectUri = 'http://127.0.0.1/callback';

    // Build authorization URL
    this.buildAuthorizationUrl(redirectUri, codeChallenge, state);

    // Manual code entry not implemented
    throw new Error('Manual code entry not yet implemented - use auto method');
  }

  /**
   * Build the OAuth authorization URL
   */
  private buildAuthorizationUrl(redirectUri: string, codeChallenge: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: this.options.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const baseUrl = this.options.instanceUrl.replace(/\/$/, '');
    return `${baseUrl}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<OAuthTokens> {
    const baseUrl = this.options.instanceUrl.replace(/\/$/, '');
    const tokenUrl = `${baseUrl}/oauth/token`;

    const params = new URLSearchParams({
      client_id: this.options.clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const tokens = await response.json();
    return tokens as OAuthTokens;
  }

  /**
   * Exchange refresh token for new access token
   */
  async exchangeRefreshToken(refreshToken: string): Promise<OAuthTokens> {
    const baseUrl = this.options.instanceUrl.replace(/\/$/, '');
    const tokenUrl = `${baseUrl}/oauth/token`;

    const params = new URLSearchParams({
      client_id: this.options.clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const tokens = await response.json();
    return tokens as OAuthTokens;
  }
}
