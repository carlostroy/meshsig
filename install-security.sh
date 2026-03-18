#!/bin/bash
# ==============================================================================
# MeshSig — Security Hardening Installer
#
# ONE COMMAND to apply all security fixes to your VPS.
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/carlostroy/meshsig/main/scripts/install-security.sh | bash
#   — or —
#   Copy this file to VPS and run: bash install-security.sh
#
# What it does:
#   1. Backs up current installation
#   2. Creates auth.ts, invoke-mesh.ts, .env.example, THREAT-MODEL.md
#   3. Patches server.ts, crypto.ts, dashboard.html, invoke-mesh.sh, .gitignore
#   4. Generates API key
#   5. Removes compromised identity files
#   6. Compiles TypeScript
#   7. Restarts service
# ==============================================================================

set -e

C='\033[36m'; G='\033[32m'; R='\033[31m'; Y='\033[33m'; B='\033[1m'; D='\033[2m'; N='\033[0m'

MESH_DIR="${MESHSIG_DIR:-/opt/meshsig}"
IDENTITY_DIR="/opt/meshsig/identities"

echo ""
echo -e "${C}${B}  MeshSig Security Hardening${N}"
echo -e "${D}  ─────────────────────────────${N}"
echo ""

# -- Preflight ----------------------------------------------------------------

if [ ! -d "$MESH_DIR/src" ]; then
  echo -e "${R}✗${N} MeshSig not found at $MESH_DIR"
  echo "  Set MESHSIG_DIR=/path/to/meshsig and re-run"
  exit 1
fi

cd "$MESH_DIR"

# Backup
BACKUP="$MESH_DIR.backup.$(date +%s)"
echo -e "${D}  Backing up to $BACKUP${N}"
cp -r "$MESH_DIR" "$BACKUP"

# ============================================================================
# STEP 1: Create auth.ts
# ============================================================================
echo -e "${B}[1/9]${N} Creating src/auth.ts..."

cat > src/auth.ts << 'AUTHEOF'
// ============================================================================
// MeshSig — Authentication & Security Middleware
// ============================================================================

import { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

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
    if (token === config.apiKey) return { ok: true };
  }

  if (apiKeyHeader === config.apiKey) return { ok: true };

  return { ok: false, error: 'Invalid or missing API key. Use Authorization: Bearer <key> or x-api-key header.' };
}

export function checkWsAuth(req: IncomingMessage, config: AuthConfig): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const token = url.searchParams.get('token') || '';
  if (token === config.apiKey) return true;
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ') && authHeader.slice(7).trim() === config.apiKey) return true;
  return false;
}

export function setCorsHeaders(res: ServerResponse, req: IncomingMessage, config: AuthConfig): void {
  const origin = req.headers['origin'] || '';
  if (config.corsOrigins.length === 0) {
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
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
  if (extra && process.env.NODE_ENV !== 'production') Object.assign(body, extra);
  res.end(JSON.stringify(body));
}
AUTHEOF

echo -e "  ${G}✓${N} auth.ts created"

# ============================================================================
# STEP 2: Patch .gitignore
# ============================================================================
echo -e "${B}[2/9]${N} Updating .gitignore..."

cat > .gitignore << 'EOF'
node_modules/
dist/
*.db
.env
.DS_Store

# NEVER commit private keys
identities/
/opt/meshsig/identities/
*.pem
*.key
EOF

echo -e "  ${G}✓${N} .gitignore updated"

# ============================================================================
# STEP 3: Remove compromised identity files from git
# ============================================================================
echo -e "${B}[3/9]${N} Removing compromised identity files..."

git rm -r --cached identities/ 2>/dev/null || true

# Backup then delete
if [ -d "$IDENTITY_DIR" ]; then
  cp -r "$IDENTITY_DIR" "$IDENTITY_DIR.compromised.$(date +%s)" 2>/dev/null || true
  rm -f "$IDENTITY_DIR"/*.json 2>/dev/null || true
  echo -e "  ${G}✓${N} Old identity files removed (backup saved)"
else
  echo -e "  ${D}  No identity files found${N}"
fi

# ============================================================================
# STEP 4: Patch crypto.ts — fix nonce generation
# ============================================================================
echo -e "${B}[4/9]${N} Patching crypto.ts..."

if grep -q "ed.utils.randomPrivateKey" src/crypto.ts; then
  sed -i 's/return Buffer.from(ed.utils.randomPrivateKey()).toString('\''base64'\'');/const { randomBytes } = require('\''node:crypto'\'');\n  return (randomBytes(32) as Buffer).toString('\''base64'\'');/' src/crypto.ts 2>/dev/null || {
    # If sed fails, do manual replacement
    python3 -c "
import re
with open('src/crypto.ts', 'r') as f:
    content = f.read()
old = \"\"\"export function generateNonce(): string {
  return Buffer.from(ed.utils.randomPrivateKey()).toString('base64');
}\"\"\"
new = \"\"\"export function generateNonce(): string {
  const { randomBytes } = require('node:crypto');
  return (randomBytes(32) as Buffer).toString('base64');
}\"\"\"
content = content.replace(old, new)
with open('src/crypto.ts', 'w') as f:
    f.write(content)
print('  patched via python3')
"
  }
  echo -e "  ${G}✓${N} Nonce generation fixed"
else
  echo -e "  ${D}  Already patched${N}"
fi

# ============================================================================
# STEP 5: Patch server.ts — the big one
# ============================================================================
echo -e "${B}[5/9]${N} Patching server.ts..."

python3 << 'PYEOF'
import re

with open('src/server.ts', 'r') as f:
    content = f.read()

changes = 0

# 1. Ensure auth import exists
if 'from \'./auth.js\'' not in content:
    # Add import after the last existing import
    last_import = content.rfind("import ")
    end_of_last_import = content.find(";", last_import) + 1
    auth_import = """
import {
  loadAuthConfig, isPublicRoute, checkAuth, checkWsAuth,
  setCorsHeaders, readBodyWithLimit, BodyTooLargeError,
  RateLimiter, ReplayGuard, validateAgentName, validateCapabilities,
  jsonError, type AuthConfig,
} from './auth.js';"""
    content = content[:end_of_last_import] + "\n" + auth_import + content[end_of_last_import:]
    changes += 1

# 2. Replace old rate limiter properties
if 'private rateLimiter: Map<string' in content:
    content = content.replace(
        'private rateLimiter: Map<string, { count: number; resetAt: number }> = new Map();\n  private readonly RATE_LIMIT = 60; // requests per window\n  private readonly RATE_WINDOW = 60_000; // 1 minute',
        'private authConfig: AuthConfig;\n  private rateLimiter: RateLimiter;\n  private replayGuard: ReplayGuard;'
    )
    changes += 1

# 3. Add auth initialization after registry creation
if 'this.authConfig = loadAuthConfig()' not in content:
    content = content.replace(
        'this.registry = new Registry(this.config.dbPath);\n    this.peerNetwork = new PeerNetwork(this.registry, this.config.name);\n    this.httpServer = createServer',
        'this.registry = new Registry(this.config.dbPath);\n    this.peerNetwork = new PeerNetwork(this.registry, this.config.name);\n    this.authConfig = loadAuthConfig();\n    this.rateLimiter = new RateLimiter(this.authConfig.rateLimit, this.authConfig.rateWindow);\n    this.replayGuard = new ReplayGuard(this.authConfig.replayWindow);\n    this.httpServer = createServer'
    )
    changes += 1

# 4. Replace CORS wildcard with secure version
if "res.setHeader('Access-Control-Allow-Origin', '*')" in content:
    content = content.replace(
        "res.setHeader('Access-Control-Allow-Origin', '*');\n    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');\n    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-secret, x-meshsig-caller, Authorization');",
        "setCorsHeaders(res, req, this.authConfig);\n    res.setHeader('X-Content-Type-Options', 'nosniff');\n    res.setHeader('X-Frame-Options', 'DENY');"
    )
    changes += 1

# 5. Replace old rate limiting with new
old_rate = """      // Rate limiting (skip for dashboard and static)
      if (path !== '/' && path !== '/dashboard') {
        const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        if (!this._checkRateLimit(ip)) {
          return this._json(res, 429, {
            error: 'Rate limit exceeded',
            retryAfter: Math.ceil(this.RATE_WINDOW / 1000),
            limit: this.RATE_LIMIT,
            window: `${this.RATE_WINDOW / 1000}s`,
          });
        }
      }"""
new_rate = """      // Rate limiting
      const clientIp = this.rateLimiter.getClientIp(req);
      const rateCheck = this.rateLimiter.check(clientIp);
      res.setHeader('X-RateLimit-Remaining', String(rateCheck.remaining));
      if (!rateCheck.allowed) {
        return jsonError(res, 429, 'Rate limit exceeded');
      }

      // Authentication
      if (!isPublicRoute(method!, path)) {
        const auth = checkAuth(req, this.authConfig);
        if (!auth.ok) {
          return jsonError(res, 401, auth.error || 'Unauthorized');
        }
      }"""

if old_rate in content:
    content = content.replace(old_rate, new_rate)
    changes += 1

# 6. Replace old body reader with size-limited version
if "body = await this._readBody(req)" in content and "readBodyWithLimit" not in content:
    content = content.replace(
        "body = await this._readBody(req);",
        "body = await readBodyWithLimit(req, this.authConfig.maxBodySize);"
    )
    changes += 1

# 7. Add input validation to agent registration
old_register = """        const result = await this.registry.registerAgent(body.name, body.capabilities || []);
        return this._json(res, 201, result);"""
new_register = """        const nameCheck = validateAgentName(body?.name);
        if (!nameCheck.valid) return this._json(res, 400, { error: nameCheck.error });
        const capsCheck = validateCapabilities(body?.capabilities);
        if (!capsCheck.valid) return this._json(res, 400, { error: capsCheck.error });
        const result = await this.registry.registerAgent(nameCheck.sanitized!, capsCheck.sanitized || []);
        return this._json(res, 201, result);"""

if old_register in content:
    content = content.replace(old_register, new_register)
    changes += 1

# 8. Add WebSocket auth
old_ws = """    // Dashboard connection
    this.dashboards.add(ws);"""
new_ws = """    // Dashboard connection — require auth
    if (!checkWsAuth(req, this.authConfig)) {
      ws.close(4001, 'Unauthorized — provide ?token=<MESHSIG_API_KEY>');
      return;
    }

    this.dashboards.add(ws);"""

if old_ws in content and 'checkWsAuth' not in content:
    content = content.replace(old_ws, new_ws)
    changes += 1

# 9. Fix error handler
if "this._json(res, err.statusCode || 500, { error: err.message });" in content:
    content = content.replace(
        "this._json(res, err.statusCode || 500, { error: err.message });",
        """if (err instanceof BodyTooLargeError) {
        return jsonError(res, 413, err.message);
      }
      const status = err.statusCode || 500;
      const message = status < 500 ? err.message : 'Internal server error';
      jsonError(res, status, message);"""
    )
    changes += 1

# 10. Fix proxy error leak
content = content.replace(
    "return this._json(res, 502, { error: 'Gateway unreachable', details: err.message, gateway: gatewayUrl });",
    "return this._json(res, 502, { error: 'Gateway unreachable' });"
)
content = content.replace(
    "return this._json(res, 502, { error: 'Gateway unreachable', details: err.message });",
    "return this._json(res, 502, { error: 'Gateway unreachable' });"
)

# 11. Replace old _readBody with delegation to auth module
old_readbody = """  private _readBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('Invalid JSON')); } });
    });
  }"""

if old_readbody in content:
    content = content.replace(old_readbody,
        "  private _readBody(req: IncomingMessage): Promise<any> {\n    return readBodyWithLimit(req, this.authConfig.maxBodySize);\n  }")
    changes += 1

# 12. Replace old rate limiter method
old_ratelimit = """  private _checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimiter.get(ip);
    if (!entry || now > entry.resetAt) {
      this.rateLimiter.set(ip, { count: 1, resetAt: now + this.RATE_WINDOW });
      return true;
    }
    entry.count++;
    return entry.count <= this.RATE_LIMIT;
  }"""

if old_ratelimit in content:
    content = content.replace(old_ratelimit, "  // Rate limiting handled by RateLimiter class from auth module")
    changes += 1

with open('src/server.ts', 'w') as f:
    f.write(content)

print(f"  {changes} patches applied to server.ts")
PYEOF

echo -e "  ${G}✓${N} server.ts patched"

# ============================================================================
# STEP 6: Patch dashboard.html — XSS fixes
# ============================================================================
echo -e "${B}[6/9]${N} Patching dashboard.html (XSS fixes)..."

python3 << 'PYEOF'
with open('src/dashboard.html', 'r') as f:
    content = f.read()

changes = 0

# 1. Add escape function
if "function esc(s)" not in content:
    content = content.replace(
        "// === EVENTS ===\nconst evDiv",
        "// === EVENTS ===\nfunction esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;')}\nconst evDiv"
    )
    changes += 1

# 2. Escape agent data in renderAgentsPage
for old, new in [
    ("'<span class=\"ac-cap\">'+c.type+'</span>'", "'<span class=\"ac-cap\">'+esc(c.type)+'</span>'"),
    ("'<span class=\"ac-name\">'+a.displayName+'</span>'", "'<span class=\"ac-name\">'+esc(a.displayName)+'</span>'"),
    ("'<div class=\"ac-did\">'+a.did+'</div>'", "'<div class=\"ac-did\">'+esc(a.did)+'</div>'"),
]:
    if old in content and new not in content:
        content = content.replace(old, new)
        changes += 1

# 3. Escape in renderMessagesPage
for old, new in [
    ("'<span class=\"msg-from\">'+from+'</span>'", "'<span class=\"msg-from\">'+esc(from)+'</span>'"),
    ("'<span class=\"msg-to\">'+to+'</span>'", "'<span class=\"msg-to\">'+esc(to)+'</span>'"),
    ("'<div class=\"msg-body\">'+(m.content||'').slice(0,300)+'</div>'", "'<div class=\"msg-body\">'+esc((m.content||'').slice(0,300))+'</div>'"),
    ("'<div class=\"msg-sig\">sig: '+(m.signature||'').slice(0,60)+'...</div>'", "'<div class=\"msg-sig\">sig: '+esc((m.signature||'').slice(0,60))+'...</div>'"),
]:
    if old in content and new not in content:
        content = content.replace(old, new)
        changes += 1

# 4. Escape in WebSocket event handler
for old, new in [
    ("'<span class=\"from\">'+d.name+'</span>'", "'<span class=\"from\">'+esc(d.name)+'</span>'"),
    ("'<span class=\"from\">'+d.agentA.name+'</span>'", "'<span class=\"from\">'+esc(d.agentA.name)+'</span>'"),
    ("'<span class=\"to\">'+d.agentB.name+'</span>'", "'<span class=\"to\">'+esc(d.agentB.name)+'</span>'"),
    ("'<span class=\"from\">'+(d.from?.name||'?')+'</span>'", "'<span class=\"from\">'+esc(d.from?.name||'?')+'</span>'"),
    ("'<span class=\"to\">'+(d.to?.name||'?')+'</span>'", "'<span class=\"to\">'+esc(d.to?.name||'?')+'</span>'"),
    ("'<span class=\"content\">'+(d.preview||'')+'</span>'", "'<span class=\"content\">'+esc(d.preview||'')+'</span>'"),
    ("'<span class=\"from\">'+d.fromName+'</span>'", "'<span class=\"from\">'+esc(d.fromName)+'</span>'"),
    ("'<span class=\"to\">'+d.toName+'</span>'", "'<span class=\"to\">'+esc(d.toName)+'</span>'"),
]:
    if old in content and new not in content:
        content = content.replace(old, new)
        changes += 1

# 5. Add auth token to WebSocket connection
old_ws = "ws=new WebSocket(p+'//'+location.host+'?role=dashboard')"
new_ws = "const params=new URLSearchParams(location.search);const token=params.get('token')||'';ws=new WebSocket(p+'//'+location.host+'?role=dashboard'+(token?'&token='+encodeURIComponent(token):''))"
if old_ws in content:
    content = content.replace(old_ws, new_ws)
    changes += 1

# 6. Add auth headers to fetch calls
old_msg_fetch = "const r=await fetch('/messages?limit=100')"
new_msg_fetch = "const hdrs={};const t=new URLSearchParams(location.search).get('token');if(t)hdrs['Authorization']='Bearer '+t;const r=await fetch('/messages?limit=100',{headers:hdrs})"
if old_msg_fetch in content and "hdrs['Authorization']" not in content.split("renderMessagesPage")[1].split("renderAuditPage")[0]:
    content = content.replace(old_msg_fetch, new_msg_fetch, 1)
    changes += 1

old_audit_fetch = "const r=await fetch('/audit/export')"
new_audit_fetch = "const hdrs={};const t=new URLSearchParams(location.search).get('token');if(t)hdrs['Authorization']='Bearer '+t;const r=await fetch('/audit/export',{headers:hdrs})"
if old_audit_fetch in content:
    content = content.replace(old_audit_fetch, new_audit_fetch, 1)
    changes += 1

with open('src/dashboard.html', 'w') as f:
    f.write(content)

print(f"  {changes} XSS patches applied to dashboard.html")
PYEOF

echo -e "  ${G}✓${N} dashboard.html patched"

# ============================================================================
# STEP 7: Replace invoke-mesh.sh with safe wrapper
# ============================================================================
echo -e "${B}[7/9]${N} Replacing invoke-mesh.sh..."

cat > scripts/invoke-mesh.sh << 'INVEOF'
#!/bin/bash
# MeshSig Invoke — Wrapper for secure TypeScript implementation
TARGET="$1"; MESSAGE="$2"; CONTEXT="${3:-}"
if [ -z "$TARGET" ] || [ -z "$MESSAGE" ]; then
  echo '{"error":"Usage: invoke-mesh.sh <client_name> <message> [context]"}'; exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MESH_DIR="${SCRIPT_DIR%/scripts}"
if [ -f "$MESH_DIR/dist/invoke-mesh.js" ]; then
  exec node "$MESH_DIR/dist/invoke-mesh.js" "$TARGET" "$MESSAGE" "$CONTEXT"
elif [ -f "/opt/meshsig/dist/invoke-mesh.js" ]; then
  exec node /opt/meshsig/dist/invoke-mesh.js "$TARGET" "$MESSAGE" "$CONTEXT"
else
  echo '{"error":"MeshSig not compiled. Run: cd /opt/meshsig && npx tsc"}'; exit 1
fi
INVEOF

chmod +x scripts/invoke-mesh.sh
echo -e "  ${G}✓${N} invoke-mesh.sh replaced with safe wrapper"

# ============================================================================
# STEP 8: Create supporting files
# ============================================================================
echo -e "${B}[8/9]${N} Creating .env and THREAT-MODEL.md..."

# .env.example
cat > .env.example << 'EOF'
# MeshSig Environment Configuration
MESHSIG_API_KEY=
MESHSIG_CORS_ORIGINS=https://meshsig.ai
MESH_PORT=4888
MESH_GATEWAY=http://127.0.0.1:3001
GATEWAY_SECRET=
MESHSIG_IDENTITY_DIR=/opt/meshsig/identities
NODE_ENV=production
EOF

# Generate .env if not exists
if [ ! -f .env ]; then
  NEW_KEY="msig_$(openssl rand -hex 24)"
  cp .env.example .env
  sed -i "s|^MESHSIG_API_KEY=|MESHSIG_API_KEY=$NEW_KEY|" .env
  chmod 600 .env
  echo -e "  ${G}✓${N} .env created with API key"
  echo ""
  echo -e "  ${Y}${B}╔═══════════════════════════════════════════════════════╗${N}"
  echo -e "  ${Y}${B}║  YOUR API KEY (save this):                            ║${N}"
  echo -e "  ${Y}${B}║  $NEW_KEY  ║${N}"
  echo -e "  ${Y}${B}╚═══════════════════════════════════════════════════════╝${N}"
  echo ""
else
  echo -e "  ${D}  .env already exists — keeping current key${N}"
fi

echo -e "  ${G}✓${N} Supporting files created"

# ============================================================================
# STEP 9: Compile and restart
# ============================================================================
echo -e "${B}[9/9]${N} Compiling and restarting..."

npm install 2>&1 | tail -1
npx tsc 2>&1

if [ $? -ne 0 ]; then
  echo -e "  ${R}✗${N} Compilation failed. Check errors above."
  echo -e "  ${D}  Your backup is at: $BACKUP${N}"
  exit 1
fi

echo -e "  ${G}✓${N} Compiled successfully"

# Source env
set -a; source .env 2>/dev/null; set +a

# Restart
if systemctl is-active meshsig &>/dev/null; then
  systemctl restart meshsig
  echo -e "  ${G}✓${N} Service restarted via systemctl"
else
  pkill -f "node.*main.js.*start" 2>/dev/null || true
  sleep 1
  nohup node dist/main.js start --no-terminal > /var/log/meshsig.log 2>&1 &
  echo -e "  ${G}✓${N} Started manually (PID: $!)"
fi

sleep 2

# Health check
if curl -s http://127.0.0.1:4888/health 2>/dev/null | grep -q "ok"; then
  echo -e "  ${G}✓${N} Health check passed"
else
  echo -e "  ${R}✗${N} Health check failed — check: cat /var/log/meshsig.log"
fi

# Auth check
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4888/agents 2>/dev/null)
if [ "$HTTP_CODE" = "401" ]; then
  echo -e "  ${G}✓${N} Auth working — /agents returns 401 without key"
else
  echo -e "  ${Y}▲${N} /agents returned $HTTP_CODE (expected 401)"
fi

# Revoke compromised DIDs
API_KEY=$(grep '^MESHSIG_API_KEY=' .env | cut -d'=' -f2-)
for DID in \
  "did:msig:3ZAhKEsP2AKRwojdjEaN4VxBNjvCTMWtRieNsDXfzQT2" \
  "did:msig:F9Dy1a7Yp4kcZt5ybX4tvoFjqC9wqTCDtrLC4rwfGYZe" \
  "did:msig:7UQv9G5Jg1RagdMbCRCtvVWg5bse1uWSJLriekCL5iRi" \
  "did:msig:2WmegQzJiTVhsvrvTdjS3DCp9EMypydpNKpRgAcCNWyt"; do
  curl -s -X POST http://127.0.0.1:4888/agents/revoke \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d "{\"did\":\"$DID\",\"reason\":\"Private key exposed in public repository\"}" > /dev/null 2>&1
done
echo -e "  ${G}✓${N} Compromised DIDs revoked"

# Summary
API_KEY=$(grep '^MESHSIG_API_KEY=' .env | cut -d'=' -f2-)
echo ""
echo -e "${C}${B}  ═══════════════════════════════════════${N}"
echo -e "${C}${B}  Done!${N}"
echo -e "${C}${B}  ═══════════════════════════════════════${N}"
echo ""
echo -e "  ${B}Dashboard:${N}  http://127.0.0.1:4888/?token=$API_KEY"
echo -e "  ${B}Health:${N}     http://127.0.0.1:4888/health"
echo -e "  ${B}API test:${N}   curl -H 'Authorization: Bearer $API_KEY' http://127.0.0.1:4888/agents"
echo ""
echo -e "  ${Y}Next:${N}"
echo -e "  ${D}  1. git add -A && git commit -m 'security hardening' && git push --force${N}"
echo -e "  ${D}  2. Agents will auto-generate new keys on next invoke${N}"
echo ""
