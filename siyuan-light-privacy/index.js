(function () {
var __modules = {
"index.js": function(require, module, exports) {
const siyuan = require("siyuan");
const {Store} = require("./store.js");
const {HookAdapter} = require("./hookAdapter.js");
const {Modal} = require("./modal.js");
const {Hook} = require("./hook.js");
const {ContextMenu} = require("./contextMenu.js");
const {Panel} = require("./panel.js");

const LOCK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.964 1.79a.75.75 0 0 1-.51.93A5.51 5.51 0 0 0 2.72 6.455a.75.75 0 0 1-1.44-.421A7.01 7.01 0 0 1 6.034 1.28a.75.75 0 0 1 .93.51m2.072 0a.75.75 0 0 1 .93-.51a7.003 7.003 0 0 1 4.176 10.08a.75.75 0 1 1-1.315-.72a5.503 5.503 0 0 0-3.281-7.92a.75.75 0 0 1-.51-.93M1.79 9.036a.75.75 0 0 1 .93.51a5.503 5.503 0 0 0 7.92 3.28a.75.75 0 1 1 .72 1.316A7.003 7.003 0 0 1 1.28 9.966a.75.75 0 0 1 .51-.93M8 5.5a2.5 2.5 0 0 0-1.153 4.719a.75.75 0 0 1-.694 1.33A4 4 0 1 1 12 8a.75.75 0 0 1-1.5 0A2.5 2.5 0 0 0 8 5.5m.742 2.392a.75.75 0 1 0-1.484.216c.252 1.726 1.493 3.001 3.18 3.14a.75.75 0 1 0 .123-1.495c-.918-.076-1.657-.751-1.819-1.861"/></svg>';

class LightPrivacyPlugin extends siyuan.Plugin {
    constructor(options) {
        super(options);
        const self = this;
        this.ctx = {
            plugin: this,
            siyuan,
            app: options && options.app,
            i18n: this.i18n || {},
            t: (key, fallback) => (self.i18n && self.i18n[key]) || fallback || key,
            showMessage: message => siyuan.showMessage(message, 3200),
            applyLpTheme: value => self.applyLpTheme(value)
        };
        this.store = new Store(this);
        this.ctx.store = this.store;
        this.modal = new Modal(this.ctx);
        this.ctx.modal = this.modal;
        this.adapter = new HookAdapter(this.ctx);
        this.ctx.adapter = this.adapter;
        this.hook = new Hook(this.ctx);
        this.ctx.hook = this.hook;
        this.contextMenu = new ContextMenu(this.ctx);
        this.ctx.contextMenu = this.contextMenu;
        this.panel = new Panel(this.ctx);
        this.ctx.panel = this.panel;
        this.topBarElement = null;
    }

    applyLpTheme(value) {
        const root = document.documentElement;
        if (value === "light" || value === "dark") {
            root.setAttribute("data-lp-theme", value);
        } else {
            root.removeAttribute("data-lp-theme");
        }
    }

    async onload() {
        const ok = await this.store.init();
        if (!ok) {
            siyuan.showMessage("轻态隐私：" + this.store.error, 8000);
        }
        this.applyLpTheme(this.store.config.theme);
        this.hook.init();
        this.contextMenu.init();
        this.exposeApi();
    }

    async onLayoutReady() {
        this.topBarElement = this.addTopBar({
            icon: LOCK_ICON,
            title: this.ctx.t("panelTitle", "轻态隐私 · 管理面板"),
            position: "right",
            callback: () => this.panel.open()
        });
        this.hook.scanEditors();
    }

    exposeApi() {
        const root = typeof globalThis !== "undefined" ? globalThis : window;
        if (!root.siyuan) {
            return;
        }
        root.siyuan.plugins = root.siyuan.plugins || {};
        root.siyuan.plugins.lightPrivacy = {
            isLocked: id => this.store.isLocked(id),
            getLockInfo: id => this.store.getLock(id),
            onUnlocked: callback => this.store.on("unlocked", callback),
            onLocked: callback => this.store.on("locked", callback)
        };
    }

    onunload() {
        this.adapter.offAll();
        this.hook.destroy();
        this.store.clearUnlocked();
        if (this.topBarElement && this.topBarElement.remove) {
            this.topBarElement.remove();
        }
        const root = typeof globalThis !== "undefined" ? globalThis : window;
        if (root.siyuan && root.siyuan.plugins) {
            delete root.siyuan.plugins.lightPrivacy;
        }
    }
}

module.exports = {default: LightPrivacyPlugin};

},
"store.js": function(require, module, exports) {
const crypto = require("./crypto.js");

const DEVICE_KEY_STORAGE = "lp_device_key_v1";
const BACKUP_HEADER = "LIGHT-PRIVACY-BACKUP-v1";
const KEY_HEADER = "LIGHT-PRIVACY-KEY-v1";
const DATA_VERSION = 1;

function defaultConfig() {
    return {
        enableMainPwd: false,
        mainPwdHash: "",
        hideInSearch: true,
        recycleAutoUnlock: true,
        enableContentEncrypt: false,
        autoLockOnCloseTab: true,
        idleAutoLock: true,
        idleMinutes: 10,
        theme: "auto"
    };
}

function emptyData() {
    return {config: defaultConfig(), lockList: []};
}

class Store {
    constructor(plugin) {
        this.plugin = plugin;
        this.raw = null;
        this.data = emptyData();
        this.deviceKey = null;
        this.unlocked = new Set();
        this.tempVisible = new Set();
        this.contentKeys = new Map();
        this.error = "";
        this.listeners = {unlocked: [], locked: []};
    }

    async init() {
        let saved = null;
        try {
            saved = await this.plugin.loadData("data.json");
        } catch (error) {
            this.error = "读取插件数据失败：" + error.message;
            return false;
        }
        if (!saved || !saved.payload) {
            const salt = crypto.toBase64(crypto.randomBytes(16));
            const deviceKey = crypto.toBase64(crypto.randomBytes(32));
            this.raw = {v: DATA_VERSION, salt, deviceKey, payload: null, updatedAt: Date.now()};
            this.deviceKey = await crypto.importRawKey(deviceKey, ["encrypt", "decrypt"]);
            this.data = emptyData();
            this.raw.payload = await crypto.encryptPayload(this.deviceKey, this.data);
            this.saveLocalDeviceKey(deviceKey);
            await this.persist();
            return true;
        }
        const deviceKeyBase64 = saved.deviceKey || this.getLocalDeviceKey();
        if (!deviceKeyBase64) {
            this.error = "本地设备密钥丢失，请导入密钥备份恢复。";
            this.raw = saved;
            return false;
        }
        try {
            this.deviceKey = await crypto.importRawKey(deviceKeyBase64, ["encrypt", "decrypt"]);
            this.data = await crypto.decryptPayload(this.deviceKey, saved.payload);
            this.data.config = Object.assign(defaultConfig(), this.data.config || {});
            if (!Array.isArray(this.data.lockList)) {
                this.data.lockList = [];
            }
            this.raw = saved;
            this.raw.salt = this.raw.salt || crypto.toBase64(crypto.randomBytes(16));
            this.raw.deviceKey = deviceKeyBase64;
            this.saveLocalDeviceKey(deviceKeyBase64);
            return true;
        } catch (error) {
            this.error = "插件数据解密失败：" + error.message;
            this.raw = saved;
            return false;
        }
    }

    getLocalDeviceKey() {
        try {
            return globalThis.localStorage ? localStorage.getItem(DEVICE_KEY_STORAGE) : null;
        } catch (error) {
            return null;
        }
    }

    saveLocalDeviceKey(value) {
        try {
            if (globalThis.localStorage) {
                localStorage.setItem(DEVICE_KEY_STORAGE, value);
            }
        } catch (error) {
            this.error = "本地设备密钥保存失败：" + error.message;
        }
    }

    async persist() {
        if (!this.raw) {
            return;
        }
        this.raw.updatedAt = Date.now();
        this.raw.payload = await crypto.encryptPayload(this.deviceKey, this.data);
        await this.plugin.saveData("data.json", this.raw);
    }

    get config() {
        return this.data.config;
    }

    get salt() {
        return this.raw.salt;
    }

    list() {
        return this.data.lockList;
    }

    getLock(id) {
        return this.data.lockList.find(item => item.id === id) || null;
    }

    isLocked(id) {
        return Boolean(this.getLock(id));
    }

    isUnlocked(id) {
        return this.unlocked.has(id);
    }

    unlock(id) {
        if (!this.unlocked.has(id)) {
            this.unlocked.add(id);
            this.emit("unlocked", id);
        }
    }

    lock(id) {
        if (this.unlocked.delete(id)) {
            this.contentKeys.delete(id);
            this.tempVisible.delete(id);
            this.emit("locked", id);
        }
    }

    clearUnlocked() {
        Array.from(this.unlocked).forEach(id => this.lock(id));
        this.tempVisible.clear();
    }

    setTempVisible(id, visible) {
        if (visible) {
            this.tempVisible.add(id);
        } else {
            this.tempVisible.delete(id);
        }
    }

    isHidden(id) {
        const item = this.getLock(id);
        return Boolean(item && item.encryptMode === "hidden" && !this.tempVisible.has(id));
    }

    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    emit(event, id) {
        (this.listeners[event] || []).forEach(callback => {
            try {
                callback(id);
            } catch (error) {
                console.error("Light Privacy listener error", error);
            }
        });
    }

    async addLock(options) {
        const password = options.password;
        if (!password) {
            throw new Error("密码不能为空");
        }
        const contentKey = crypto.randomBytes(32);
        const item = {
            id: options.id,
            type: options.type === "folder" ? "folder" : "doc",
            pwdHash: await crypto.createVerifier(password, this.salt),
            encryptMode: options.encryptMode === "hidden" ? "hidden" : "visible",
            recursive: Boolean(options.recursive),
            encryptKey: await crypto.wrapSecret(password, this.salt, contentKey),
            createAt: Date.now(),
            remark: options.remark || ""
        };
        this.data.lockList = this.data.lockList.filter(existing => existing.id !== item.id);
        this.data.lockList.push(item);
        await this.persist();
        this.lock(item.id);
        return item;
    }

    async verify(id, password) {
        const item = this.getLock(id);
        if (!item) {
            return true;
        }
        if (!await crypto.verifyPassword(password, this.salt, item.pwdHash)) {
            return false;
        }
        try {
            const rawKey = await crypto.unwrapSecret(password, this.salt, item.encryptKey);
            this.contentKeys.set(id, crypto.toBase64(rawKey));
        } catch (error) {
            return false;
        }
        this.unlock(id);
        return true;
    }

    async getContentKey(id) {
        if (this.contentKeys.has(id)) {
            return crypto.importContentKey(this.contentKeys.get(id));
        }
        const item = this.getLock(id);
        if (!item) {
            return null;
        }
        return null;
    }

    async changePassword(id, oldPassword, newPassword) {
        const item = this.getLock(id);
        if (!item) {
            throw new Error("未找到加密记录");
        }
        if (!newPassword) {
            throw new Error("新密码不能为空");
        }
        let rawKey;
        try {
            rawKey = await crypto.unwrapSecret(oldPassword, this.salt, item.encryptKey);
        } catch (error) {
            throw new Error("旧密码错误");
        }
        if (!await crypto.verifyPassword(oldPassword, this.salt, item.pwdHash)) {
            throw new Error("旧密码错误");
        }
        item.pwdHash = await crypto.createVerifier(newPassword, this.salt);
        item.encryptKey = await crypto.wrapSecret(newPassword, this.salt, rawKey);
        await this.persist();
    }

    async setMode(id, mode) {
        const item = this.getLock(id);
        if (!item) {
            throw new Error("未找到加密记录");
        }
        item.encryptMode = mode === "hidden" ? "hidden" : "visible";
        if (item.encryptMode === "visible") {
            this.tempVisible.delete(id);
        }
        await this.persist();
    }

    async setRecursive(id, recursive) {
        const item = this.getLock(id);
        if (!item) {
            throw new Error("未找到加密记录");
        }
        item.recursive = Boolean(recursive);
        await this.persist();
    }

    async removeLock(id) {
        this.data.lockList = this.data.lockList.filter(item => item.id !== id);
        this.lock(id);
        await this.persist();
    }

    async enableMainPassword(password) {
        if (!password) {
            throw new Error("主密码不能为空");
        }
        this.config.mainPwdHash = await crypto.createVerifier(password, this.salt);
        this.config.enableMainPwd = true;
        await this.persist();
    }

    async disableMainPassword() {
        this.config.enableMainPwd = false;
        this.config.mainPwdHash = "";
        await this.persist();
    }

    async verifyMainPassword(password) {
        if (!this.config.enableMainPwd) {
            return true;
        }
        return crypto.verifyPassword(password, this.salt, this.config.mainPwdHash);
    }

    async updateConfig(patch) {
        Object.assign(this.config, patch);
        await this.persist();
    }

    buildBackupPackage(ids) {
        const base = {
            v: DATA_VERSION,
            salt: this.salt,
            deviceKey: this.raw.deviceKey,
            exportedAt: Date.now()
        };
        if (Array.isArray(ids)) {
            base.lockList = this.data.lockList.filter(item => ids.includes(item.id));
            base.header = KEY_HEADER;
        } else {
            base.config = this.data.config;
            base.lockList = this.data.lockList;
            base.header = BACKUP_HEADER;
        }
        return base;
    }

    async exportBackup(backupPassword, ids) {
        if (!backupPassword) {
            throw new Error("备份密码不能为空");
        }
        const pkg = this.buildBackupPackage(ids);
        const key = await crypto.deriveKey(backupPassword, this.salt, ["encrypt"]);
        const cipher = await crypto.encryptPayload(key, pkg);
        const bytes = new Uint8Array(cipher.iv.length + cipher.data.length);
        bytes.set(cipher.iv, 0);
        bytes.set(cipher.data, cipher.iv.length);
        return pkg.header + ":" + this.salt + "\n" + crypto.toBase64(bytes);
    }

    async importBackup(text, backupPassword) {
        if (!backupPassword) {
            throw new Error("备份密码不能为空");
        }
        const lines = text.trim().split(/\s+/);
        if (lines.length < 2 || !lines[0].startsWith(BACKUP_HEADER + ":") && !lines[0].startsWith(KEY_HEADER + ":")) {
            throw new Error("备份文件格式不正确");
        }
        const header = lines[0].split(":")[0];
        const salt = lines[0].slice(header.length + 1);
        let payload;
        try {
            const bytes = crypto.fromBase64(lines[1]);
            const iv = Array.from(bytes.slice(0, 12));
            const data = Array.from(bytes.slice(12));
            payload = {iv, data};
        } catch (error) {
            throw new Error("备份内容无法解析");
        }
        const key = await crypto.deriveKey(backupPassword, salt, ["decrypt"]);
        let pkg;
        try {
            pkg = await crypto.decryptPayload(key, payload);
        } catch (error) {
            throw new Error("备份密码错误或内容被篡改");
        }
        if (!pkg || !Array.isArray(pkg.lockList)) {
            throw new Error("备份内容不完整");
        }
        if (header === KEY_HEADER) {
            pkg.lockList.forEach(item => {
                this.data.lockList = this.data.lockList.filter(existing => existing.id !== item.id);
                this.data.lockList.push(item);
            });
            await this.persist();
            return {imported: pkg.lockList.length, mode: "key"};
        }
        this.raw.salt = pkg.salt || this.salt;
        this.raw.deviceKey = pkg.deviceKey || this.raw.deviceKey;
        this.saveLocalDeviceKey(this.raw.deviceKey);
        this.deviceKey = await crypto.importRawKey(this.raw.deviceKey, ["encrypt", "decrypt"]);
        this.data = {
            config: Object.assign(defaultConfig(), pkg.config || {}),
            lockList: pkg.lockList
        };
        this.clearUnlocked();
        await this.persist();
        return {imported: pkg.lockList.length, mode: "full"};
    }
}

module.exports = {Store, defaultConfig};

},
"crypto.js": function(require, module, exports) {
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

},
"hookAdapter.js": function(require, module, exports) {
class HookAdapter {
    constructor(ctx) {
        this.ctx = ctx;
        this.bound = [];
        this.observer = null;
        this.timer = null;
        this.supported = {};
        const eventNames = {
            doctree: "open-menu-doctree",
            content: "open-menu-content",
            switchProtyle: "switch-protyle",
            switchMode: "switch-protyle-mode",
            loadedStatic: "loaded-protyle-static",
            loadedDynamic: "loaded-protyle-dynamic",
            destroyProtyle: "destroy-protyle",
            beforeSearch: "before-search-results-render"
        };
        Object.keys(eventNames).forEach(key => {
            this.supported[key] = eventNames[key];
        });
    }

    on(eventKey, callback) {
        const eventName = this.supported[eventKey];
        if (!eventName || !this.ctx.plugin.eventBus) {
            return false;
        }
        try {
            this.ctx.plugin.eventBus.on(eventName, callback);
            this.bound.push([eventName, callback]);
            return true;
        } catch (error) {
            console.warn("Light Privacy: hook unavailable", eventName, error);
            return false;
        }
    }

    observeMutations(callback) {
        if (typeof MutationObserver === "undefined") {
            return false;
        }
        let scheduled = false;
        const schedule = () => {
            if (scheduled) {
                return;
            }
            scheduled = true;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => {
                scheduled = false;
                try {
                    callback();
                } catch (error) {
                    console.warn("Light Privacy: observer callback error", error);
                }
            }, 120);
        };
        this.observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.addedNodes && mutation.addedNodes.length) {
                    schedule();
                    return;
                }
            }
        });
        this.observer.observe(document.body, {childList: true, subtree: true});
        return true;
    }

    offAll() {
        this.bound.forEach(([eventName, callback]) => {
            try {
                this.ctx.plugin.eventBus.off(eventName, callback);
            } catch (error) {
                console.warn("Light Privacy: hook cleanup failed", eventName, error);
            }
        });
        this.bound = [];
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        clearTimeout(this.timer);
    }
}

module.exports = {HookAdapter};

},
"modal.js": function(require, module, exports) {
function escapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const EYE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" style="fill:none;stroke:currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" style="fill:none"></path><circle cx="12" cy="12" r="3" style="fill:none"></circle></svg>';
const EYE_OFF_SVG = EYE_SVG.replace("</svg>", '<path d="M3 3l18 18" style="fill:none"></path></svg>');

class Modal {
    constructor(ctx) {
        this.ctx = ctx;
        this.siyuan = ctx.siyuan;
    }

    openCard(options) {
        return new Promise(resolve => {
            let settled = false;
            const width = options.wide ? "min(760px, 92vw)" : "min(420px, 92vw)";
            const content = '<div class="lp-card' + (options.wide ? ' lp-card--wide' : '') + '">' +
                '<div class="lp-card__title">' + escapeHtml(options.title || "") + '</div>' +
                (options.desc ? '<div class="lp-card__desc">' + escapeHtml(options.desc) + '</div>' : '') +
                (options.body || '') +
                '<div class="lp-error" data-role="error"></div>' +
                '<div class="lp-actions">' +
                '<button type="button" class="lp-btn" data-role="cancel">' + escapeHtml(options.cancelLabel || this.ctx.t("cancel", "取消")) + '</button>' +
                '<button type="button" class="lp-btn ' + (options.danger ? "lp-btn--danger" : "lp-btn--primary") + '" data-role="confirm">' + escapeHtml(options.confirmLabel || this.ctx.t("confirm", "确认")) + '</button>' +
                '</div></div>';
            const dialog = new this.siyuan.Dialog({
                title: "",
                content,
                width,
                destroyCallback: () => {
                    if (!settled) {
                        settled = true;
                        resolve(null);
                    }
                }
            });
            dialog.element.classList.add("lp-dialog");
            const card = dialog.element.querySelector(".lp-card");
            const errorBox = dialog.element.querySelector('[data-role="error"]');
            const close = value => {
                settled = true;
                dialog.destroy();
                resolve(value);
            };
            const setError = message => {
                errorBox.textContent = message || "";
                if (message) {
                    card.classList.remove("lp-shake");
                    void card.offsetWidth;
                    card.classList.add("lp-shake");
                }
            };
            dialog.element.querySelector('[data-role="cancel"]').addEventListener("click", () => close(null));
            const confirmButton = dialog.element.querySelector('[data-role="confirm"]');
            confirmButton.addEventListener("click", async () => {
                if (confirmButton.disabled) {
                    return;
                }
                setError("");
                const callback = options.onConfirm;
                const isAsync = typeof callback === "function" && callback.constructor && callback.constructor.name === "AsyncFunction";
                const originalText = confirmButton.textContent;
                if (isAsync) {
                    confirmButton.disabled = true;
                    confirmButton.textContent = "处理中…";
                }
                try {
                    const result = callback ? await callback(dialog.element, setError) : true;
                    if (result === false || result === undefined && callback) {
                        return;
                    }
                    close(result === true ? true : result);
                } catch (error) {
                    setError(error.message || String(error));
                } finally {
                    if (isAsync && !settled) {
                        confirmButton.disabled = false;
                        confirmButton.textContent = originalText;
                    }
                }
            });
            dialog.element.querySelectorAll("[data-role='eye']").forEach(button => {
                button.addEventListener("click", () => {
                    const input = dialog.element.querySelector("#" + button.getAttribute("data-target"));
                    if (!input) {
                        return;
                    }
                    const show = input.type === "password";
                    input.type = show ? "text" : "password";
                    button.title = show ? "隐藏密码" : "显示密码";
                    button.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
                    button.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
                    input.focus();
                });
            });
            if (options.onOpen) {
                options.onOpen(dialog.element);
            }
            const focusTarget = dialog.element.querySelector("[data-autofocus]");
            if (focusTarget) {
                setTimeout(() => focusTarget.focus(), 40);
            }
        });
    }

    passwordField(id, label, autofocus, autocomplete) {
        return '<div class="lp-field"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
            '<div class="lp-input-row"><input class="lp-input" id="' + id + '" type="password" autocomplete="' + escapeHtml(autocomplete || "new-password") + '"' +
            (autofocus ? ' data-autofocus' : '') + '><button type="button" class="lp-eye" data-role="eye" data-target="' + id +
            '" title="显示密码" aria-label="显示密码">' + EYE_SVG + '</button></div></div>';
    }

    async askPassword(options) {
        const body = this.passwordField("lp-pwd", options.label || this.ctx.t("pwdLabel", "密码"), true, options.autocomplete);
        return this.openCard({
            title: options.title || "输入密码",
            desc: options.desc || "",
            confirmLabel: options.confirmLabel,
            body,
            onConfirm: (root, setError) => {
                const value = root.querySelector("#lp-pwd").value;
                if (!value) {
                    setError("密码不能为空");
                    return false;
                }
                return {password: value};
            }
        });
    }

    async setLock(options) {
        const body = this.passwordField("lp-pwd", this.ctx.t("pwdLabel", "密码"), true) +
            this.passwordField("lp-pwd2", this.ctx.t("pwdConfirmLabel", "确认密码"), false) +
            '<div class="lp-radio-group">' +
            '<label class="lp-radio"><input type="radio" name="lp-mode" value="visible" checked> ' + escapeHtml(this.ctx.t("menuVisible", "密码可见")) + '</label>' +
            '<label class="lp-radio"><input type="radio" name="lp-mode" value="hidden"> ' + escapeHtml(this.ctx.t("menuHidden", "隐藏")) + '</label>' +
            '</div>' +
            (options.allowRecursive ? '<label class="lp-check"><input type="checkbox" id="lp-recursive"> 递归保护子节点（父节点解锁后子文档自动放行）</label>' : '');
        return this.openCard({
            title: options.title || this.ctx.t("setTitle", "设置隐私锁"),
            desc: "密码丢失无法找回，请务必在管理面板导出密钥备份。",
            body,
            onConfirm: (root, setError) => {
                const password = root.querySelector("#lp-pwd").value;
                const confirm = root.querySelector("#lp-pwd2").value;
                if (!password) {
                    setError("密码不能为空");
                    return false;
                }
                if (password !== confirm) {
                    setError("两次输入的密码不一致");
                    return false;
                }
                const mode = root.querySelector("input[name='lp-mode']:checked").value;
                const recursive = Boolean(root.querySelector("#lp-recursive") && root.querySelector("#lp-recursive").checked);
                return {password, confirm, mode, recursive};
            }
        });
    }

    async changePassword(options) {
        const body = this.passwordField("lp-old", this.ctx.t("pwdOldLabel", "旧密码"), true) +
            this.passwordField("lp-new", this.ctx.t("pwdNewLabel", "新密码"), false) +
            this.passwordField("lp-new2", this.ctx.t("pwdConfirmLabel", "确认密码"), false);
        return this.openCard({
            title: options.title || this.ctx.t("changeTitle", "修改隐私锁密码"),
            body,
            onConfirm: (root, setError) => {
                const oldPassword = root.querySelector("#lp-old").value;
                const next = root.querySelector("#lp-new").value;
                const confirm = root.querySelector("#lp-new2").value;
                if (!oldPassword || !next) {
                    setError("密码不能为空");
                    return false;
                }
                if (next !== confirm) {
                    setError("两次输入的新密码不一致");
                    return false;
                }
                return {oldPassword, next};
            }
        });
    }

    async askMode(options) {
        const current = options.current === "hidden" ? "hidden" : "visible";
        const body = '<div class="lp-radio-group">' +
            '<label class="lp-radio"><input type="radio" name="lp-mode" value="visible"' + (current === "visible" ? " checked" : "") + '> ' + escapeHtml(this.ctx.t("menuVisible", "密码可见")) + '</label>' +
            '<label class="lp-radio"><input type="radio" name="lp-mode" value="hidden"' + (current === "hidden" ? " checked" : "") + '> ' + escapeHtml(this.ctx.t("menuHidden", "隐藏")) + '</label>' +
            '</div>';
        return this.openCard({
            title: options.title || this.ctx.t("menuSwitchMode", "切换显示模式"),
            body,
            onConfirm: root => ({
                mode: root.querySelector("input[name='lp-mode']:checked").value
            })
        });
    }

    async confirm(options) {
        return this.openCard({
            title: options.title || "请确认",
            desc: options.text || "",
            danger: Boolean(options.danger),
            confirmLabel: options.confirmLabel || this.ctx.t("confirm", "确认"),
            body: "",
            onConfirm: () => true
        });
    }

    async inputText(options) {
        const body = '<div class="lp-field"><label for="lp-text">' + escapeHtml(options.label || "内容") + '</label>' +
            '<textarea class="lp-textarea" id="lp-text" data-autofocus></textarea></div>';
        return this.openCard({
            title: options.title || "输入",
            desc: options.desc || "",
            wide: true,
            body,
            onConfirm: (root, setError) => {
                const value = root.querySelector("#lp-text").value.trim();
                if (!value && options.required !== false) {
                    setError("内容不能为空");
                    return false;
                }
                return {value};
            }
        });
    }

    async showText(options) {
        const body = '<div class="lp-field"><label>备份内容（请复制到安全位置保存）</label>' +
            '<textarea class="lp-textarea" id="lp-export" readonly></textarea></div>' +
            '<div style="display:flex;justify-content:flex-end"><button type="button" class="lp-btn" data-role="copy">一键复制</button></div>';
        return this.openCard({
            title: options.title || "密钥备份",
            desc: options.desc || this.ctx.t("backupWarning", "密钥 / 密码丢失将无法解密恢复内容，插件不提供找回。"),
            wide: true,
            confirmLabel: "完成",
            body,
            onOpen: root => {
                root.querySelector("#lp-export").value = options.text || "";
                root.querySelector('[data-role="copy"]').addEventListener("click", async () => {
                    const text = options.text || "";
                    try {
                        await navigator.clipboard.writeText(text);
                    } catch (error) {
                        const area = root.querySelector("#lp-export");
                        area.select();
                        document.execCommand("copy");
                    }
                    this.ctx.showMessage("已复制到剪贴板");
                });
            },
            onConfirm: () => true
        });
    }
}

module.exports = {Modal, escapeHtml};

},
"hook.js": function(require, module, exports) {
const {escapeHtml} = require("./modal.js");

class Hook {
    constructor(ctx) {
        this.ctx = ctx;
        this.store = ctx.store;
        this.adapter = ctx.adapter;
        this.siyuan = ctx.siyuan;
        this.styleElement = null;
        this.maskContext = new WeakMap();
        this.promptedIds = new Set();
        this.ancestorCache = new Map();
        this.guarding = new Set();
        this.idleTimer = null;
        this.lastActivityAt = Date.now();
        this.activityHandler = null;
        this.knownProtyles = new Map();
        this.store.on("locked", id => {
            this.promptedIds.delete(id);
            this.ancestorCache.delete(id);
        });
    }

    init() {
        this.styleElement = document.createElement("style");
        this.styleElement.id = "lp-hidden-style";
        document.head.appendChild(this.styleElement);
        this.adapter.on("switchProtyle", event => this.guardFromEvent(event));
        this.adapter.on("switchMode", event => this.guardFromEvent(event));
        this.adapter.on("loadedStatic", event => this.guardFromEvent(event));
        this.adapter.on("loadedDynamic", event => this.guardFromEvent(event));
        this.adapter.on("beforeSearch", event => this.filterSearch(event));
        this.adapter.on("destroyProtyle", event => this.onDestroyProtyle(event));
        this.adapter.observeMutations(() => {
            this.applyHiddenStyle();
            this.scanEditors();
        });
        this.applyHiddenStyle();
        this.startAutoLock();
    }

    destroy() {
        this.stopAutoLock();
        this.knownProtyles.clear();
        if (this.styleElement && this.styleElement.parentNode) {
            this.styleElement.parentNode.removeChild(this.styleElement);
        }
    }

    startAutoLock() {
        this.stopAutoLock();
        this.lastActivityAt = Date.now();
        this.activityHandler = () => {
            this.lastActivityAt = Date.now();
        };
        if (typeof document !== "undefined") {
            ["mousedown", "keydown", "wheel", "touchstart"].forEach(type => {
                document.addEventListener(type, this.activityHandler, {capture: true, passive: true});
            });
        }
        this.idleTimer = setInterval(() => this.checkAutoLock(), 15000);
    }

    stopAutoLock() {
        if (this.idleTimer) {
            clearInterval(this.idleTimer);
            this.idleTimer = null;
        }
        if (this.activityHandler && typeof document !== "undefined") {
            ["mousedown", "keydown", "wheel", "touchstart"].forEach(type => {
                document.removeEventListener(type, this.activityHandler, {capture: true});
            });
        }
        this.activityHandler = null;
    }

    checkAutoLock() {
        this.syncKnownProtyles();
        const config = this.store.config;
        if (!config.idleAutoLock || !this.store.unlocked.size) {
            return;
        }
        const minutes = Math.max(1, Number(config.idleMinutes) || 10);
        if (Date.now() - this.lastActivityAt >= minutes * 60000) {
            this.store.clearUnlocked();
            this.lastActivityAt = Date.now();
            this.ctx.showMessage("闲置超时，已自动锁定全部文档");
        }
    }

    syncKnownProtyles() {
        if (!this.store.config.autoLockOnCloseTab || !this.siyuan.getAllEditor) {
            return;
        }
        let editors = [];
        try {
            editors = this.siyuan.getAllEditor() || [];
        } catch (error) {
            return;
        }
        const current = new Map();
        editors.forEach(protyle => {
            const rootId = this.rootIdOf(protyle);
            if (!rootId) {
                return;
            }
            const key = protyle.id || (rootId + "_" + current.size);
            current.set(key, rootId);
        });
        this.knownProtyles.forEach((rootId, key) => {
            if (current.has(key)) {
                return;
            }
            const stillOpen = Array.from(current.values()).indexOf(rootId) !== -1;
            if (!stillOpen && this.store.isUnlocked(rootId)) {
                this.store.lock(rootId);
            }
        });
        this.knownProtyles = current;
    }

    onDestroyProtyle(event) {
        if (!this.store.config.autoLockOnCloseTab) {
            return;
        }
        const protyle = this.extractProtyle(event);
        const rootId = this.rootIdOf(protyle);
        if (!rootId || !this.store.isUnlocked(rootId)) {
            return;
        }
        setTimeout(() => {
            let editors = [];
            try {
                editors = this.siyuan.getAllEditor ? this.siyuan.getAllEditor() : [];
            } catch (error) {
                editors = [];
            }
            const stillOpen = editors.some(item => this.rootIdOf(item) === rootId);
            if (!stillOpen && this.store.isUnlocked(rootId)) {
                this.store.lock(rootId);
            }
        }, 300);
    }

    titleOf(id) {
        const node = document.querySelector('.file-tree li[data-node-id="' + id + '"]');
        if (node) {
            const label = node.querySelector(".b3-list-item__text");
            if (label && label.textContent.trim()) {
                return label.textContent.trim();
            }
        }
        return id;
    }

    extractProtyle(event) {
        if (!event) {
            return null;
        }
        const detail = event.detail !== undefined ? event.detail : event;
        if (!detail) {
            return null;
        }
        if (detail.protyle) {
            return detail.protyle;
        }
        if (detail.block || detail.element || detail.rootID) {
            return detail;
        }
        return null;
    }

    rootIdOf(protyle) {
        if (!protyle) {
            return "";
        }
        if (protyle.block && protyle.block.rootID) {
            return protyle.block.rootID;
        }
        if (protyle.block && protyle.block.id) {
            return protyle.block.id;
        }
        if (protyle.path) {
            const name = protyle.path.split("/").pop() || "";
            if (name.endsWith(".sy")) {
                return name.slice(0, -3);
            }
        }
        if (protyle.element && protyle.element.getAttribute) {
            return protyle.element.getAttribute("data-id") || protyle.element.getAttribute("data-node-id") || "";
        }
        return "";
    }

    guardFromEvent(event) {
        const protyle = this.extractProtyle(event);
        if (protyle) {
            this.guardProtyle(protyle);
        } else {
            this.scanEditors();
        }
    }

    async scanEditors() {
        if (!this.siyuan.getAllEditor) {
            return;
        }
        let editors = [];
        try {
            editors = this.siyuan.getAllEditor() || [];
        } catch (error) {
            return;
        }
        editors.forEach(protyle => this.guardProtyle(protyle));
    }

    async guardProtyle(protyle) {
        const id = this.rootIdOf(protyle);
        if (!id || this.guarding.has(id)) {
            return;
        }
        const required = await this.requiredLocks(id);
        if (!required.length) {
            const target = this.targetOf(protyle);
            if (target) {
                this.removeMask(target);
            }
            return;
        }
        const target = this.targetOf(protyle);
        if (!target) {
            return;
        }
        this.showMask(target, id, required);
        if (!this.promptedIds.has(id)) {
            this.promptedIds.add(id);
            await this.ensureAccess(id, target, required);
        }
    }

    targetOf(protyle) {
        if (!protyle) {
            return null;
        }
        return protyle.contentElement || protyle.element || null;
    }

    async blockInfo(id) {
        if (!this.siyuan.fetchSyncPost) {
            return null;
        }
        try {
            const response = await this.siyuan.fetchSyncPost("/api/block/getBlockInfo", {id});
            if (!response || response.code !== 0 || !response.data) {
                return null;
            }
            return response.data;
        } catch (error) {
            return null;
        }
    }

    async ancestorsOf(id) {
        if (this.ancestorCache.has(id)) {
            return this.ancestorCache.get(id);
        }
        const info = await this.blockInfo(id);
        const result = [];
        if (info) {
            const path = typeof info.path === "string" ? info.path : "";
            path.split("/").forEach(segment => {
                if (segment.endsWith(".sy")) {
                    const ancestorId = segment.slice(0, -3);
                    if (ancestorId && ancestorId !== id && !result.includes(ancestorId)) {
                        result.push(ancestorId);
                    }
                }
            });
            let parent = info.parentID;
            let guard = 0;
            while (parent && guard < 20 && !result.includes(parent)) {
                result.push(parent);
                const parentInfo = await this.blockInfo(parent);
                parent = parentInfo && parentInfo.parentID !== parent ? parentInfo.parentID : "";
                guard++;
            }
        }
        this.ancestorCache.set(id, result);
        return result;
    }

    async requiredLocks(id) {
        if (this.store.config.recycleAutoUnlock) {
            const current = await this.blockInfo(id);
            const trace = ((current && current.path) || "") + " " + ((current && current.notebook) || "");
            if (/trash|回收站/i.test(trace)) {
                return [];
            }
        }
        const own = this.store.getLock(id);
        const required = [];
        if (own && !this.store.isUnlocked(id)) {
            required.push(id);
        }
        const ancestors = await this.ancestorsOf(id);
        for (const ancestorId of ancestors) {
            const item = this.store.getLock(ancestorId);
            if (item && item.recursive && !this.store.isUnlocked(ancestorId)) {
                required.push(ancestorId);
            }
        }
        return Array.from(new Set(required));
    }

    showMask(target, id, required) {
        let mask = target.querySelector(":scope > .lp-mask");
        if (!mask) {
            mask = document.createElement("div");
            mask.className = "lp-mask";
            target.appendChild(mask);
            target.classList.add("lp-protyle-locked");
            this.maskContext.set(target, {id, required});
        }
        const first = required[0] || id;
        mask.innerHTML = '<div class="lp-card">' +
            '<div class="lp-card__title">受保护的文档</div>' +
            '<div class="lp-card__desc">' + escapeHtml(this.titleOf(first)) + ' 已启用隐私锁，验证密码后才会加载正文。</div>' +
            '<div class="lp-error" data-role="error"></div>' +
            '<div class="lp-actions"><button type="button" class="lp-btn lp-btn--primary" data-role="unlock">输入密码解锁</button></div>' +
            '</div>';
        const errorBox = mask.querySelector('[data-role="error"]');
        mask.querySelector('[data-role="unlock"]').addEventListener("click", async () => {
            errorBox.textContent = "";
            const ok = await this.ensureAccess(id, target, required);
            if (!ok) {
                errorBox.textContent = "密码错误，请重新输入";
                const card = mask.querySelector(".lp-card");
                card.classList.remove("lp-shake");
                void card.offsetWidth;
                card.classList.add("lp-shake");
            }
        });
    }

    async ensureAccess(id, target, required) {
        const activeMask = target && target.querySelector(":scope > .lp-mask");
        if (activeMask) {
            activeMask.classList.add("lp-mask--dialog-open");
        }
        this.guarding.add(id);
        try {
            const list = required && required.length ? required : await this.requiredLocks(id);
            for (let index = 0; index < list.length; index++) {
                const lockId = list[index];
                if (this.store.isUnlocked(lockId)) {
                    continue;
                }
                const progress = list.length > 1 ? "正在验证第 " + (index + 1) + "/" + list.length + " 个锁。" : "";
                const result = await this.ctx.modal.askPassword({
                    title: "验证隐私锁",
                    desc: progress + "「" + this.titleOf(lockId) + "」已加密，请输入密码查看正文。",
                    confirmLabel: "解锁",
                    label: "密码",
                    autocomplete: "current-password"
                });
                if (!result) {
                    return false;
                }
                const ok = await this.store.verify(lockId, result.password);
                if (!ok) {
                    return false;
                }
            }
            if (target) {
                this.removeMask(target);
            }
            this.applyHiddenStyle();
            return true;
        } finally {
            if (activeMask) {
                activeMask.classList.remove("lp-mask--dialog-open");
            }
            this.guarding.delete(id);
        }
    }

    removeMask(target) {
        const mask = target.querySelector(":scope > .lp-mask");
        if (mask) {
            mask.remove();
        }
        target.classList.remove("lp-protyle-locked");
        this.maskContext.delete(target);
    }

    applyHiddenStyle() {
        if (!this.styleElement) {
            return;
        }
        const ids = this.store.list()
            .filter(item => item.encryptMode === "hidden" && !this.store.tempVisible.has(item.id))
            .map(item => item.id);
        const rules = ids.map(id => {
            const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
            return '.file-tree li[data-node-id="' + safe + '"],' +
                '.file-tree [data-node-id="' + safe + '"],' +
                '.search__list [data-node-id="' + safe + '"],' +
                '.search__list [data-id="' + safe + '"],' +
                '.search__item[data-id="' + safe + '"]{display:none !important}';
        });
        this.styleElement.textContent = rules.join("\n");
    }

    filterSearch(event) {
        const detail = event && event.detail;
        if (!detail || !Array.isArray(detail.blocks) || !this.store.config.hideInSearch) {
            return;
        }
        const hidden = id => {
            if (!id) {
                return false;
            }
            const item = this.store.getLock(id);
            return Boolean(item && item.encryptMode === "hidden");
        };
        const filtered = detail.blocks.filter(block => !hidden(block.id) && !hidden(block.rootID));
        if (filtered.length !== detail.blocks.length) {
            detail.blocks.splice(0, detail.blocks.length, ...filtered);
        }
    }

    async cleanupDeleted() {
        const removed = [];
        for (const item of this.store.list()) {
            let response = null;
            try {
                response = await this.siyuan.fetchSyncPost("/api/block/getBlockInfo", {id: item.id});
            } catch (error) {
                continue;
            }
            if (response && response.code !== 0) {
                removed.push(item.id);
            }
        }
        for (const id of removed) {
            await this.store.removeLock(id);
        }
        this.applyHiddenStyle();
        return removed.length;
    }
}

module.exports = {Hook};

},
"contextMenu.js": function(require, module, exports) {
class ContextMenu {
    constructor(ctx) {
        this.ctx = ctx;
        this.store = ctx.store;
        this.adapter = ctx.adapter;
    }

    init() {
        this.adapter.on("doctree", event => this.onDocTree(event));
        this.adapter.on("content", event => this.onContent(event));
    }

    elementId(element) {
        return element && element.getAttribute ? element.getAttribute("data-node-id") : "";
    }

    looksLikeFolder(element) {
        if (!element || !element.querySelectorAll) {
            return false;
        }
        const child = element.querySelector("ul li[data-node-id]") || element.querySelector("li[data-node-id]");
        return Boolean(child && child !== element);
    }

    onDocTree(event) {
        const detail = event && event.detail;
        if (!detail || !Array.isArray(detail.elements) || !detail.elements.length) {
            return;
        }
        const element = detail.elements[0];
        const id = this.elementId(element);
        if (!id) {
            return;
        }
        const type = this.looksLikeFolder(element) ? "folder" : "doc";
        this.appendItems(detail.menu, id, type);
    }

    onContent(event) {
        const detail = event && event.detail;
        if (!detail) {
            return;
        }
        const id = this.ctx.hook.rootIdOf(detail.protyle) || this.elementId(detail.element);
        if (!id) {
            return;
        }
        this.appendItems(detail.menu, id, "doc");
    }

    appendItems(menu, id, type) {
        if (!menu || !menu.addItem) {
            return;
        }
        const item = this.store.getLock(id);
        menu.addItem({
            icon: "iconLock",
            label: this.ctx.t(item ? "menuChange" : "menuSet", item ? "修改隐私锁密码" : "设置隐私锁"),
            click: () => item ? this.changePassword(id) : this.setLock(id, type)
        });
        if (!item) {
            return;
        }
        menu.addItem({
            icon: "iconRefresh",
            label: this.ctx.t("menuSwitchMode", "切换显示模式"),
            click: () => this.switchMode(id, item)
        });
        menu.addItem({
            icon: "iconClose",
            label: this.ctx.t("menuRemove", "取消隐私锁"),
            click: () => this.removeLock(id)
        });
    }

    async setLock(id, type) {
        const result = await this.ctx.modal.setLock({
            title: this.ctx.t("setTitle", "设置隐私锁"),
            allowRecursive: type === "folder"
        });
        if (!result) {
            return;
        }
        try {
            await this.store.addLock({
                id,
                type,
                password: result.password,
                encryptMode: result.mode,
                recursive: type === "folder" && result.recursive
            });
            this.ctx.hook.applyHiddenStyle();
            this.ctx.showMessage("隐私锁已设置，请妥善备份密钥");
            this.ctx.panel.refresh();
        } catch (error) {
            this.ctx.showMessage(error.message || "设置失败");
        }
    }

    async changePassword(id) {
        const result = await this.ctx.modal.changePassword({});
        if (!result) {
            return;
        }
        try {
            await this.store.changePassword(id, result.oldPassword, result.next);
            this.ctx.showMessage("密码已修改");
        } catch (error) {
            this.ctx.showMessage(error && error.message === "旧密码错误" ? "旧密码不正确" : (error.message || "修改失败"));
        }
    }

    async switchMode(id, item) {
        if (!this.store.isUnlocked(id)) {
            const result = await this.ctx.modal.askPassword({
                title: "验证隐私锁",
                desc: "切换显示模式前请验证当前密码。",
                label: "密码",
                autocomplete: "current-password"
            });
            if (!result || !await this.store.verify(id, result.password)) {
                this.ctx.showMessage("密码错误，请重新输入");
                return;
            }
        }
        const result = await this.ctx.modal.askMode({current: item.encryptMode});
        if (!result) {
            return;
        }
        await this.store.setMode(id, result.mode);
        this.ctx.hook.applyHiddenStyle();
        this.ctx.showMessage("显示模式已切换");
        this.ctx.panel.refresh();
    }

    async removeLock(id) {
        const ok = await this.ctx.modal.confirm({
            title: this.ctx.t("removeTitle", "取消隐私锁"),
            text: "取消「" + this.ctx.hook.titleOf(id) + "」的加密将清除该节点的保护记录，确定继续吗？",
            danger: true,
            confirmLabel: "取消加密"
        });
        if (!ok) {
            return;
        }
        await this.store.removeLock(id);
        this.ctx.hook.applyHiddenStyle();
        this.ctx.showMessage("已取消隐私锁");
        this.ctx.panel.refresh();
    }
}

module.exports = {ContextMenu};

},
"panel.js": function(require, module, exports) {
const {escapeHtml} = require("./modal.js");

const TABS = [
    {key: "list", labelKey: "tabList", label: "加密清单"},
    {key: "settings", labelKey: "tabSettings", label: "全局设置"},
    {key: "backup", labelKey: "tabBackup", label: "密钥备份与恢复"},
    {key: "about", labelKey: "tabAbout", label: "关于"}
];

const formatTime = value => {
    const date = new Date(value);
    const pad = part => String(part).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
};

class Panel {
    constructor(ctx) {
        this.ctx = ctx;
        this.store = ctx.store;
        this.dialog = null;
        this.activeTab = "list";
        this.mainPasswordChecked = false;
    }

    async open() {
        if (this.store.config.enableMainPwd && !this.mainPasswordChecked) {
            const result = await this.ctx.modal.askPassword({
                title: "全局管理主密码",
                desc: "进入加密清单前需要验证主密码。",
                label: "主密码",
                confirmLabel: "验证",
                autocomplete: "current-password"
            });
            if (!result) {
                return;
            }
            if (!await this.store.verifyMainPassword(result.password)) {
                this.ctx.showMessage("主密码错误，请重新输入");
                return;
            }
            this.mainPasswordChecked = true;
        }
        if (this.dialog) {
            this.render();
            return;
        }
        const instance = this;
        this.dialog = new this.ctx.siyuan.Dialog({
            title: this.ctx.t("panelTitle", "轻态隐私 · 管理面板"),
            content: '<div class="lp-panel" data-role="panel"></div>',
            width: "min(1060px, 96vw)",
            height: "min(760px, 90vh)",
            destroyCallback: () => {
                instance.dialog = null;
                instance.mainPasswordChecked = false;
            }
        });
        this.render();
    }

    refresh() {
        if (this.dialog) {
            this.render();
        }
    }

    render() {
        if (!this.dialog) {
            return;
        }
        const root = this.dialog.element.querySelector('[data-role="panel"]');
        if (!root) {
            return;
        }
        root.innerHTML = '<div class="lp-tabs">' + TABS.map(tab =>
            '<button type="button" class="lp-tab ' + (tab.key === this.activeTab ? "lp-tab--active" : "") + '" data-tab="' + tab.key + '">' +
            escapeHtml(this.ctx.t(tab.labelKey, tab.label)) + '</button>').join("") + '</div>' +
            '<div data-role="tab-content"></div>';
        root.querySelectorAll("[data-tab]").forEach(button => {
            button.addEventListener("click", () => {
                this.activeTab = button.getAttribute("data-tab");
                this.render();
            });
        });
        const content = root.querySelector('[data-role="tab-content"]');
        if (this.activeTab === "list") {
            this.renderList(content);
        } else if (this.activeTab === "settings") {
            this.renderSettings(content);
        } else if (this.activeTab === "backup") {
            this.renderBackup(content);
        } else {
            this.renderAbout(content);
        }
    }

    currentDocId() {
        const siyuan = this.ctx.siyuan;
        const editor = siyuan.getActiveEditor && siyuan.getActiveEditor();
        const activeId = editor && this.ctx.hook.rootIdOf(editor);
        if (activeId) {
            return activeId;
        }
        if (siyuan.getAllEditor) {
            const editors = siyuan.getAllEditor() || [];
            for (const item of editors) {
                const rootId = this.ctx.hook.rootIdOf(item);
                if (rootId) {
                    return rootId;
                }
            }
        }
        // DOM 兜底：思源 .protyle 根节点真实携带 data-node-id / data-id（项目 hook.js 与运行态 DOM 均已核实）。
        // 跳过 .fn__none 隐藏标签页，只从当前可见编辑器取文档 id。
        const protyles = document.querySelectorAll(".protyle:not(.fn__none)");
        for (const element of protyles) {
            if (element.getClientRects && !element.getClientRects().length) {
                continue;
            }
            const id = element.getAttribute("data-node-id") || element.getAttribute("data-id");
            if (id) {
                return id;
            }
        }
        return "";
    }

    renderList(container) {
        const items = this.store.list();
        let html = '<div class="lp-toolbar">' +
            '<button type="button" class="lp-btn lp-btn--small" data-action="lock-current">加锁当前文档</button>' +
            '<div class="lp-toolbar__group">' +
            '<button type="button" class="lp-btn lp-btn--small" data-action="refresh">刷新列表</button>' +
            '<button type="button" class="lp-btn lp-btn--small" data-action="cleanup">清理已删除记录</button></div></div>';
        if (this.store.error) {
            html += '<div class="lp-warning">' + escapeHtml(this.store.error) + '</div>';
        }
        if (!items.length) {
            html += '<div class="lp-empty"><span class="lp-lock-icon"></span>' +
                '<div class="lp-empty__title">' + escapeHtml(this.ctx.t("emptyList", "暂无加密条目")) + '</div>' +
                '<div class="lp-empty__desc">在文档树右键文档/目录选择「设置隐私锁」，或点击上方按钮为当前文档加锁。</div>' +
                '<button type="button" class="lp-btn lp-btn--small" data-action="lock-current">加锁当前文档</button>' +
                '</div>';
        } else {
            const unlockedCount = items.filter(item => this.store.isUnlocked(item.id)).length;
            html += '<div class="lp-list-meta">共 ' + items.length + ' 项 · ' + unlockedCount + ' 已解锁</div>';
            html += '<div class="lp-table-wrap"><table class="lp-table"><thead><tr>' +
                '<th>' + escapeHtml(this.ctx.t("colTitle", "标题")) + '</th>' +
                '<th>' + escapeHtml(this.ctx.t("colMode", "保护模式")) + '</th>' +
                '<th>' + escapeHtml(this.ctx.t("colRecursive", "递归")) + '</th>' +
                '<th>' + escapeHtml(this.ctx.t("colCreated", "创建时间")) + '</th>' +
                '<th>' + escapeHtml(this.ctx.t("colActions", "操作")) + '</th>' +
                '</tr></thead><tbody>';
            items.forEach(item => {
                const unlocked = this.store.isUnlocked(item.id);
                const title = this.ctx.hook.titleOf(item.id);
                const modeLabel = item.encryptMode === "hidden" ? this.ctx.t("modeHidden", "隐藏") : this.ctx.t("modeVisible", "密码可见");
                html += '<tr data-id="' + escapeHtml(item.id) + '">' +
                    '<td><span class="lp-cell-title" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</span>' +
                    (unlocked
                        ? '<span class="lp-state-icon lp-state-icon--unlocked" title="' + escapeHtml(this.ctx.t("unlockedState", "已解锁")) + '"></span>'
                        : '<span class="lp-state-icon lp-state-icon--locked" title="' + escapeHtml(this.ctx.t("locked", "已锁定")) + '"></span>') +
                    '</td>' +
                    '<td><span class="lp-badge lp-badge--mode">' + escapeHtml(modeLabel) + '</span></td>' +
                    '<td>' + escapeHtml(item.recursive ? this.ctx.t("yes", "是") : this.ctx.t("no", "否")) + '</td>' +
                    '<td><span class="lp-time">' + escapeHtml(formatTime(item.createAt)) + '</span></td>' +
                    '<td><div class="lp-row-actions">' +
                    (unlocked ? '<button type="button" class="lp-btn lp-btn--small" data-action="relock">立即上锁</button>' :
                        '<button type="button" class="lp-btn lp-btn--small" data-action="unlock">' + escapeHtml(this.ctx.t("unlockView", "解锁查看")) + '</button>') +
                    '<button type="button" class="lp-btn lp-btn--small" data-action="mode">' + escapeHtml(this.ctx.t("switchMode", "切换模式")) + '</button>' +
                    '<button type="button" class="lp-btn lp-btn--small" data-action="pwd">' + escapeHtml(this.ctx.t("editPwd", "改密码")) + '</button>' +
                    '<button type="button" class="lp-btn lp-btn--small" data-action="key">' + escapeHtml(this.ctx.t("exportKey", "导出单条密钥")) + '</button>' +
                    '<button type="button" class="lp-btn lp-btn--small" data-action="remove">' + escapeHtml(this.ctx.t("removeLock", "取消加密")) + '</button>' +
                    (item.encryptMode === "hidden" ? '<button type="button" class="lp-btn lp-btn--small" data-action="temp">' +
                        (this.store.tempVisible.has(item.id) ? "恢复隐藏" : "临时显示到大纲") + '</button>' : '') +
                    '</div></td></tr>';
            });
            html += '</tbody></table></div>';
        }
        container.innerHTML = html;
        container.querySelectorAll('[data-action="lock-current"]').forEach(button => {
            button.addEventListener("click", async () => {
                const id = this.currentDocId();
                if (!id) {
                    this.ctx.showMessage("请先打开需要加锁的文档");
                    return;
                }
                await this.ctx.contextMenu.setLock(id, "doc");
                this.render();
            });
        });
        container.querySelector('[data-action="refresh"]').addEventListener("click", () => this.render());
        container.querySelector('[data-action="cleanup"]').addEventListener("click", async () => {
            const count = await this.ctx.hook.cleanupDeleted();
            this.ctx.showMessage("已清理 " + count + " 条失效记录");
            this.render();
        });
        container.querySelectorAll("tbody tr").forEach(row => {
            const id = row.getAttribute("data-id");
            const item = this.store.getLock(id);
            row.querySelectorAll("[data-action]").forEach(button => {
                button.addEventListener("click", async () => {
                    const action = button.getAttribute("data-action");
                    if (action === "unlock") {
                        await this.unlockAndOpen(id, item);
                    } else if (action === "relock") {
                        this.store.lock(id);
                        this.ctx.hook.scanEditors();
                        this.ctx.showMessage("已重新锁定，下次打开需再次验证密码");
                        this.render();
                    } else if (action === "mode") {
                        await this.ctx.contextMenu.switchMode(id, item);
                        this.render();
                    } else if (action === "pwd") {
                        await this.ctx.contextMenu.changePassword(id);
                    } else if (action === "remove") {
                        await this.ctx.contextMenu.removeLock(id);
                        this.render();
                    } else if (action === "key") {
                        await this.exportKey(id);
                    } else if (action === "temp") {
                        const visible = !this.store.tempVisible.has(id);
                        this.store.setTempVisible(id, visible);
                        this.ctx.hook.applyHiddenStyle();
                        this.render();
                    }
                });
            });
        });
    }

    async unlockAndOpen(id, item) {
        if (!this.store.isUnlocked(id)) {
            const result = await this.ctx.modal.askPassword({
                title: this.ctx.t("unlockView", "解锁查看"),
                desc: "请输入该节点的独立密码。",
                label: "密码",
                confirmLabel: "解锁",
                autocomplete: "current-password"
            });
            if (!result) {
                return;
            }
            if (!await this.store.verify(id, result.password)) {
                this.ctx.showMessage("密码错误，请重新输入");
                return;
            }
        }
        if (item.encryptMode === "hidden") {
            this.store.setTempVisible(id, true);
            this.ctx.hook.applyHiddenStyle();
        }
        if (this.ctx.siyuan.openTab && this.ctx.app) {
            this.ctx.siyuan.openTab({app: this.ctx.app, doc: {id}});
        }
        this.ctx.showMessage("已解锁");
        this.render();
    }

    async exportKey(id) {
        const result = await this.ctx.modal.askPassword({
            title: "导出单条密钥",
            desc: "请设置备份密码，用于加密本次导出的密钥包。",
            label: this.ctx.t("backupPwdLabel", "备份密码"),
            confirmLabel: "导出"
        });
        if (!result) {
            return;
        }
        try {
            const text = await this.store.exportBackup(result.password, [id]);
            await this.ctx.modal.showText({title: "单条密钥备份", text});
        } catch (error) {
            this.ctx.showMessage(error.message || "导出失败");
        }
    }

    renderSettings(container) {
        const config = this.store.config;
        const theme = config.theme || "auto";
        const row = (key, title, hint, checked, warning) =>
            '<div class="lp-setting-row"><div class="lp-setting-row__text">' + escapeHtml(title) +
            (hint ? '<span class="lp-setting-row__hint">' + escapeHtml(hint) + '</span>' : '') +
            (warning ? '<div class="lp-warning">' + escapeHtml(warning) + '</div>' : '') +
            '</div><input type="checkbox" data-config="' + key + '"' + (checked ? " checked" : "") + '></div>';
        const numberRow = (key, title, hint, value, min, max, disabled) =>
            '<div class="lp-setting-row"><div class="lp-setting-row__text">' + escapeHtml(title) +
            (hint ? '<span class="lp-setting-row__hint">' + escapeHtml(hint) + '</span>' : '') +
            '</div><input type="number" class="lp-input" style="width:76px;flex:0 0 auto" data-number="' + key +
            '" value="' + Number(value || 10) + '" min="' + min + '" max="' + max + '"' + (disabled ? " disabled" : "") + '></div>';
        container.innerHTML = '<div class="lp-section">' +
            '<div class="lp-section__title">常规</div>' +
            row("enableMainPwd", this.ctx.t("enableMainPwd", "全局管理主密码"), "开启后进入加密清单必须验证主密码。", config.enableMainPwd) +
            row("hideInSearch", this.ctx.t("hideInSearch", "隐藏条目在搜索中屏蔽"), "关闭后隐藏条目仅在大纲隐藏，搜索仍可见（不推荐）。", config.hideInSearch) +
            row("recycleAutoUnlock", this.ctx.t("recycleAutoUnlock", "加密节点移入回收站自动解锁"), "关闭后回收站中仍为加密态。", config.recycleAutoUnlock) +
            row("autoLockOnCloseTab", this.ctx.t("autoLockOnCloseTab", "关闭标签页自动上锁"),
                this.ctx.t("autoLockOnCloseTabHint", "关闭文档标签页后自动清除该文档的解锁状态，下次打开需重新验密。"), config.autoLockOnCloseTab) +
            row("idleAutoLock", this.ctx.t("idleAutoLock", "闲置自动上锁"),
                this.ctx.t("idleAutoLockHint", "无鼠标 / 键盘操作超过设定时长后，自动锁定全部已解锁文档。"), config.idleAutoLock) +
            numberRow("idleMinutes", this.ctx.t("idleMinutes", "闲置时长（分钟）"),
                this.ctx.t("idleMinutesHint", "取值范围 1 - 120 分钟，默认 10 分钟。"), config.idleMinutes, 1, 120, !config.idleAutoLock) +
            '</div>' +
            '<div class="lp-section">' +
            '<div class="lp-section__title">外观</div>' +
            '<div class="lp-setting-row"><div class="lp-setting-row__text">面板主题' +
            '<span class="lp-setting-row__hint">跟随系统自动适配浅色 / 深色，也可手动指定。</span></div>' +
            '<div class="lp-radio-group">' +
            '<label class="lp-radio"><input type="radio" name="lp-theme" data-theme-value="auto"' + (theme === "auto" ? " checked" : "") + '> ' + escapeHtml(this.ctx.t("themeAuto", "跟随系统")) + '</label>' +
            '<label class="lp-radio"><input type="radio" name="lp-theme" data-theme-value="light"' + (theme === "light" ? " checked" : "") + '> ' + escapeHtml(this.ctx.t("themeLight", "浅色")) + '</label>' +
            '<label class="lp-radio"><input type="radio" name="lp-theme" data-theme-value="dark"' + (theme === "dark" ? " checked" : "") + '> ' + escapeHtml(this.ctx.t("themeDark", "深色")) + '</label>' +
            '</div></div>' +
            '</div>' +
            '<div class="lp-section">' +
            '<div class="lp-section__title">高级（实验性）</div>' +
            row("enableContentEncrypt", this.ctx.t("enableContentEncrypt", "高级模式：块正文密文存储") + "（实验性预留）",
                "当前版本仅保留配置项与风险提示，不执行正文写回，避免破坏思源历史与数据修复。",
                config.enableContentEncrypt, this.ctx.t("advancedWarning", "开启后插件将块正文加密后写回块内，仅留密文标记，可能导致历史快照与版本回退异常。")) +
            '</div>';
        container.querySelectorAll("[data-theme-value]").forEach(input => {
            input.addEventListener("change", async () => {
                const value = input.getAttribute("data-theme-value");
                await this.store.updateConfig({theme: value});
                this.ctx.applyLpTheme(value);
                this.render();
            });
        });
        container.querySelectorAll("[data-config]").forEach(input => {
            input.addEventListener("change", async () => {
                const key = input.getAttribute("data-config");
                const checked = input.checked;
                if (key === "enableMainPwd" && checked) {
                    const result = await this.ctx.modal.askPassword({
                        title: "设置全局主密码",
                        desc: "主密码丢失无法找回，请务必备份。",
                        label: "主密码",
                        confirmLabel: "启用",
                        autocomplete: "new-password"
                    });
                    if (!result) {
                        input.checked = false;
                        return;
                    }
                    await this.store.enableMainPassword(result.password);
                    this.ctx.showMessage("主密码已启用");
                    return;
                }
                if (key === "enableMainPwd") {
                    await this.store.disableMainPassword();
                    this.mainPasswordChecked = false;
                    return;
                }
                if (key === "enableContentEncrypt" && checked) {
                    const ok = await this.ctx.modal.confirm({
                        title: "启用高级模式",
                        text: this.ctx.t("advancedWarning", "该模式会影响思源历史快照与版本回退，确定继续吗？"),
                        danger: true
                    });
                    if (!ok) {
                        input.checked = false;
                        return;
                    }
                }
                const patch = {};
                patch[key] = checked;
                await this.store.updateConfig(patch);
                if (key === "hideInSearch") {
                    this.ctx.hook.applyHiddenStyle();
                }
                if (key === "idleAutoLock") {
                    const numberInput = container.querySelector('[data-number="idleMinutes"]');
                    if (numberInput) {
                        numberInput.disabled = !checked;
                    }
                }
            });
        });
        container.querySelectorAll("[data-number]").forEach(input => {
            input.addEventListener("change", async () => {
                const key = input.getAttribute("data-number");
                let value = parseInt(input.value, 10);
                if (isNaN(value) || value < 1 || value > 120) {
                    value = 10;
                    input.value = String(value);
                }
                const patch = {};
                patch[key] = value;
                await this.store.updateConfig(patch);
                this.ctx.showMessage("闲置时长已更新为 " + value + " 分钟");
            });
        });
    }

    renderBackup(container) {
        container.innerHTML = '<div class="lp-warning">' + escapeHtml(this.ctx.t("backupWarning", "密钥 / 密码丢失将无法解密恢复内容，插件不提供找回。请务必导出备份并妥善保存。")) + '</div>' +
            '<div class="lp-section">' +
            '<div class="lp-section__title">密钥备份与恢复</div>' +
            '<div class="lp-setting-row"><div class="lp-setting-row__text">导出全部密钥包<div class="lp-setting-row__hint">文本格式，使用备份密码加密，支持一键复制。</div></div>' +
            '<button type="button" class="lp-btn" data-action="export">' + escapeHtml(this.ctx.t("exportAll", "导出全部密钥包")) + '</button></div>' +
            '<div class="lp-setting-row"><div class="lp-setting-row__text">导入密钥备份<div class="lp-setting-row__hint">用于换设备或本地配置丢失后的恢复，会覆盖当前配置。</div></div>' +
            '<button type="button" class="lp-btn" data-action="import">' + escapeHtml(this.ctx.t("importBackup", "导入密钥备份")) + '</button></div>' +
            '</div>';
        container.querySelector('[data-action="export"]').addEventListener("click", async () => {
            const result = await this.ctx.modal.askPassword({
                title: "导出密钥备份",
                desc: "这是新建的备份密码，用于加密导出，请务必记住。",
                label: this.ctx.t("backupPwdLabel", "备份密码"),
                confirmLabel: "导出",
                autocomplete: "new-password"
            });
            if (!result) {
                return;
            }
            try {
                const text = await this.store.exportBackup(result.password);
                await this.ctx.modal.showText({title: "密钥备份", text});
            } catch (error) {
                this.ctx.showMessage(error.message || "导出失败");
            }
        });
        container.querySelector('[data-action="import"]').addEventListener("click", async () => {
            const source = await this.ctx.modal.inputText({
                title: "导入密钥备份",
                label: "将备份文本粘贴到下方",
                desc: "导入会覆盖当前加密配置，请确认备份来源可信。"
            });
            if (!source) {
                return;
            }
            const result = await this.ctx.modal.askPassword({
                title: "备份密码",
                desc: "输入导出时设置的备份密码。",
                label: this.ctx.t("backupPwdLabel", "备份密码"),
                confirmLabel: "导入",
                autocomplete: "current-password"
            });
            if (!result) {
                return;
            }
            const confirmed = await this.ctx.modal.confirm({
                title: "确认导入密钥备份",
                text: "导入将覆盖当前全部加密配置，确定继续吗？",
                danger: true,
                confirmLabel: "确认导入"
            });
            if (!confirmed) {
                return;
            }
            try {
                const info = await this.store.importBackup(source.value, result.password);
                this.ctx.hook.applyHiddenStyle();
                this.ctx.showMessage("已恢复 " + info.imported + " 条记录");
                this.mainPasswordChecked = false;
                this.render();
            } catch (error) {
                this.ctx.showMessage(error.message || "导入失败");
            }
        });
    }

    renderAbout(container) {
        const t = (key, fallback) => escapeHtml(this.ctx.t(key, fallback));
        const boundaries = [
            ["aboutBoundary1", "应用层保护，非磁盘级加密"],
            ["aboutBoundary2", "默认块正文仍明文存于本地数据库"],
            ["aboutBoundary3", "解锁状态仅存内存，刷新即失效"]
        ];
        container.innerHTML = '<div class="lp-section">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<strong style="font-size:15px">' + t("aboutScopeLabel", "轻态隐私") + '</strong>' +
            '<span class="lp-badge lp-badge--mode">' + t("version", "版本") + ' 0.4.1</span>' +
            '<span class="lp-badge lp-badge--mode">' + t("aboutAdapter", "思源笔记 3.x") + '</span>' +
            '</div></div>' +
            '<div class="lp-section"><div class="lp-setting-row__text">' +
            t("aboutScopeText", "轻量锁住文档与目录，挡住随手翻阅；不改内核、不改数据库结构。") +
            '</div></div>' +
            '<div class="lp-section"><div class="lp-section__title">' + t("aboutBoundaryIntro", "安全边界（必读）") + '</div>' +
            '<ul style="display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none">' +
            boundaries.map(([key, fallback]) =>
                '<li style="display:flex;align-items:center;gap:8px">' +
                '<span style="flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--lp-brand)"></span>' +
                '<span>' + t(key, fallback) + '</span></li>').join("") +
            '</ul>' +
            '<div class="lp-setting-row__hint" style="margin-top:12px">' +
            t("aboutAdvanced", "高级模式：实验性预留，默认关闭，不写回块内容") + '</div></div>' +
            '<div class="lp-section"><div class="lp-warning" style="margin:0">' +
            t("aboutBackupLead", "密钥与密码不提供找回，请导出备份并妥善保存。") + '</div>' +
            '<div style="display:flex;justify-content:flex-end;margin-top:12px">' +
            '<button type="button" class="lp-btn lp-btn--primary" data-action="about-go-backup">' +
            t("aboutGoBackup", "前往备份 →") + '</button></div></div>' +
            '<div class="lp-section"><div class="lp-setting-row__hint">' +
            t("aboutFooter", "零第三方依赖 · 前端插件 · 8 模块构建") + '</div></div>';
        container.querySelector('[data-action="about-go-backup"]').addEventListener("click", () => {
            this.activeTab = "backup";
            this.render();
        });
    }
}

module.exports = {Panel};

}
};
function __siyuan() {
    if (typeof require === "function") {
        try {
            return require("siyuan");
        } catch (error) {}
    }
    if (typeof globalThis !== "undefined" && globalThis.siyuan && globalThis.siyuan.Plugin) {
        return globalThis.siyuan;
    }
    throw new Error("Light Privacy: siyuan API unavailable");
}
function __load(key, out) {
    var factory = __modules[key];
    if (!factory) {
        return {};
    }
    var moduleObject = out || {exports: {}};
    factory(function (id) {
        if (id === "siyuan") {
            return __siyuan();
        }
        if (id.charAt(0) !== ".") {
            if (typeof require === "function") {
                return require(id);
            }
            return {};
        }
        var base = key.split("/").slice(0, -1);
        var parts = id.split("/");
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === "." || parts[i] === "") {
                continue;
            }
            if (parts[i] === "..") {
                base.pop();
            } else {
                base.push(parts[i]);
            }
        }
        var child = base.join("/");
        if (!__modules[child] && __modules[child + ".js"]) {
            child += ".js";
        }
        return __load(child);
    }, moduleObject, moduleObject.exports);
    return moduleObject.exports;
}
var __entry = {exports: {}};
__load("index.js", __entry);
if (typeof module !== "undefined" && module.exports !== undefined) {
    module.exports = __entry.exports;
}
})();
