/**
 * dsh-dschat — client 半部。
 *
 * 在 DSH 桌面版主窗口里注册一个侧栏入口和一个 keyed main 面板；面板里通过
 * preload 暴露的 `globalThis.dshDesktop.browser` 向 Electron 主进程申请 guest
 * lease，再自建 `<webview>` 载入 https://chat.deepseek.com/。主进程会校验 lease
 * 后才真正 attach，所以这条路径等同内置 Sidebar 浏览器的隔离策略。
 *
 * 登录态：DSH 给 Sidebar 浏览器分配的 partition 是进程内内存分区，应用重启即丢。
 * 这里把网页版 localStorage 快照备份到 Host 侧文件，下次载入后回填再 reload，
 * 让用户不用每次重启重新登录（httpOnly cookie 不在备份范围内）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-dschat',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dshWeb'
    const PANEL_ID = 'dsh-dschat'
    const HOME = 'https://chat.deepseek.com/'
    const WORKSPACE_KEY = 'dsh-dschat'

    const zh = {
      'entry.label': 'DeepSeek 网页版',
      'panel.title': 'DeepSeek 网页版',
      'panel.starting': '正在申请内嵌浏览器…',
      'panel.loading': '正在载入 DeepSeek…',
      'panel.desktopOnly': '这个面板需要 DSH 桌面版。网页版请直接在系统浏览器里打开 chat.deepseek.com。',
      'panel.acquireFailed': '无法创建内嵌浏览器：{message}',
      'panel.guestDestroyed': '内嵌页面已关闭，重新打开面板即可恢复。',
      'panel.loadFailed': '页面加载失败（{code} {description}）',
      'action.back': '后退',
      'action.forward': '前进',
      'action.reload': '刷新',
      'action.home': '回到 DeepSeek 首页',
      'action.external': '在系统浏览器中打开',
    }
    const en = {
      'entry.label': 'DeepSeek Web',
      'panel.title': 'DeepSeek Web',
      'panel.starting': 'Requesting an embedded browser…',
      'panel.loading': 'Loading DeepSeek…',
      'panel.desktopOnly': 'This panel requires DSH Desktop. Open chat.deepseek.com in a browser instead.',
      'panel.acquireFailed': 'Could not create the embedded browser: {message}',
      'panel.guestDestroyed': 'The embedded page was closed. Reopen the panel to restore it.',
      'panel.loadFailed': 'Page failed to load ({code} {description})',
      'action.back': 'Back',
      'action.forward': 'Forward',
      'action.reload': 'Reload',
      'action.home': 'Back to the DeepSeek home page',
      'action.external': 'Open in system browser',
    }

    const STYLE_ID = `${PANEL_ID}/css`
    const CSS = [
      '.dsw-root{display:flex;flex-direction:column;height:100%;min-height:0;flex:1 1 auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.dsw-toolbar{display:flex;flex:none;align-items:center;gap:4px;height:38px;padding:5px 6px;box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3)}',
      '.dsw-tool{display:inline-flex;flex:none;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dsw-tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsw-tool:disabled{color:var(--dsw-alias-label-quaternary);cursor:default}',
      '.dsw-location{flex:auto;min-width:0;overflow:hidden;padding:0 8px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap}',
      '.dsw-loading{flex:none;width:12px;height:12px;margin:0 6px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);animation:dsw-spin .8s linear infinite}',
      '@keyframes dsw-spin{to{transform:rotate(360deg)}}',
      '.dsw-viewport{position:relative;flex:auto;min-height:0;background:var(--dsw-alias-bg-base)}',
      '.dsw-host{position:absolute;inset:0}',
      '.dsw-webview{display:flex;width:100%;height:100%;border:0;background:var(--dsw-alias-bg-base)}',
      '.dsw-notice{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base)}',
      '.dsw-notice[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
    ].join('')

    function ensureStyle() {
      if (typeof document === 'undefined') return () => {}
      const previous = document.getElementById(STYLE_ID)
      if (previous) return () => {}
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.plugin = PANEL_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    function errorText(error) {
      if (error instanceof Error) return error.message
      if (typeof error === 'string') return error
      try { return JSON.stringify(error) } catch { return String(error) }
    }

    function report(event, detail) {
      try {
        const body = JSON.stringify({ event, detail, at: Date.now() })
        void fetch('/api/dschat/log', { method: 'POST', body, keepalive: true }).catch(() => {})
      } catch {}
    }

    async function readSessionBackup() {
      try {
        const response = await fetch('/api/dschat/session', { cache: 'no-store' })
        if (!response.ok) return null
        const data = await response.json()
        return data && data.storage && typeof data.storage === 'object' ? data.storage : null
      } catch { return null }
    }

    async function writeSessionBackup(storage) {
      try {
        const response = await fetch('/api/dschat/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ storage }),
        })
        return { ok: response.ok, status: response.status }
      } catch (error) {
        return { ok: false, status: 0, error: String(error) }
      }
    }

    function safeCall(run, fallback) {
      try { return run() } catch { return fallback }
    }

    function IconButton(props) {
      return h('button', {
        type: 'button',
        className: 'dsw-tool',
        title: props.label,
        'aria-label': props.label,
        disabled: Boolean(props.disabled),
        onClick: props.onClick,
      }, h('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
      }, props.children))
    }

    const STROKE = {
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }
    function strokePath(d) {
      return h('path', { d, ...STROKE })
    }

    function PanelIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 20 20',
        fill: 'none',
        'aria-hidden': true,
      },
        h('path', {
          d: 'M3.2 6.1A2.9 2.9 0 0 1 6.1 3.2h7.8a2.9 2.9 0 0 1 2.9 2.9v4.4a2.9 2.9 0 0 1-2.9 2.9h-3.7l-3.9 3c-.6.5-1.5 0-1.5-.8v-2.2H6.1a2.9 2.9 0 0 1-2.9-2.9V6.1Z',
          fill: 'currentColor',
          opacity: 0.92,
        }),
        h('path', {
          d: 'M7.1 8.2h5.8M7.1 10.9h3.8',
          stroke: 'var(--dsw-alias-bg-base, #fff)',
          strokeWidth: 1.25,
          strokeLinecap: 'round',
        })
      )
    }

    function DeepSeekPanel(props) {
      const t = props.t
      const hostRef = React.useRef(null)
      const tRef = React.useRef(t)
      tRef.current = t
      const [state, setState] = React.useState({
        status: 'starting',
        url: '',
        loading: true,
        canGoBack: false,
        canGoForward: false,
        error: null,
      })
      const update = React.useCallback((patch) => {
        setState((previous) => ({ ...previous, ...patch }))
      }, [])
      const frameRef = React.useRef(null)

      React.useEffect(() => {
        const host = hostRef.current
        if (!host) return undefined
        const text = (key, values) => {
          const translate = tRef.current
          return translate ? translate(key, values) : key
        }
        const carrier = globalThis.dshDesktop
        const bridge = carrier && carrier.protocolVersion === 1 ? carrier.browser : undefined
        if (!bridge) {
          update({ status: 'error', loading: false, error: text('panel.desktopOnly') })
          report('unsupported', { carrier: Boolean(carrier) })
          return undefined
        }
        report('panel:mount', {})

        let disposed = false
        let webview = null
        let lease = undefined
        let offOpen = undefined
        let started = false
        let restored = false
        let lastSnapshot = ''
        let persisting = false
        const offs = []
        const listen = (el, name, handler) => {
          el.addEventListener(name, handler)
          offs.push(() => el.removeEventListener(name, handler))
        }

        const readUrl = (el) => safeCall(() => el.getURL(), '') || ''
        const syncHistory = (el) => {
          update({
            url: readUrl(el),
            canGoBack: Boolean(safeCall(() => el.canGoBack(), false)),
            canGoForward: Boolean(safeCall(() => el.canGoForward(), false)),
          })
        }

        const persistSnapshot = async (el) => {
          if (disposed || persisting || !el) return
          persisting = true
          try {
            const raw = await el.executeJavaScript(
              '(() => { const out = {}; try { for (let i = 0; i < localStorage.length; i += 1) { const key = localStorage.key(i); if (key !== null) out[key] = localStorage.getItem(key) ?? "" } } catch (error) { return null } return JSON.stringify(out) })()'
            )
            if (typeof raw !== 'string' || raw.length <= 2 || raw === lastSnapshot) return
            let parsed
            try { parsed = JSON.parse(raw) } catch { return }
            if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) return
            // 只备份「已登录」状态：未登录时 localStorage 也会有一堆匿名键，
            // 写回去只会污染下一次恢复。
            const onSignIn = /\/sign_in/i.test(readUrl(el))
            const looksLoggedIn = Object.keys(parsed).some((key) => /token|user|auth|session/i.test(key))
            if (onSignIn || !looksLoggedIn) {
              report('persist:skip', { onSignIn, keys: Object.keys(parsed).length })
              return
            }
            // 只保留登录相关的键：整份 localStorage 可能有几百 KB 缓存，既没必要
            // 也没法保证写盘成功（体积越界会被服务端拒绝）。
            const relevant = {}
            for (const key of Object.keys(parsed)) {
              if (!/(token|user|auth|session|login)/i.test(key)) continue
              const value = parsed[key]
              if (typeof value !== 'string' || value.length > 64 * 1024) continue
              relevant[key] = value
            }
            if (Object.keys(relevant).length === 0) {
              report('persist:skip', { onSignIn, reason: 'no-auth-keys', keys: Object.keys(parsed).length })
              return
            }
            const snapshot = JSON.stringify(relevant)
            if (snapshot === lastSnapshot) return
            lastSnapshot = snapshot
            const result = await writeSessionBackup(relevant)
            report(result.ok ? 'persist:saved' : 'persist-failed', {
              keys: Object.keys(relevant).length,
              status: result.status,
            })
          } catch (error) {
            report('persist-failed', errorText(error))
          } finally {
            persisting = false
          }
        }

        const restoreSnapshot = async (el) => {
          if (restored) return
          restored = true
          const storage = await readSessionBackup()
          if (!storage || Object.keys(storage).length === 0) {
            report('restore:none', {})
            return
          }
          try {
            const code = '(() => { const map = ' + JSON.stringify(storage) + '; let changed = 0; try { for (const key of Object.keys(map)) { if (localStorage.getItem(key) !== map[key]) { localStorage.setItem(key, map[key]); changed += 1 } } } catch (error) { return { error: String(error) } } return { changed } })()'
            const result = await el.executeJavaScript(code)
            report('restore:applied', { keys: Object.keys(storage).length, result })
            if (result && result.changed > 0) {
              const here = readUrl(el)
              report('restore:reload', { url: here })
              try {
                // 停在登录页时直接回首页，让前端读到刚回填的 token 后自行进入会话。
                if (/\/sign_in/i.test(here)) el.loadURL(HOME)
                else await el.executeJavaScript('location.reload()')
              } catch {}
            }
          } catch (error) {
            report('restore-failed', errorText(error))
          }
        }

        ;(async () => {
          let reservation
          try {
            reservation = await bridge.acquire(WORKSPACE_KEY)
          } catch (error) {
            if (!disposed) update({ status: 'error', loading: false, error: text('panel.acquireFailed', { message: errorText(error) }) })
            report('acquire-failed', errorText(error))
            return
          }
          if (disposed) {
            Promise.resolve(bridge.release(reservation.lease)).catch(() => {})
            return
          }
          lease = reservation.lease
          report('acquired', { partition: reservation.partition })
          update({ status: 'ready', loading: true })

          const el = document.createElement('webview')
          webview = el
          frameRef.current = el
          el.className = 'dsw-webview'
          el.setAttribute('name', reservation.lease)
          el.setAttribute('partition', reservation.partition)
          el.setAttribute('allowpopups', '')
          el.setAttribute('src', `about:blank#${reservation.lease}`)

          listen(el, 'dom-ready', () => {
            if (disposed) return
            update({ loading: true })
            if (!started) {
              started = true
              report('dom-ready', {})
              try { el.loadURL(HOME) } catch (error) {
                update({ status: 'error', loading: false, error: text('panel.loadFailed', { code: '', description: errorText(error) }) })
                report('load-failed', errorText(error))
              }
            }
          })
          listen(el, 'did-start-loading', () => { if (!disposed) update({ loading: true }) })
          listen(el, 'did-stop-loading', () => {
            if (disposed) return
            update({ loading: false })
            syncHistory(el)
            if (started) void restoreSnapshot(el)
          })
          listen(el, 'did-finish-load', () => {
            if (disposed) return
            update({ loading: false })
            syncHistory(el)
            if (started) void persistSnapshot(el)
          })
          listen(el, 'did-navigate', (event) => {
            if (disposed) return
            update({ url: event.url || readUrl(el) })
            syncHistory(el)
          })
          listen(el, 'did-navigate-in-page', (event) => {
            if (disposed || !event.isMainFrame) return
            update({ url: event.url || readUrl(el) })
            syncHistory(el)
          })
          listen(el, 'page-title-updated', () => { if (!disposed) syncHistory(el) })
          listen(el, 'did-fail-load', (event) => {
            if (disposed || !event.isMainFrame || event.errorCode === -3) return
            report('did-fail-load', { code: event.errorCode, description: event.errorDescription })
            update({
              loading: false,
              error: text('panel.loadFailed', {
                code: event.errorCode,
                description: event.errorDescription || '',
              }),
            })
          })
          listen(el, 'destroyed', () => {
            report('guest-destroyed', {})
            if (!disposed) update({ error: text('panel.guestDestroyed') })
          })

          offOpen = bridge.onOpenRequested(reservation.lease, (url) => {
            if (disposed) return
            try { el.loadURL(url) } catch (error) { report('popup-failed', errorText(error)) }
          })

          host.appendChild(el)
        })()

        return () => {
          disposed = true
          report('panel-unmounted', {})
          for (const off of offs.splice(0)) { try { off() } catch {} }
          if (offOpen) { try { offOpen() } catch {} }
          if (webview && webview.parentNode) webview.remove()
          frameRef.current = null
          if (lease !== undefined) {
            Promise.resolve(bridge.release(lease)).catch((error) => report('release-failed', errorText(error)))
            lease = undefined
          }
        }
      }, [update])

      const el = () => frameRef.current
      const goBack = () => { const view = el(); if (view) { try { view.goBack() } catch {} } }
      const goForward = () => { const view = el(); if (view) { try { view.goForward() } catch {} } }
      const reload = () => { const view = el(); if (view) { try { view.reload() } catch {} } }
      const goHome = () => { const view = el(); if (view) { try { view.loadURL(HOME) } catch {} } }
      const openExternal = () => {
        const url = state.url || HOME
        try { window.open(url, '_blank', 'noopener,noreferrer') } catch {}
      }

      const notice = state.status === 'error'
        ? h('div', { className: 'dsw-notice', 'data-kind': 'error', role: 'alert' }, state.error || '')
        : state.status === 'starting'
          ? h('div', { className: 'dsw-notice', role: 'status' }, t('panel.starting'))
          : null

      return h('div', { className: 'dsw-root' },
        h('div', { className: 'dsw-toolbar' },
          h(IconButton, { label: t('action.back'), disabled: !state.canGoBack, onClick: goBack }, strokePath('M10 3.2 5.2 8 10 12.8')),
          h(IconButton, { label: t('action.forward'), disabled: !state.canGoForward, onClick: goForward }, strokePath('M6 3.2 10.8 8 6 12.8')),
          h(IconButton, { label: t('action.reload'), onClick: reload },
            h('path', { d: 'M12.6 8A4.6 4.6 0 1 1 11 4.6', ...STROKE }),
            h('path', { d: 'M12.9 2.4v3h-3', ...STROKE })
          ),
          h(IconButton, { label: t('action.home'), onClick: goHome },
            h('path', { d: 'M3.2 7.4 8 3.4l4.8 4v5.2h-9.6z', ...STROKE })
          ),
          h('span', { className: 'dsw-location', title: state.url }, state.url || HOME),
          state.loading ? h('span', { className: 'dsw-loading', 'aria-hidden': true }) : null,
          h(IconButton, { label: t('action.external'), onClick: openExternal },
            h('path', { d: 'M9.4 3.2h3.4v3.4', ...STROKE }),
            h('path', { d: 'M12.8 3.2 7.6 8.4', ...STROKE }),
            h('path', { d: 'M11.2 9.4v3.2H3.4V4.8h3.2', ...STROKE })
          )
        ),
        h('div', { className: 'dsw-viewport' },
          h('div', { className: 'dsw-host', ref: hostRef }),
          notice
        )
      )
    }

    function apply(ctx) {
      const namespace = NS
      const t = ctx.locale.bind(namespace)
      ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-dschat: locale')
      ctx.effect(() => ensureStyle(), 'dsh-dschat: styles')
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.inject('sidebar.panellist', () => {
        const disposers = []
        disposers.push(ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 40,
          locale: namespace,
          label: () => t('entry.label'),
        }, PanelIcon))
        disposers.push(ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: namespace,
          inject: () => ({ t }),
        }, DeepSeekPanel))
        return () => {
          for (const dispose of disposers) { try { dispose() } catch {} }
        }
      })), 'dsh-dschat: slots')
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
