const fs = require("fs");
const path = require("path");

const root = __dirname;
const srcDir = path.join(root, "src");
const entryFile = path.join(srcDir, "index.js");
const modules = {};
const visiting = new Set();

function normalize(file) {
    return path.relative(srcDir, file).replace(/\\/g, "/");
}

function collect(file) {
    const key = normalize(file);
    if (modules[key] || visiting.has(key)) {
        return;
    }
    visiting.add(key);
    const code = fs.readFileSync(file, "utf8");
    modules[key] = code;
    const pattern = /require\(\s*["'](\.[^"']+)["']\s*\)/g;
    let match;
    while ((match = pattern.exec(code)) !== null) {
        let target = path.resolve(path.dirname(file), match[1]);
        if (!path.extname(target)) {
            target += ".js";
        }
        collect(target);
    }
    visiting.delete(key);
}

collect(entryFile);

const moduleBodies = Object.keys(modules).map(key =>
    JSON.stringify(key) + ": function(require, module, exports) {\n" + modules[key] + "\n}"
).join(",\n");

const bundle = `(function () {
var __modules = {
${moduleBodies}
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
`;

fs.writeFileSync(path.join(root, "index.js"), bundle, "utf8");
fs.copyFileSync(path.join(root, "assets", "style.css"), path.join(root, "index.css"));
console.log("built index.js from " + Object.keys(modules).length + " modules");
console.log("copied index.css");
