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
