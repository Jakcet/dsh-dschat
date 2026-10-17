# dsh-dschat

Embed the DeepSeek web chat (`chat.deepseek.com`) in a DSH Desktop panel.

A sidebar entry opens a main panel that hosts the real DeepSeek web app inside an
Electron `<webview>` guest. The guest is requested from the DSH desktop preload bridge
(`globalThis.dshDesktop.browser.acquire`), so it goes through the same main-process
lease check, sandbox flags and navigation policy as the built-in sidebar browser.

## What it does

- Adds a **DeepSeek Web** entry to the sidebar icon list and a keyed main panel.
- Toolbar: back, forward, reload, home, current URL, open in system browser.
- Loads `https://chat.deepseek.com/` unmodified. Sign-in happens on DeepSeek's own
  page; the plugin never sees or stores your password.
- **Login snapshot.** DSH's sidebar-browser partition is a process-local in-memory
  partition, so cookies are gone after an app restart. After you sign in, the plugin
  copies the page's `localStorage` to `~/.dsh/dsh-dschat/storage.json` (mode `0600`)
  through a small same-origin HTTP route, and restores it on the next load before
  reloading the page. Whether that is enough to skip the sign-in screen depends on
  where DeepSeek keeps the session: `httpOnly` cookies are not part of the snapshot.

## Requirements

- **DSH Desktop.** The panel needs `globalThis.dshDesktop.browser`, which only the
  desktop preload exposes. In the web build the panel shows a notice and does nothing.
- DSH `>=0.2.1-rc.2`.

## Install

```sh
dsh plugin add dsh-dschat
```

or install it from the plugin market.

## Known limits (enforced by the DSH host, not by this plugin)

- Downloads started inside the guest are cancelled.
- Permission requests (notifications, microphone, clipboard) are denied.
- Window-open requests are turned into navigation in the same panel.
- The browser partition is recreated on every app start, so a full zero-login restart
  is not possible with the public host API.

## Privacy

The plugin does not proxy, scrape or forward anything. It renders the official page and
keeps one local snapshot file. That file can contain login-related values in plain text;
treat it like a cookie jar and do not share it. Delete it to forget the snapshot.

## Files

- `index.js` — host half: the snapshot and log HTTP routes, plus a one-shot refresh of
  the client-module manifest cache.
- `client.js` — client half: sidebar icon, main panel, webview lifecycle, toolbar.
- `cordis.patch.yml` — bundle patch.

## License

MIT

---

# 中文说明

把 DeepSeek 网页版聊天装进 DSH 桌面版的面板里。

侧栏多一个「DeepSeek 网页版」图标，点开是主面板，里面用 Electron `<webview>` 载入
`chat.deepseek.com`。这个 guest 是向 DSH 桌面版 preload 暴露的
`globalThis.dshDesktop.browser` 申请的，因此和内置侧栏浏览器走同一套主进程 lease
校验、sandbox 与导航策略。

## 功能

- 侧栏入口 + 主面板；工具栏有后退、前进、刷新、首页、当前地址、在系统浏览器中打开。
- 原样加载 `https://chat.deepseek.com/`，登录在 DeepSeek 自己的页面上完成，插件不接触密码。
- **登录快照**：DSH 侧栏浏览器的 partition 是进程内内存分区，应用重启即丢 cookie。
  登录后插件会把页面的 `localStorage` 通过同源 HTTP 路由备份到
  `~/.dsh/dsh-dschat/storage.json`（权限 `0600`），下次载入时先回填再刷新。
  能不能因此跳过登录页，取决于网页版把会话放在哪里：`httpOnly` cookie 不在快照范围内。

## 要求

- **DSH 桌面版**。面板依赖 preload 暴露的 `globalThis.dshDesktop.browser`，Web 版只显示提示。
- DSH `>=0.2.1-rc.2`。

## 安装

```sh
dsh plugin add dsh-dschat
```

或在插件市场里安装。

## 已知限制（来自 DSH 宿主策略，插件无法绕过）

- guest 内发起的下载会被取消。
- 通知、麦克风、剪贴板等权限请求一律拒绝。
- 窗口打开请求会转成同面板内导航。
- 浏览器 partition 每次启动重建，用公开 API 做不到完全免登录重启。

## 隐私

插件不代理、不抓取、不转发任何内容，只渲染官方页面并保留一份本地快照。快照里可能有
登录相关数据的明文，请当作 cookie 文件对待，不要分享；删掉它即可清除快照。

## 许可

MIT
