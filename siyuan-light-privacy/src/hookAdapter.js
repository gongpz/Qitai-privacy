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
