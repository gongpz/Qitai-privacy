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
