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
