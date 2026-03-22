// @meshsig/sdk — Core SDK
// Cryptographic security layer for AI agents

export {
  generateIdentity,
  didToPublicKey,
  isValidDid,
  sign,
  verify,
  verifyWithDid,
  hashPayload,
  generateNonce,
  createHandshakeRequest,
  verifyHandshakeRequest,
  createHandshakeResponse,
  verifyHandshakeResponse,
  MeshError,
} from './crypto.js';

export {
  loadAuthConfig,
  checkAuth,
  checkWsAuth,
  setCorsHeaders,
  readBodyWithLimit,
  isPublicRoute,
  RateLimiter,
  ReplayGuard,
  escapeHtml,
  validateAgentName,
  validateCapabilities,
  jsonError,
  BodyTooLargeError,
} from './auth.js';

export type {
  AgentIdentity,
  Capability,
  PermissionScope,
  HandshakeRequest,
  HandshakeResponse,
} from './crypto.js';

export type { AuthConfig } from './auth.js';
