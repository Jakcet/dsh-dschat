/**
 * dsh-dschat — Host 侧（node 进程，没有 electron 模块）。
 *
 * 真正的 DeepSeek 网页版视图由 client 半部创建：渲染器通过 preload 暴露的
 * `globalThis.dshDesktop.browser` 向 Electron 主进程申请 guest lease，再自己挂
 * `<webview>` 标签。Host 这里只负责两件小事：
 *   1. 登录态快照的落盘（partition 是进程内内存分区，重启即丢，靠回填 localStorage 兜底）。
 *   2. 首次安装时刷新 client-modules 的 manifest 缓存，免重启看到面板。
 *
 * 路由（同源，client 用 fetch 调）：
 *   - GET  /api/dschat/ping     健康检查
 *   - GET  /api/dschat/session  读取 localStorage 快照
 *   - POST /api/dschat/session  写入 localStorage 快照
 *   - POST /api/dschat/log      client 诊断日志（~/.dsh/dsh-dschat/client.log）
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-dschat'
export const inject = ['webServer']

const LOG_DIR = join(homedir(), '.dsh', 'dsh-dschat')
const LOG_FILE = join(LOG_DIR, 'client.log')
const SESSION_FILE = join(LOG_DIR, 'storage.json')

function sendJson(res, code, body) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readSession() {
  try {
    const raw = await readFile(SESSION_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * client-modules 按 `${baseUrl}\0${loaderName}` 永久缓存包 manifest 的解析结果；首次解析
 * 失败（例如 link 包暂时缺 `exports["./package.json"]`）会缓存成 null，之后改好 package.json
 * 也不会重试。这里清掉本包的缓存并重扫一次，避免用户必须重启应用才看到面板。
 */
function refreshClientModule(ctx) {
  ctx.inject(['clientModules'], (scope) => {
    const cm = scope.clientModules
    if (!cm || !cm.pkgMeta || typeof cm.processOne !== 'function') return
    try {
      let cleared = 0
      for (const key of [...cm.pkgMeta.keys()]) {
        if (String(key).endsWith('\u0000dsh-dschat')) {
          cm.pkgMeta.delete(key)
          cleared += 1
        }
      }
      if (cleared === 0) return
      let failure = null
      const onError = (error) => { failure = error instanceof Error ? error.message : String(error) }
      const changed = cm.processOne('dsh-dschat', onError)
      if (changed && typeof cm.compose === 'function') {
        cm.composed = cm.compose()
        cm.notifyGraphChanged?.()
      }
      ctx.logger?.info?.(`dsh-dschat: client module cache refreshed (cleared=${cleared}, changed=${changed}, error=${failure ?? 'none'})`)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-dschat: client module refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

export function apply(ctx) {
  refreshClientModule(ctx)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/dschat',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      try {
        if (req.method === 'GET' && url.pathname === '/api/dschat/ping') {
          sendJson(res, 200, { ok: true, plugin: 'dsh-dschat', origin: ctx.webServer.getOrigin() })
          return
        }
        if (req.method === 'GET' && url.pathname === '/api/dschat/session') {
          sendJson(res, 200, { ok: true, storage: await readSession() })
          return
        }
        if (req.method === 'POST' && url.pathname === '/api/dschat/session') {
          const text = await readBody(req, 1024 * 1024)
          if (text === null) {
            sendJson(res, 413, { ok: false, error: 'body too large' })
            return
          }
          let parsed
          try { parsed = JSON.parse(text) } catch { parsed = null }
          const storage = parsed && parsed.storage
          if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
            sendJson(res, 400, { ok: false, error: 'storage object required' })
            return
          }
          await mkdir(LOG_DIR, { recursive: true })
          await writeFile(SESSION_FILE, JSON.stringify(storage), { encoding: 'utf8', mode: 0o600 })
          sendJson(res, 200, { ok: true, keys: Object.keys(storage).length })
          return
        }
        if (req.method === 'POST' && url.pathname === '/api/dschat/log') {
          const text = await readBody(req, 64 * 1024)
          if (text === null) {
            sendJson(res, 413, { ok: false, error: 'body too large' })
            return
          }
          await mkdir(LOG_DIR, { recursive: true })
          await appendFile(LOG_FILE, `${new Date().toISOString()} ${text}\n`, 'utf8')
          sendJson(res, 200, { ok: true })
          return
        }
        sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-dschat: http routes')
}
