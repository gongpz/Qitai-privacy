const encoder = new TextEncoder();
const decoder = new TextDecoder();

function subtle() {
    const source = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (!source || !source.subtle) {
        throw new Error("当前环境不支持 Web Crypto API");
    }
    return source.subtle;
}

function toBase64(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function randomBytes(length) {
    const source = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (!source || !source.getRandomValues) {
        throw new Error("当前环境不支持安全随机数");
    }
    return source.getRandomValues(new Uint8Array(length));
}

function equalText(left, right) {
    if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < left.length; i++) {
        diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
    }
    return diff === 0;
}

async function deriveBits(password, saltBase64, iterations) {
    const rounds = iterations || 100000;
    const material = await subtle().importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle().deriveBits({
        name: "PBKDF2",
        salt: fromBase64(saltBase64),
        iterations: rounds,
        hash: "SHA-256"
    }, material, 256);
    return new Uint8Array(bits);
}

async function deriveKey(password, saltBase64, usages) {
    const material = await subtle().importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return subtle().deriveKey({
        name: "PBKDF2",
        salt: fromBase64(saltBase64),
        iterations: 100000,
        hash: "SHA-256"
    }, material, {name: "AES-GCM", length: 256}, false, usages);
}

async function encryptPayload(key, value) {
    const iv = randomBytes(12);
    const plain = encoder.encode(JSON.stringify(value));
    const cipher = await subtle().encrypt({name: "AES-GCM", iv}, key, plain);
    return {iv: Array.from(iv), data: Array.from(new Uint8Array(cipher))};
}

async function decryptPayload(key, payload) {
    if (!payload || !Array.isArray(payload.iv) || !Array.isArray(payload.data)) {
        throw new Error("密文格式无效");
    }
    const plain = await subtle().decrypt({
        name: "AES-GCM",
        iv: new Uint8Array(payload.iv)
    }, key, new Uint8Array(payload.data));
    return JSON.parse(decoder.decode(plain));
}

async function createVerifier(password, saltBase64) {
    return toBase64(await deriveBits(password, saltBase64));
}

async function verifyPassword(password, saltBase64, verifier) {
    try {
        return equalText(await createVerifier(password, saltBase64), verifier);
    } catch (error) {
        return false;
    }
}

async function wrapSecret(password, saltBase64, secret) {
    const key = await deriveKey(password, saltBase64, ["encrypt"]);
    return encryptPayload(key, {secret: toBase64(secret)});
}

async function unwrapSecret(password, saltBase64, payload) {
    const key = await deriveKey(password, saltBase64, ["decrypt"]);
    const result = await decryptPayload(key, payload);
    return fromBase64(result.secret);
}

async function importRawKey(rawBase64, usages) {
    return subtle().importKey("raw", fromBase64(rawBase64), "AES-GCM", false, usages || ["encrypt", "decrypt"]);
}

async function importContentKey(rawBase64) {
    return importRawKey(rawBase64, ["encrypt", "decrypt"]);
}

async function encryptText(key, plainText) {
    const iv = randomBytes(12);
    const cipher = await subtle().encrypt({name: "AES-GCM", iv}, key, encoder.encode(plainText));
    return {iv: Array.from(iv), data: Array.from(new Uint8Array(cipher))};
}

async function decryptText(key, payload) {
    const plain = await subtle().decrypt({
        name: "AES-GCM",
        iv: new Uint8Array(payload.iv)
    }, key, new Uint8Array(payload.data));
    return decoder.decode(plain);
}

module.exports = {
    toBase64,
    fromBase64,
    randomBytes,
    deriveKey,
    encryptPayload,
    decryptPayload,
    createVerifier,
    verifyPassword,
    wrapSecret,
    unwrapSecret,
    importRawKey,
    importContentKey,
    encryptText,
    decryptText
};
