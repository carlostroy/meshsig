// ============================================================================
// MeshSig — Authentication & Security Middleware
// ============================================================================

import { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface AuthConfig {
  apiKey: string;
  corsOrigins: string[];
  maxBodySize: number;
  rateLimit: number;
  rateWindow: number;
  replayWindow: number;
}

const DEFAULT_CONFIG: AuthConfig = {
  apiKey: '',
  corsOrigins: [],
  maxBodySize: 1_048_576,
  rateLimit: 100,
  rateWindow: 60_000,
  replayWindow: 300_000,
};

export function loadAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  const envKey = process.env.MESHSIG_API_KEY || '';
  const envOrigins = process.env.MESHSIG_CORS_ORIGINS || '';

  if (!envKey) {
    console.warn(
      '\n⚠️  MESHSIG_API_KEY not set. Generating random key for this session.\n' +
      '   Set MESHSIG_API_KEY in .env for persistent authentication.\n'
    );
  }

  return {
    ...DEFAULT_CONFIG,
    apiKey: envKey || `msig_${randomBytes(24).toString('hex')}`,
    corsOrigins: envOrigins ? envOrigins.split(',').map(s => s.trim()) : [],
    ...overrides,
  };
}

const PUBLIC_ROUTES: Array<{ method: string; path: string | RegExp }> = [
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/dashboard' },
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/verify' },
  { method: 'POST', path: '/verify' },
  { method: 'GET', path: '/revoked' },
  { method: 'OPTIONS', path: /.*/ },
];

export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some(r => {
    if (r.method !== method) return false;
    if (r.path instanceof RegExp) return r.path.test(path);
    return r.path === path;
  });
}

export function checkAuth(req: IncomingMessage, config: AuthConfig): { ok: boolean; error?: string } {
  const authHeader = req.headers['authorization'] || '';
  const apiKeyHeader = req.headers['x-api-key'] as string || '';

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (safeCompare(token, config.apiKey)) return { ok: true };
  }

  if (apiKeyHeader && safeCompare(apiKeyHeader, config.apiKey)) return { ok: true };

  return { ok: false, error: 'Invalid or missing API key. Use Authorization: Bearer <key> or x-api-key header.' };
}

export function checkWsAuth(req: IncomingMessage, config: AuthConfig): boolean {
  // Prefer Authorization header (most secure — not logged)
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken && safeCompare(bearerToken, config.apiKey)) return true;
  }

  // Support Sec-WebSocket-Protocol as auth transport (avoids URL exposure)
  const protocols = req.headers['sec-websocket-protocol'] || '';
  const protoToken = protocols.split(',').map(s => s.trim()).find(s => s.startsWith('meshsig-auth.'));
  if (protoToken) {
    const token = protoToken.slice('meshsig-auth.'.length);
    if (token && safeCompare(token, config.apiKey)) return true;
  }

  // Fallback: query param (least secure — visible in logs, discouraged)
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const token = url.searchParams.get('token') || '';
  if (token && safeCompare(token, config.apiKey)) return true;

  return false;
}

export function setCorsHeaders(res: ServerResponse, req: IncomingMessage, config: AuthConfig): void {
  const origin = req.headers['origin'] || '';
  const SAFE_LOCAL_ORIGINS = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  if (config.corsOrigins.length === 0) {
    if (origin && SAFE_LOCAL_ORIGINS.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  } else {
    if (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-meshsig-caller');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function readBodyWithLimit(req: IncomingMessage, maxSize: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) { req.destroy(); reject(new BodyTooLargeError(maxSize)); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (totalSize === 0) { resolve(null); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export class BodyTooLargeError extends Error {
  public statusCode = 413;
  constructor(maxSize: number) {
    super(`Request body exceeds maximum size of ${Math.round(maxSize / 1024)}KB`);
    this.name = 'BodyTooLargeError';
  }
}

export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private limit: number;
  private window: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.window = windowMs;
    setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.buckets) {
        if (now > val.resetAt) this.buckets.delete(key);
      }
    }, 60_000).unref();
  }

  getClientIp(req: IncomingMessage): string {
    // Support trusted proxy headers for accurate client IP detection
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
      if (first) return first;
    }
    const realIp = req.headers['x-real-ip'];
    if (realIp) return typeof realIp === 'string' ? realIp : realIp[0];
    return req.socket.remoteAddress || 'unknown';
  }

  check(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.buckets.get(ip);
    if (!entry || now > entry.resetAt) {
      this.buckets.set(ip, { count: 1, resetAt: now + this.window });
      return { allowed: true, remaining: this.limit - 1, resetAt: now + this.window };
    }
    entry.count++;
    const allowed = entry.count <= this.limit;
    return { allowed, remaining: Math.max(0, this.limit - entry.count), resetAt: entry.resetAt };
  }
}

export class ReplayGuard {
  private seen = new Map<string, number>();
  private windowMs: number;

  constructor(windowMs: number = 300_000) {
    this.windowMs = windowMs;
    setInterval(() => {
      const cutoff = Date.now() - this.windowMs;
      for (const [key, ts] of this.seen) {
        if (ts < cutoff) this.seen.delete(key);
      }
    }, 120_000).unref();
  }

  check(signature: string): boolean {
    const hash = createHash('sha256').update(signature).digest('hex');
    if (this.seen.has(hash)) return false;
    this.seen.set(hash, Date.now());
    return true;
  }
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function validateAgentName(name: unknown): { valid: boolean; error?: string; sanitized?: string } {
  if (typeof name !== 'string') return { valid: false, error: 'name must be a string' };
  const trimmed = name.trim();
  if (trimmed.length === 0) return { valid: false, error: 'name cannot be empty' };
  if (trimmed.length > 100) return { valid: false, error: 'name exceeds 100 characters' };
  if (!/^[\w\s\-À-ÿ]+$/u.test(trimmed)) return { valid: false, error: 'name contains invalid characters' };
  return { valid: true, sanitized: trimmed };
}

export function validateCapabilities(caps: unknown): { valid: boolean; error?: string; sanitized?: any[] } {
  if (!Array.isArray(caps)) return { valid: true, sanitized: [] };
  if (caps.length > 20) return { valid: false, error: 'too many capabilities (max 20)' };
  const sanitized = caps.map(c => {
    if (typeof c === 'string') return { type: c.slice(0, 50), confidence: 0.8 };
    if (typeof c === 'object' && c !== null) {
      return {
        type: String(c.type || 'general').slice(0, 50),
        confidence: Math.min(1, Math.max(0, Number(c.confidence) || 0.8)),
      };
    }
    return { type: 'general', confidence: 0.8 };
  });
  return { valid: true, sanitized };
}

export function jsonError(res: ServerResponse, status: number, error: string, extra?: Record<string, unknown>): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  const body: Record<string, unknown> = { error };
  if (extra && process.env.NODE_ENV === 'development') Object.assign(body, extra);
  res.end(JSON.stringify(body));
}
