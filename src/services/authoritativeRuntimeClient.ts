import { AppState } from '../types';
import { CommandResult, ICommand } from '../commands/types';

type RuntimeMode = 'AUTO' | 'AUTHORITATIVE' | 'LOCAL';
type SessionListener = () => void;

function env(name: string): string | undefined {
  try {
    return (import.meta as any)?.env?.[name];
  } catch {
    return undefined;
  }
}

export class AuthoritativeRuntimeClient {
  private readonly sessionStorageKey = 'execution_os_hos_client_session';
  private sessionToken: string | null = null;
  private listeners = new Set<SessionListener>();
  private hostListenerInstalled = false;

  getRuntimeMode(): RuntimeMode {
    const raw = String(env('VITE_EXECUTION_RUNTIME_MODE') || 'AUTO').toUpperCase();
    return raw === 'AUTHORITATIVE' || raw === 'LOCAL' ? raw : 'AUTO';
  }

  getBaseUrl(): string {
    return String(env('VITE_EXECUTION_API_URL') || '').replace(/\/$/, '');
  }

  prefersAuthoritativeRuntime(): boolean {
    return this.getRuntimeMode() === 'AUTHORITATIVE' || Boolean(this.getBaseUrl());
  }

  hasSession(): boolean {
    return Boolean(this.getSessionToken());
  }

  canUseAuthoritativeRuntime(): boolean {
    return Boolean(this.getBaseUrl() && this.getSessionToken());
  }

  requiresAuthoritativeRuntime(): boolean {
    return this.getRuntimeMode() === 'AUTHORITATIVE';
  }

  getSessionToken(): string | null {
    if (this.sessionToken) return this.sessionToken;
    if (typeof window === 'undefined') return null;
    try {
      this.sessionToken = window.sessionStorage.getItem(this.sessionStorageKey);
    } catch {}
    return this.sessionToken;
  }

  setSessionToken(token: string | null): void {
    this.sessionToken = token?.trim() || null;
    if (typeof window !== 'undefined') {
      try {
        if (this.sessionToken) window.sessionStorage.setItem(this.sessionStorageKey, this.sessionToken);
        else window.sessionStorage.removeItem(this.sessionStorageKey);
      } catch {}
    }
    this.listeners.forEach(listener => listener());
  }

  subscribeSession(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  installHostSessionBridge(): () => void {
    if (typeof window === 'undefined' || this.hostListenerInstalled) return () => {};
    const allowedOrigin = String(env('VITE_HOS_ORIGIN') || '').replace(/\/$/, '');
    const handler = (event: MessageEvent) => {
      if (!allowedOrigin || event.origin !== allowedOrigin) return;
      if (event.data?.type !== 'EXECUTION_OS_CLIENT_SESSION') return;
      if (typeof event.data?.token !== 'string') return;
      this.setSessionToken(event.data.token);
    };
    window.addEventListener('message', handler);
    this.hostListenerInstalled = true;
    return () => {
      window.removeEventListener('message', handler);
      this.hostListenerInstalled = false;
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    const baseUrl = this.getBaseUrl();
    const token = this.getSessionToken();
    if (!baseUrl) throw new Error('VITE_EXECUTION_API_URL is not configured.');
    if (!token) throw new Error('AUTHORITATIVE_SESSION_REQUIRED');

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error?.message || json?.message || `Execution API request failed with HTTP ${response.status}`;
      throw new Error(message);
    }
    return json;
  }

  async loadState(): Promise<AppState> {
    const json = await this.request('/api/v1/client/state');
    if (!json?.state) throw new Error('Authoritative client state response did not include state.');
    return json.state as AppState;
  }

  async executeDescriptor<TData = any>(
    type: string,
    payload: any = {},
    idempotencyKey?: string
  ): Promise<CommandResult<TData>> {
    const key = idempotencyKey || (
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `e11-${crypto.randomUUID()}`
        : `e11-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    const json = await this.request('/api/v1/client/commands', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ type, payload }),
    });

    return {
      success: Boolean(json?.success),
      state: json?.state,
      events: json?.events || [],
      data: json?.data,
      error: json?.error,
    } as CommandResult<TData>;
  }

  async executeCommand<TData = any>(command: ICommand<TData>): Promise<CommandResult<TData>> {
    return this.executeDescriptor<TData>(command.type, (command as any).payload || {});
  }
}

export const authoritativeRuntimeClient = new AuthoritativeRuntimeClient();
