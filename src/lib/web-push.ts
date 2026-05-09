interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBuffers(...buffers: ArrayBuffer[]): Uint8Array {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    result.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return result;
}

async function createJwt(vapid: VapidKeys, audience: string): Promise<string> {
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: now + 43200,
    sub: vapid.subject,
  })));

  const privateKeyBytes = base64UrlDecode(vapid.privateKey);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: base64UrlEncode(privateKeyBytes),
    x: vapid.publicKey.slice(0, 43),
    y: vapid.publicKey.slice(43),
  };

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sigInput = new TextEncoder().encode(`${header}.${payload}`);
  const rawSig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, sigInput);
  const signature = base64UrlEncode(rawSig);

  return `${header}.${payload}.${signature}`;
}

async function encryptPayload(
  sub: PushSubscription,
  payload: string,
): Promise<{ body: ArrayBuffer; salt: string; publicKey: string }> {
  const clientPublicKey = base64UrlDecode(sub.p256dh);
  const clientAuth = base64UrlDecode(sub.auth);

  const localKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPublicKeyRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);

  const clientKey = await crypto.subtle.importKey('raw', clientPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, localKeyPair.privateKey, 256);

  const authInfo = new TextEncoder().encode('Content-Encoding: auth\0');
  const prkKey = await crypto.subtle.importKey('raw', clientAuth, { name: 'HKDF' }, false, ['deriveBits']);
  const ikm = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sharedSecret, info: authInfo }, prkKey, 256);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const cekInfo = concatBuffers(
    new TextEncoder().encode('Content-Encoding: aesgcm\0P-256\0'),
    new Uint8Array([0, clientPublicKey.length]),
    clientPublicKey,
    new Uint8Array([0, new Uint8Array(localPublicKeyRaw).length]),
    localPublicKeyRaw,
  );

  const nonceInfo = concatBuffers(
    new TextEncoder().encode('Content-Encoding: nonce\0P-256\0'),
    new Uint8Array([0, clientPublicKey.length]),
    clientPublicKey,
    new Uint8Array([0, new Uint8Array(localPublicKeyRaw).length]),
    localPublicKeyRaw,
  );

  const prkForCek = await crypto.subtle.importKey('raw', new Uint8Array(ikm), { name: 'HKDF' }, false, ['deriveBits']);
  const cekBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: cekInfo }, prkForCek, 128);
  const nonceBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: nonceInfo }, prkForCek, 96);

  const paddedPayload = concatBuffers(new Uint8Array([0, 0]), new TextEncoder().encode(payload));
  const encKey = await crypto.subtle.importKey('raw', cekBits, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBits }, encKey, paddedPayload);

  return {
    body: encrypted,
    salt: base64UrlEncode(salt),
    publicKey: base64UrlEncode(localPublicKeyRaw),
  };
}

export async function sendPushNotification(
  sub: PushSubscription,
  vapid: VapidKeys,
  payload: string,
): Promise<{ ok: boolean; status: number }> {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await createJwt(vapid, audience);
  const encrypted = await encryptPayload(sub, payload);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `WebPush ${jwt}`,
      'Crypto-Key': `dh=${encrypted.publicKey};p256ecdsa=${vapid.publicKey}`,
      'Encryption': `salt=${encrypted.salt}`,
      'Content-Encoding': 'aesgcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body: encrypted.body,
  });

  return { ok: res.ok, status: res.status };
}
