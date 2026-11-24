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
