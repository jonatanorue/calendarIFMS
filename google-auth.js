const crypto = require("crypto");

const certsUrl = "https://www.googleapis.com/oauth2/v3/certs";
const googleIssuers = ["accounts.google.com", "https://accounts.google.com"];

let keyCache = { keys: new Map(), fetchedAt: 0, expiresAt: 0 };

async function getGoogleKey(kid) {
  const expired = Date.now() >= keyCache.expiresAt;
  const unknownKid = !keyCache.keys.has(kid) && Date.now() - keyCache.fetchedAt > 60 * 1000;
  if (expired || unknownKid) {
    const response = await fetch(certsUrl);
    if (!response.ok) throw new Error(`Falha ao obter as chaves do Google (${response.status})`);
    const { keys } = await response.json();
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") || "")?.[1] || 3600);
    keyCache = {
      keys: new Map(keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" })])),
      fetchedAt: Date.now(),
      expiresAt: Date.now() + maxAge * 1000,
    };
  }
  return keyCache.keys.get(kid);
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

// Valida o ID token (JWT) emitido pelo Google Identity Services e devolve o payload.
async function verifyGoogleIdToken(idToken, clientId) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Token malformado");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const header = decodeSegment(encodedHeader);
  if (header.alg !== "RS256") throw new Error("Algoritmo de assinatura inesperado");
  const key = await getGoogleKey(header.kid);
  if (!key) throw new Error("Chave de assinatura desconhecida");

  const signatureValid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    key,
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!signatureValid) throw new Error("Assinatura inválida");

  const payload = decodeSegment(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (!googleIssuers.includes(payload.iss)) throw new Error("Emissor inválido");
  if (payload.aud !== clientId) throw new Error("Token emitido para outro cliente");
  if (typeof payload.exp !== "number" || payload.exp + 60 < now) throw new Error("Token expirado");
  if (payload.email_verified !== true || !payload.email) throw new Error("E-mail não verificado pelo Google");
  return payload;
}

module.exports = { verifyGoogleIdToken };
