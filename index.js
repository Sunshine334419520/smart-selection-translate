/**
 * dblclick-translate — Host half.
 *
 * Two capabilities behind one small HTTP surface:
 *   1. `translate` — machine translation through `ctx.translator` (sentences, and
 *      any word the dictionary does not know).
 *   2. `dict` / `audio` — a real dictionary entry for a single word: UK/US IPA,
 *      part-of-speech senses, and 网络释义, plus pronunciation audio.
 *
 * The browser half owns the double-click gesture and the card; this half owns the
 * network and the credentials. Two transports, one implementation:
 *   A. `ctx.connection.fetch.register()` under `/api/…` — the carrier applies the
 *      Host/Origin fence and browser session authentication.
 *   B. `ctx.webServer.register({ kind: 'exact' })` — raw node handler, used only
 *      when `connection` is absent; it authenticates with `connection.requestRejection`
 *      when available and is otherwise loopback-only (desktop).
 */

const API_PREFIX = '/api/smart-selection-translate'
const FALLBACK_PREFIX = '/plugins/smart-selection-translate'
const PROVIDERS = ['bing', 'google', 'deepseek-account', 'deepseek-official']
const PAID_PROVIDERS = new Set(['deepseek-account', 'deepseek-official'])
const MAX_TEXT_CHARS = 4000
const MAX_WORD_CHARS = 48
const MAX_BODY_BYTES = 256 * 1024

const DICT_ENDPOINT = 'https://dict.youdao.com/jsonapi?q='
const BING_DICT_ENDPOINT = 'https://cn.bing.com/dict/search?q='
const AUDIO_ENDPOINT = 'https://dict.youdao.com/dictvoice?audio='
const UPSTREAM_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: '*/*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

function readService(ctx, name) {
  try {
    const value = ctx.get(name)
    return value || null
  } catch (error) {
    return null
  }
}

function failure(code, message) {
  return { ok: false, code, message }
}

/**
 * `translator` is composed at the profile root by this bundle's own patch row, but
 * a plugin can activate a moment before that sibling row registers. Resolve it per
 * request, and fall back to a live Agent's scoped context (the scope that owns the
 * Session a paid route writes into).
 */
function resolveTranslator(ctx, sessionId) {
  const root = readService(ctx, 'translator')
  if (root) return root

  const agents = readService(ctx, 'agents')
  if (!agents || typeof agents.list !== 'function') return null

  const candidates = []
  if (sessionId && typeof agents.get === 'function') {
    try {
      const exact = agents.get(sessionId)
      if (exact) candidates.push(exact)
    } catch (error) {
      /* unknown or already disposed session */
    }
  }
  try {
    for (const agent of agents.list() || []) {
      if (candidates.indexOf(agent) < 0) candidates.push(agent)
    }
  } catch (error) {
    /* registry unavailable */
  }

  for (const agent of candidates) {
    const scoped = readService(agent && agent.ctx, 'translator')
    if (scoped) return scoped
  }
  return null
}

/** Small, value-free facts for the settings page when translation is unreachable. */
function scopeDiagnostics(ctx) {
  const diagnostics = { root: false, liveAgents: 0, scoped: 0 }
  try {
    diagnostics.root = Boolean(readService(ctx, 'translator'))
  } catch (error) {
    /* ignore */
  }
  const agents = readService(ctx, 'agents')
  if (agents && typeof agents.list === 'function') {
    try {
      const list = agents.list() || []
      diagnostics.liveAgents = list.length
      diagnostics.scoped = list.filter((agent) => Boolean(readService(agent && agent.ctx, 'translator'))).length
    } catch (error) {
      /* ignore */
    }
  }
  return diagnostics
}

/* ── machine translation ─────────────────────────────────────────────── */

/** Validate one request body and translate it. Returns a transport-neutral result. */
async function translate(ctx, input, signal) {
  const source = input && typeof input === 'object' ? input : {}
  const text = typeof source.text === 'string' ? source.text.trim() : ''
  if (!text) return failure('EMPTY_TEXT', '没有可翻译的文本')
  if (text.length > MAX_TEXT_CHARS) {
    return failure('TEXT_TOO_LONG', `一次最多翻译 ${MAX_TEXT_CHARS} 个字符，当前 ${text.length} 个`)
  }

  const provider = PROVIDERS.indexOf(source.provider) >= 0 ? source.provider : 'bing'
  const targetLanguage =
    typeof source.targetLanguage === 'string' && source.targetLanguage.trim()
      ? source.targetLanguage.trim()
      : 'zh-CN'

  const request = { text, targetLanguage, provider }
  if (PAID_PROVIDERS.has(provider)) {
    const sessionId = typeof source.sessionId === 'string' ? source.sessionId.trim() : ''
    if (!sessionId) {
      return failure('NO_SESSION', 'DeepSeek Flash 需要先打开一个会话（译文会记进该会话日志）')
    }
    request.sessionId = sessionId
  }

  const translator = resolveTranslator(ctx, request.sessionId)
  if (!translator) {
    return failure('NO_TRANSLATOR', '翻译服务没有就绪：重新打开应用，或到插件列表确认 translator 行已启用')
  }

  try {
    const spec = translator.resolve(request)
    const translated = await translator.translate(spec, signal)
    return { ok: true, text: translated, provider, targetLanguage }
  } catch (error) {
    const code = (error && error.code) || 'TRANSLATION_FAILED'
    const message = String((error && error.message) || error || '翻译失败')
    return failure(code, message)
  }
}

/** Which engines this profile can actually reach right now. Never throws. */
async function listProviders(ctx) {
  const translator = resolveTranslator(ctx, undefined)
  if (!translator) {
    return { ok: false, providers: [], code: 'NO_TRANSLATOR', diagnostics: scopeDiagnostics(ctx) }
  }
  try {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(4000)
        : undefined
    const providers = await translator.availableProviders(signal)
    return { ok: true, providers: Array.isArray(providers) ? providers.slice() : [] }
  } catch (error) {
    return { ok: true, providers: [], message: String((error && error.message) || error) }
  }
}

/* ── dictionary ──────────────────────────────────────────────────────── */

function firstOf(value) {
  if (Array.isArray(value)) return value[0]
  if (value && typeof value === 'object' && value['0'] !== undefined) return value['0']
  return value
}

function joinedText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((part) => typeof part === 'string').join(' ')
  return ''
}

/** Split "n. 环境…" into its part of speech and the rest. */
function splitSense(text) {
  const trimmed = String(text || '').trim()
  const match = /^([a-z]{1,6}\.)\s*(.*)$/i.exec(trimmed)
  if (match) return { pos: match[1].toLowerCase(), text: match[2] }
  return { pos: '', text: trimmed }
}

/** `return-phrase` arrives as a string or as `{ l: { i: "setting" } }`. */
function wordOf(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') return joinedText(value.l && value.l.i).trim()
  return ''
}

/**
 * Normalize one Youdao `jsonapi` payload into the card's shape. Pure, so the
 * parsers can be unit-tested without the network.
 */
export function parseDictionary(payload, fallbackWord) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const simple = source.simple && firstOf(source.simple.word)
  const ec = source.ec && firstOf(source.ec.word)

  const word =
    wordOf(ec && ec['return-phrase']) ||
    wordOf(simple && simple['return-phrase']) ||
    String(fallbackWord || '').trim()
  const uk = String((ec && ec.ukphone) || (simple && simple.ukphone) || '').trim()
  const us = String((ec && ec.usphone) || (simple && simple.usphone) || '').trim()

  const senses = []
  const trs = (ec && Array.isArray(ec.trs) && ec.trs) || []
  for (const entry of trs) {
    const parts = (entry && Array.isArray(entry.tr) && entry.tr) || []
    for (const part of parts) {
      const text = joinedText(part && part.l && part.l.i)
      if (!text) continue
      const sense = splitSense(text)
      if (sense.text) senses.push(sense)
    }
  }

  const web = []
  const webRoot = (source.web_trans && source.web_trans['web-translation']) || []
  const webEntry = Array.isArray(webRoot) ? webRoot[0] : webRoot
  const trans = (webEntry && Array.isArray(webEntry.trans) && webEntry.trans) || []
  for (const item of trans) {
    const value = String((item && item.value) || '').trim()
    if (value && web.indexOf(value) < 0) web.push(value)
  }

  return {
    ok: Boolean(word && (senses.length > 0 || web.length > 0)),
    word: word || String(fallbackWord || ''),
    phonetic: { uk, us },
    senses: senses.slice(0, 12),
    web: web.slice(0, 8),
    source: 'youdao',
  }
}

function upstreamSignal(signal, ms) {
  if (typeof AbortSignal === 'undefined') return signal
  const parts = []
  if (signal) parts.push(signal)
  if (typeof AbortSignal.timeout === 'function') parts.push(AbortSignal.timeout(ms))
  if (parts.length === 0) return undefined
  if (parts.length === 1) return parts[0]
  return typeof AbortSignal.any === 'function' ? AbortSignal.any(parts) : parts[0]
}

function validWord(raw) {
  const word = typeof raw === 'string' ? raw.trim() : ''
  if (!word || word.length > MAX_WORD_CHARS) return ''
  // One to three ASCII words: enough for "setting", "give up", "ice-cream".
  if (!/^[A-Za-z][A-Za-z'’.\- ]*$/.test(word)) return ''
  if (word.split(/\s+/).length > 3) return ''
  return word
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ')
}

/**
 * Bing's dictionary page carries the whole entry in one `meta description`:
 * `必应词典为您提供X的释义，美[..]，英[..]，n. ..； v. ..； 网络释义： ..；`
 * Pure, so it is unit-tested without the network.
 */
export function parseBingDictionary(html, fallbackWord) {
  const empty = { ok: false, word: String(fallbackWord || ''), phonetic: { uk: '', us: '' }, senses: [], web: [], source: 'bing' }
  const match = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(String(html || ''))
  if (!match) return empty

  const text = decodeEntities(match[1]).trim()
  const [rawHead, rawWeb] = text.split('网络释义：')
  let head = rawHead || ''

  const usMatch = /美\[([^\]]*)\]/.exec(head)
  const ukMatch = /英\[([^\]]*)\]/.exec(head)
  head = head.replace(/美\[[^\]]*\]/g, '').replace(/英\[[^\]]*\]/g, '')

  const wordMatch = /为您提供(.+?)的释义/.exec(head)
  const word = (wordMatch ? wordMatch[1] : '').trim() || String(fallbackWord || '')
  const bodyIndex = head.indexOf('的释义')
  if (bodyIndex >= 0) head = head.slice(bodyIndex + 3)
  head = head.replace(/^[，,\s]+/, '')

  const senses = []
  for (const raw of head.split('；')) {
    const item = raw.trim().replace(/^[，,\s]+/, '')
    if (!item) continue
    const posMatch = /^([a-z]{1,6}\.)\s*(.*)$/i.exec(item)
    if (posMatch) {
      senses.push({ pos: posMatch[1].toLowerCase(), text: posMatch[2].trim() })
    } else if (senses.length > 0) {
      senses[senses.length - 1].text = `${senses[senses.length - 1].text}；${item}`
    } else {
      senses.push({ pos: '', text: item })
    }
  }

  const web = []
  for (const raw of String(rawWeb || '').split('；')) {
    const value = raw.trim()
    if (value && web.indexOf(value) < 0) web.push(value)
  }

  return {
    ok: Boolean(word && (senses.length > 0 || web.length > 0)),
    word,
    phonetic: { uk: ukMatch ? ukMatch[1].trim() : '', us: usMatch ? usMatch[1].trim() : '' },
    senses: senses.slice(0, 12),
    web: web.slice(0, 8),
    source: 'bing',
  }
}

async function lookupFrom(source, word, signal) {
  const signalForLookup = upstreamSignal(signal, 8000)
  try {
    if (source === 'bing') {
      const response = await fetch(`${BING_DICT_ENDPOINT}${encodeURIComponent(word)}`, {
        headers: UPSTREAM_HEADERS,
        redirect: 'follow',
        signal: signalForLookup,
      })
      if (!response.ok) return failure('DICT_UNAVAILABLE', `必应词典返回 ${response.status}`)
      const entry = parseBingDictionary(await response.text(), word)
      return entry.ok ? entry : failure('DICT_MISS', '必应词典里没有这个词条')
    }
    const response = await fetch(`${DICT_ENDPOINT}${encodeURIComponent(word)}`, {
      headers: UPSTREAM_HEADERS,
      redirect: 'follow',
      signal: signalForLookup,
    })
    if (!response.ok) return failure('DICT_UNAVAILABLE', `有道词典返回 ${response.status}`)
    const entry = parseDictionary(await response.json(), word)
    return entry.ok ? entry : failure('DICT_MISS', '有道词典里没有这个词条')
  } catch (error) {
    return failure('DICT_UNAVAILABLE', String((error && error.message) || error))
  }
}

/** Look one word up. Never throws; an unreachable dictionary is a normal miss. */
export async function lookupWord(word, signal, source) {
  const clean = validWord(word)
  if (!clean) return failure('BAD_WORD', '只对单个英文单词（或两三个词的短语）查词典')

  const order = source === 'bing' ? ['bing'] : source === 'auto' ? ['youdao', 'bing'] : ['youdao']
  let last = null
  for (const from of order) {
    const entry = await lookupFrom(from, clean, signal)
    if (entry.ok) return entry
    last = entry
  }
  return last || failure('DICT_MISS', '词典里没有这个词条')
}

/** Fetch pronunciation bytes. Returns `{ status, type, bytes }` or a failure. */
export async function fetchAudio(word, accent, signal) {
  const clean = validWord(word)
  if (!clean) return { ok: false, status: 400, ...failure('BAD_WORD', '没有可朗读的单词') }
  const type = accent === 'uk' ? '1' : '2'
  try {
    const response = await fetch(`${AUDIO_ENDPOINT}${encodeURIComponent(clean)}&type=${type}`, {
      headers: UPSTREAM_HEADERS,
      signal: upstreamSignal(signal, 8000),
    })
    if (!response.ok) return { ok: false, status: 502, ...failure('AUDIO_UNAVAILABLE', `朗读返回 ${response.status}`) }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length === 0) return { ok: false, status: 502, ...failure('AUDIO_UNAVAILABLE', '朗读内容为空') }
    return { ok: true, status: 200, type: response.headers.get('content-type') || 'audio/mpeg', bytes }
  } catch (error) {
    return { ok: false, status: 502, ...failure('AUDIO_UNAVAILABLE', String((error && error.message) || error)) }
  }
}

/* ── transport glue ──────────────────────────────────────────────────── */

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function readBody(stream) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseJson(text) {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch (error) {
    return null
  }
}

const ROUTES = [
  {
    path: '/translate',
    methods: ['POST'],
    async serve(ctx, request) {
      const body = await request.json().catch(() => null)
      if (body === null) return jsonResponse(failure('BAD_REQUEST', '请求体不是合法 JSON'), 400)
      return jsonResponse(await translate(ctx, body, request.signal))
    },
    async serveNode(ctx, request) {
      const body = parseJson(await readBody(request))
      if (body === null) return { status: 400, payload: failure('BAD_REQUEST', '请求体不是合法 JSON') }
      return { status: 200, payload: await translate(ctx, body, undefined) }
    },
  },
  {
    path: '/providers',
    methods: ['GET'],
    async serve(ctx) {
      return jsonResponse(await listProviders(ctx))
    },
    async serveNode(ctx) {
      return { status: 200, payload: await listProviders(ctx) }
    },
  },
  {
    path: '/dict',
    methods: ['GET'],
    async serve(ctx, request) {
      const url = new URL(request.url)
      const word = url.searchParams.get('word') || ''
      return jsonResponse(await lookupWord(word, request.signal, url.searchParams.get('source') || 'youdao'))
    },
    async serveNode(ctx, request) {
      const url = new URL(request.url, 'http://127.0.0.1')
      const word = url.searchParams.get('word') || ''
      return { status: 200, payload: await lookupWord(word, undefined, url.searchParams.get('source') || 'youdao') }
    },
  },
  {
    path: '/audio',
    methods: ['GET'],
    async serve(ctx, request) {
      const url = new URL(request.url)
      const audio = await fetchAudio(url.searchParams.get('word') || '', url.searchParams.get('accent'), request.signal)
      if (!audio.ok) return jsonResponse({ code: audio.code, message: audio.message }, 502)
      return new Response(audio.bytes, {
        status: 200,
        headers: { 'content-type': audio.type, 'cache-control': 'public, max-age=86400' },
      })
    },
    async serveNode(ctx, request) {
      const url = new URL(request.url, 'http://127.0.0.1')
      const audio = await fetchAudio(url.searchParams.get('word') || '', url.searchParams.get('accent'), undefined)
      if (!audio.ok) return { status: 502, payload: { code: audio.code, message: audio.message } }
      return { status: 200, audio }
    },
  },
]

export function apply(ctx) {
  const disposers = []
  let connection = null

  const finish = () => {
    for (const dispose of disposers) {
      try {
        const result = dispose()
        if (result && typeof result.then === 'function') result.catch(() => {})
      } catch (error) {
        /* already gone */
      }
    }
    disposers.length = 0
  }

  /*
   * A service is only visible to a context that declared it: from dsh
   * 0.2.1-rc.5 on, `ctx.get('connection')` / `ctx.get('webServer')` on an
   * undeclared context return null, so the old read-then-register shape
   * registered neither transport and every browser call fell through to
   * "宿主半没有应答". Inject the service first, then read it.
   */
  ctx.inject(['connection'], (injected) => {
    connection = injected.connection
    const fetchRegistry = connection && connection.fetch
    if (!fetchRegistry || typeof fetchRegistry.register !== 'function') return
    for (const route of ROUTES) {
      disposers.push(
        fetchRegistry.register({
          path: `${API_PREFIX}${route.path}`,
          methods: route.methods,
          requestBody: 'buffered',
          fetch: (request) => route.serve(ctx, request),
        }),
      )
    }
  })

  ctx.inject(['webServer'], (injected) => {
    const webServer = injected.webServer
    if (!webServer || typeof webServer.register !== 'function') return
    const guarded = (request) => {
      if (typeof connection?.requestRejection === 'function') {
        try {
          return connection.requestRejection(request) !== undefined
        } catch (error) {
          return true
        }
      }
      return false
    }
    const reject = (res, status = 403) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('forbidden')
    }

    for (const route of ROUTES) {
      disposers.push(
        webServer.register({
          kind: 'exact',
          path: `${FALLBACK_PREFIX}${route.path}`,
          handler: (req, res) => {
            if (route.methods.indexOf(req.method) < 0) {
              res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('method not allowed')
              return
            }
            if (guarded(req)) return reject(res)
            route
              .serveNode(ctx, req)
              .then((result) => {
                if (result.audio) {
                  res.writeHead(200, {
                    'content-type': result.audio.type,
                    'cache-control': 'public, max-age=86400',
                  })
                  res.end(Buffer.from(result.audio.bytes))
                  return
                }
                res.writeHead(result.status, {
                  'content-type': 'application/json; charset=utf-8',
                  'cache-control': 'no-store',
                })
                res.end(JSON.stringify(result.payload))
              })
              .catch((error) => {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify(failure('HOST_FAILED', String((error && error.message) || error))))
              })
          },
        }),
      )
    }
  })

  ctx.effect(() => finish, 'smart-selection-translate: host routes')
}
