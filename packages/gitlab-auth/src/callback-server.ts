import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";

export interface CallbackServerOptions {
  port?: number;
  host?: string;
  timeout?: number;
}

export interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Create a local HTTP server to handle OAuth callback
 */
export class CallbackServer {
  private server: FastifyInstance;
  private resolveCallback?: (result: CallbackResult) => void;
  private rejectCallback?: (error: Error) => void;
  private timeoutHandle?: NodeJS.Timeout;

  constructor(private options: CallbackServerOptions = {}) {
    this.server = Fastify({
      logger: false,
    });

    this.server.register(rateLimit, {
      max: 30,
      timeWindow: 60000,
    });

    this.server.get("/callback", async (request, reply) => {
      const { code, state, error, error_description } = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };

      if (error) {
        const errorMsg = error_description || error;
        this.rejectCallback?.(new Error(`OAuth error: ${errorMsg}`));
        await reply.type("text/html").send(`
          <!DOCTYPE html>
          <html>
            <head><title>Authentication Failed</title></head>
            <body>
              <h1>Authentication Failed</h1>
              <p>${errorMsg}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        this.cleanup();
        return;
      }

      if (!code || !state) {
        this.rejectCallback?.(new Error("Missing code or state parameter"));
        await reply.type("text/html").send(`
          <!DOCTYPE html>
          <html>
            <head><title>Authentication Failed</title></head>
            <body>
              <h1>Authentication Failed</h1>
              <p>Missing required parameters.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        this.cleanup();
        return;
      }

      this.resolveCallback?.({ code, state });
      await reply.type("text/html").send(`
        <!DOCTYPE html>
        <html>
          <head><title>Authentication Successful</title></head>
          <body>
            <h1>Authentication Successful</h1>
            <p>You can close this window and return to your terminal.</p>
          </body>
        </html>
      `);
      this.cleanup();
    });
  }

  async start(): Promise<void> {
    const host = this.options.host || "127.0.0.1";
    const port = this.options.port || 0;
    await this.server.listen({ host, port });
  }

  async waitForCallback(): Promise<CallbackResult> {
    const timeout = this.options.timeout || 60000;
    this.timeoutHandle = setTimeout(() => {
      this.rejectCallback?.(new Error("OAuth callback timeout"));
      this.cleanup();
    }, timeout);

    return new Promise<CallbackResult>((resolve, reject) => {
      this.resolveCallback = resolve;
      this.rejectCallback = reject;
    });
  }

  getPort(): number {
    const address = this.server.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server not started or using Unix socket");
    }
    return address.port;
  }

  getCallbackUrl(): string {
    const host = this.options.host || "127.0.0.1";
    const port = this.getPort();
    return `http://${host}:${port}/callback`;
  }

  private cleanup(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    setTimeout(() => {
      this.server.close();
    }, 100);
  }

  async close(): Promise<void> {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    await this.server.close();
  }
}