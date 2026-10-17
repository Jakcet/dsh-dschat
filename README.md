# dsh-dschat

[![npm version](https://img.shields.io/npm/v/dsh-dschat.svg)](https://www.npmjs.com/package/dsh-dschat)
[![license](https://img.shields.io/npm/l/dsh-dschat.svg)](https://github.com/Jakcet/dsh-dschat/blob/main/LICENSE)

把 DeepSeek 网页版聊天（[chat.deepseek.com](https://chat.deepseek.com/)）装进 **DSH 桌面版**的面板里。

侧栏会多一个「DeepSeek 网页版」图标，点开就是一个主面板，里面用 Electron `<webview>` 原样载入网页版，工具栏可以后退、前进、刷新、回首页、在系统浏览器打开。登录在 DeepSeek 自己的页面上完成，插件不接触你的密码。

> 这个面板需要 `globalThis.dshDesktop.browser`，它只由 DSH 桌面版的 preload 暴露；Web 版只会显示一行提示。

## 功能

- **侧栏入口 + 主面板**：keyed panel，图标是蓝色鲸鱼气泡。
- **工具栏**：后退、前进、刷新、回 DeepSeek 首页、当前地址、在系统浏览器中打开。
- **原样加载** `https://chat.deepseek.com/`，不改页面、不注入脚本（只在你登录后读一次 `localStorage` 做快照）。
- **登录快照**：DSH 侧栏浏览器的 partition 是进程内内存分区，应用重启就丢 cookie。登录后插件把页面 `localStorage` 里登录相关的键备份到 `~/.dsh/dsh-dschat/storage.json`（权限 `0600`），下次载入时先回填、再刷新页面。
  能不能因此完全跳过登录页，取决于网页版把会话放在哪里：`httpOnly` cookie 不在快照范围内。

## 安装

在 DSH 插件市场里搜索 `dsh-dschat` 安装，或手动作为 bundle 装进你的 DSH profile：

```sh
npm install dsh-dschat
```

## 要求

- **DSH 桌面版**（依赖 preload 暴露的 `globalThis.dshDesktop.browser`）。
- DSH `>= 0.2.1-rc.2`。

## 它是怎么工作的

1. 主面板挂载时，client 半部向 DSH 桌面版的 preload 桥申请一个 guest：`globalThis.dshDesktop.browser.acquire(workspace)`。
2. 拿到 `{ lease, partition }` 后创建 `<webview>`，`name` 填 lease、`partition` 填 partition、`src` 填 `about:blank#<lease>`；DSH 主进程会在 `will-attach-webview` 里校验 lease 和 partition，通过后才真正挂载。
3. pages 加载完成（`dom-ready`）后 `loadURL('https://chat.deepseek.com/')`。
4. 登录态变化后，把 `localStorage` 里键名匹配 `token/user/auth/session/login` 的字符串值 POST 给插件的 host 路由，写到本地快照文件；下次打开时先回填再刷新。
5. 面板卸载时 `bridge.release(lease)` 释放 guest。

因为走的是和内置侧栏浏览器同一套 lease 校验、sandbox 与导航策略，插件本身拿不到 Electron/Node 权限。

## 已知限制（来自 DSH 宿主策略，插件绕不过去）

- guest 内发起的**下载会被取消**。
- 通知、麦克风、剪贴板等**权限请求一律拒绝**。
- 窗口打开请求会转成同面板内导航。
- 浏览器 partition 每次启动重建，用公开 API 做不到「完全零登录」重启。
- 只有桌面版可用，Web 版不工作。

## 隐私

插件不代理、不抓取、不转发任何内容，只渲染官方页面并保留一份本地快照。快照里可能有登录相关数据的明文，请当作 cookie 文件对待，不要分享；删掉 `~/.dsh/dsh-dschat/storage.json` 即可清除快照。

## 文件

- `index.js` — host 半部：快照与日志的 HTTP 路由，以及一次性的客户端模块清单缓存刷新。
- `client.js` — client 半部：侧栏图标、主面板、webview 生命周期、工具栏。
- `cordis.patch.yml` — bundle patch。
- `icon.svg` — 插件图标。

## License

MIT

---

# English

Embed the DeepSeek web chat (`chat.deepseek.com`) in a **DSH Desktop** main panel.

A sidebar entry opens a keyed main panel that hosts the real DeepSeek web app inside an
Electron `<webview>` guest, requested from the DSH desktop preload bridge
(`globalThis.dshDesktop.browser.acquire`) so it goes through the same main-process lease
check, sandbox flags and navigation policy as the built-in sidebar browser.

## What it does

- Adds a **DeepSeek Web** entry to the sidebar icon list and a main panel.
- Toolbar: back, forward, reload, home, current URL, open in system browser.
- Loads `https://chat.deepseek.com/` unmodified. Sign-in happens on DeepSeek's own page;
  the plugin never sees or stores your password.
- **Login snapshot.** DSH's sidebar-browser partition is a process-local in-memory
  partition, so cookies are gone after an app restart. After you sign in, the plugin copies
  login-related `localStorage` keys to `~/.dsh/dsh-dschat/storage.json` (mode `0600`) and
  restores them on the next load before reloading the page. Whether that is enough to skip
  the sign-in screen depends on where DeepSeek keeps the session: `httpOnly` cookies are
  not part of the snapshot.

## Install

Install it from the DSH plugin market (search for `dsh-dschat`), or add this package as a
bundle to your DSH profile:

```sh
npm install dsh-dschat
```

## Requirements

- **DSH Desktop.** The panel needs `globalThis.dshDesktop.browser`, which only the desktop
  preload exposes. In the web build the panel shows a notice and does nothing.
- DSH `>=0.2.1-rc.2`.

## Known limits (enforced by the DSH host, not by this plugin)

- Downloads started inside the guest are cancelled.
- Permission requests (notifications, microphone, clipboard) are denied.
- Window-open requests are turned into navigation in the same panel.
- The browser partition is recreated on every app start, so a fully zero-login restart is
  not possible with the public host API.

## Privacy

The plugin does not proxy, scrape or forward anything. It renders the official page and
keeps one local snapshot file. That file can contain login-related values in plain text;
treat it like a cookie jar and do not share it. Delete it to forget the snapshot.

## License

MIT
