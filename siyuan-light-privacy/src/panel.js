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
            '<label class="lp-radio"><input type="radio" name="lp-theme" data-theme-value="auto"' + (theme === "auto" ? " checked" : "") + '> 跟随系统</label>' +
            '<label class="lp-radio"><input type="radio" name="lp-theme" data-theme-value="light"' + (theme === "light" ? " checked" : "") + '> 浅色</label>' +
            '<label class="lp-radio"><input type="radio" name="lp-theme" data-theme-value="dark"' + (theme === "dark" ? " checked" : "") + '> 深色</label>' +
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
        container.innerHTML = '<div class="lp-section">' +
            '<dl class="lp-about-list">' +
            '<dt>' + escapeHtml(this.ctx.t("version", "版本")) + '</dt><dd>0.4.0</dd>' +
            '<dt>' + escapeHtml(this.ctx.t("adaptVersion", "适配版本")) + '</dt><dd>思源笔记 3.x</dd>' +
            '<dt>实现范围</dt><dd>V0.1 - V0.4；V0.5 高级块正文加密为实验性预留，默认不写回块内容。</dd>' +
            '</dl></div>' +
            '<div class="lp-section"><div class="lp-section__title">' + escapeHtml(this.ctx.t("boundaryTitle", "安全能力边界")) + '</div>' +
            '<div class="lp-setting-row__text">轻态隐私是应用层隐私保护，不是磁盘级或密码学级强加密：</div>' +
            '<div class="lp-setting-row__text">1. 默认模式下块内容仍以明文存于思源本地数据库，直接读取数据库文件可获取原文。</div>' +
            '<div class="lp-setting-row__text">2. 定位于防家人 / 同事随手翻阅、防演示误点开，不用于对抗专业数据取证。</div>' +
            '<div class="lp-setting-row__text">3. 如需更高强度，可开启高级模式，但需接受版本回退等风险。</div>' +
            '<div class="lp-setting-row__text">4. 密码与密钥不提供任何找回机制，请务必导出备份。</div>' +
            '</div>' +
            '<div class="lp-warning">密钥与密码不提供找回，请在「密钥备份与恢复」中导出备份。</div>';
    }
}

module.exports = {Panel};
