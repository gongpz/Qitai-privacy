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
