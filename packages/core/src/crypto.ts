// ============================================================================
// MeshSig — Crypto Layer
// Ed25519 identity, signing, verification, hashing.
// ============================================================================

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const DID_PREFIX = 'did:msig:';

export interface AgentIdentity {
  did: string;
  publicKey: string;
  privateKey: string;
  createdAt: string;
}

export interface Capability {
  type: string;
  confidence?: number;
}

export type PermissionScope =
  | 'read:capabilities' | 'send:request' | 'send:broadcast'
  | 'execute:task' | 'read:status' | 'write:shared_state';

export interface HandshakeRequest {
  fromDid: string;
  toDid: string;
  nonce: string;
  timestamp: string;
  signature: string;
  requestedPermissions: PermissionScope[];
}

export interface HandshakeResponse {
  accepted: boolean;
  nonce: string;
  signature: string;
  grantedPermissions: PermissionScope[];
  channelId: string;
}

export class MeshError extends Error {
  constructor(message: string, public code: string, public statusCode = 500) {
    super(message);
    this.name = 'MeshError';
  }
}

// -- Identity ----------------------------------------------------------------

export async function generateIdentity(): Promise<AgentIdentity> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return {
    did: `${DID_PREFIX}${bs58.encode(pub)}`,
    publicKey: Buffer.from(pub).toString('base64'),
    privateKey: Buffer.from(priv).toString('base64'),
    createdAt: new Date().toISOString(),
  };
}

export function didToPublicKey(did: string): Uint8Array {
  if (!did.startsWith(DID_PREFIX)) throw new MeshError(`Invalid DID: ${did}`, 'INVALID_DID', 400);
  const bytes = bs58.decode(did.slice(DID_PREFIX.length));
  if (bytes.length !== 32) throw new MeshError('Invalid DID key length', 'INVALID_DID', 400);
  return bytes;
}

export function isValidDid(did: string): boolean {
  try { didToPublicKey(did); return true; } catch { return false; }
}

// -- Signing -----------------------------------------------------------------

export async function sign(message: string, privateKeyBase64: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyBase64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

export async function verify(message: string, signature: string, publicKeyBase64: string): Promise<boolean> {
  try {
    return await ed.verifyAsync(
      Buffer.from(signature, 'base64'),
      new TextEncoder().encode(message),
      Buffer.from(publicKeyBase64, 'base64'),
    );
  } catch { return false; }
}

export async function verifyWithDid(message: string, signature: string, did: string): Promise<boolean> {
  return verify(message, signature, Buffer.from(didToPublicKey(did)).toString('base64'));
}

export function hashPayload(payload: unknown): string {
  return Buffer.from(sha256(new TextEncoder().encode(JSON.stringify(payload)))).toString('hex');
}

export function generateNonce(): string {
  return Buffer.from(ed.utils.randomPrivateKey()).toString('base64');
}

// -- Handshake ---------------------------------------------------------------

export async function createHandshakeRequest(
  fromDid: string, toDid: string, privateKey: string, permissions: PermissionScope[],
): Promise<HandshakeRequest> {
  const nonce = generateNonce();
  const timestamp = new Date().toISOString();
  return {
    fromDid, toDid, nonce, timestamp,
    signature: await sign(`${nonce}${toDid}${timestamp}`, privateKey),
    requestedPermissions: permissions,
  };
}

export async function verifyHandshakeRequest(req: HandshakeRequest, publicKey: string): Promise<boolean> {
  const age = Date.now() - new Date(req.timestamp).getTime();
  if (age > 60_000) throw new MeshError('Handshake expired', 'HANDSHAKE_EXPIRED', 400);
  if (age < -5_000) throw new MeshError('Handshake from future', 'HANDSHAKE_EXPIRED', 400);
  const valid = await verify(`${req.nonce}${req.toDid}${req.timestamp}`, req.signature, publicKey);
  if (!valid) throw new MeshError('Invalid signature', 'INVALID_SIGNATURE', 401);
  return true;
}

export async function createHandshakeResponse(
  req: HandshakeRequest, responderDid: string, privateKey: string,
  accepted: boolean, permissions: PermissionScope[], channelId: string,
): Promise<HandshakeResponse> {
  const nonce = generateNonce();
  return {
    accepted, nonce, channelId: accepted ? channelId : '',
    signature: await sign(`${req.nonce}${req.fromDid}${nonce}`, privateKey),
    grantedPermissions: accepted ? permissions : [],
  };
}

export async function verifyHandshakeResponse(
  res: HandshakeResponse, req: HandshakeRequest, publicKey: string,
): Promise<boolean> {
  if (!res.accepted) return true;
  const valid = await verify(`${req.nonce}${req.fromDid}${res.nonce}`, res.signature, publicKey);
  if (!valid) throw new MeshError('Invalid response signature', 'INVALID_SIGNATURE', 401);
  return true;
}
