import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, parseDictionary, parseBingDictionary, lookupWord } from '../index.js'

function makeTranslator(tag, options = {}) {
  const calls = []
  return {
    calls,
    resolve(request) {
      calls.push(['resolve', request])
      if (options.resolveThrows) throw options.resolveThrows
      return { ...request, spec: true }
    },
    async translate(spec, signal) {
      calls.push(['translate', spec, signal])
      if (options.translateThrows) throw options.translateThrows
      return `${tag}:${spec.text}`
    },
    async availableProviders() {
      if (options.providersThrows) throw options.providersThrows
      return ['bing', 'google']
    },
  }
}

/**
 * `agents` maps to live Agents: a root plugin never sees `translator` directly, it
 * reaches the service through `agent.ctx`, exactly like the real composition.
 */
function createHost(options = {}) {
  const routes = []
  const effects = []

  const rootTranslator = 'rootTranslator' in options ? options.rootTranslator : makeTranslator('译文')
  const calls = rootTranslator ? rootTranslator.calls : []

  const agentRecords = (options.agents || []).map((entry) => ({
    id: entry.id,
    agent: {
      id: entry.id,
      ctx: { get: (name) => (name === 'translator' ? entry.translator : undefined) },
    },
  }))
  const agentsService =
    options.agents === undefined
      ? null
      : {
          list: () => agentRecords.map((record) => record.agent),
          get: (id) => (agentRecords.filter((record) => record.id === id)[0] || {}).agent,
        }

  const connection =
    options.connection === undefined
      ? { fetch: { register(route) { routes.push(route); return () => {} } } }
      : options.connection

  const ctx = {
    get(name) {
      if (name === 'translator') return rootTranslator
      if (name === 'agents') return agentsService
      if (name === 'connection') return connection
      if (name === 'webServer') return options.webServer
      return undefined
    },
    effect(callback) {
      effects.push(callback)
      return () => {}
    },
  }

  return { ctx, routes, effects, calls }
}

async function post(route, payload, signal) {
  const request = new Request('http://127.0.0.1/api/smart-selection-translate/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    signal,
  })
  const response = await route.fetch(request)
  return { status: response.status, body: await response.json() }
}

async function getProviders(route) {
  const response = await route.fetch(new Request('http://127.0.0.1/api/smart-selection-translate/providers'))
  return response.json()
}

test('registers the fenced translate, providers, dict and audio routes', () => {
  const host = createHost()
  apply(host.ctx)
  assert.equal(host.routes.length, 4)
  assert.deepEqual(host.routes.map((route) => route.path), [
    '/api/smart-selection-translate/translate',
    '/api/smart-selection-translate/providers',
    '/api/smart-selection-translate/dict',
    '/api/smart-selection-translate/audio',
  ])
  assert.deepEqual(host.routes[0].methods, ['POST'])
  assert.deepEqual(host.routes[1].methods, ['GET'])
  assert.deepEqual(host.routes[2].methods, ['GET'])
  assert.deepEqual(host.routes[3].methods, ['GET'])
})

test('translates a valid anonymous request', async () => {
  const host = createHost()
  apply(host.ctx)
  const { status, body } = await post(host.routes[0], { text: '  hello world  ', provider: 'bing', targetLanguage: 'zh-CN' })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.text, '译文:hello world')
  assert.equal(body.provider, 'bing')
  const resolveCall = host.calls.find(([name]) => name === 'resolve')
  assert.deepEqual(resolveCall[1], { text: 'hello world', targetLanguage: 'zh-CN', provider: 'bing' })
})

test('rejects empty text', async () => {
  const host = createHost()
  apply(host.ctx)
  const { body } = await post(host.routes[0], { text: '   ' })
  assert.equal(body.ok, false)
  assert.equal(body.code, 'EMPTY_TEXT')
})

test('rejects oversized text before touching the translator', async () => {
  const host = createHost()
  apply(host.ctx)
  const { body } = await post(host.routes[0], { text: 'a'.repeat(4001) })
  assert.equal(body.ok, false)
  assert.equal(body.code, 'TEXT_TOO_LONG')
  assert.equal(host.calls.length, 0)
})

test('falls back to bing for an unknown provider', async () => {
  const host = createHost()
  apply(host.ctx)
  const { body } = await post(host.routes[0], { text: 'hi', provider: 'evil-endpoint' })
  assert.equal(body.ok, true)
  assert.equal(body.provider, 'bing')
})

test('paid providers require a session id', async () => {
  const host = createHost()
  apply(host.ctx)
  const missing = await post(host.routes[0], { text: 'hi', provider: 'deepseek-account' })
  assert.equal(missing.body.ok, false)
  assert.equal(missing.body.code, 'NO_SESSION')

  const provided = await post(host.routes[0], { text: 'hi', provider: 'deepseek-account', sessionId: 'sess-1' })
  assert.equal(provided.body.ok, true)
  const resolveCall = host.calls.filter(([name]) => name === 'resolve').pop()
  assert.deepEqual(resolveCall[1], { text: 'hi', targetLanguage: 'zh-CN', provider: 'deepseek-account', sessionId: 'sess-1' })
})

test('anonymous providers never forward a session id', async () => {
  const host = createHost()
  apply(host.ctx)
  await post(host.routes[0], { text: 'hi', provider: 'google', sessionId: 'sess-1' })
  const resolveCall = host.calls.find(([name]) => name === 'resolve')
  assert.equal('sessionId' in resolveCall[1], false)
})

test('reaches the service through a live Agent when the root has none', async () => {
  const scoped = makeTranslator('会话')
  const host = createHost({ rootTranslator: null, agents: [{ id: 'sess-1', translator: scoped }] })
  apply(host.ctx)
  const { body } = await post(host.routes[0], { text: 'hi' })
  assert.equal(body.ok, true)
  assert.equal(body.text, '会话:hi')
  assert.equal(scoped.calls.filter(([name]) => name === 'translate').length, 1)
})

test('prefers the Agent owning the paid session', async () => {
  const first = makeTranslator('A')
  const second = makeTranslator('B')
  const host = createHost({
    rootTranslator: null,
    agents: [
      { id: 'sess-1', translator: first },
      { id: 'sess-2', translator: second },
    ],
  })
  apply(host.ctx)
  const { body } = await post(host.routes[0], { text: 'hi', provider: 'deepseek-account', sessionId: 'sess-2' })
  assert.equal(body.ok, true)
  assert.equal(body.text, 'B:hi')
  assert.equal(first.calls.length, 0)
})

test('uses the first live Agent for an anonymous request', async () => {
  const first = makeTranslator('A')
  const second = makeTranslator('B')
  const host = createHost({
    rootTranslator: null,
    agents: [
      { id: 'sess-1', translator: first },
      { id: 'sess-2', translator: second },
    ],
  })
  apply(host.ctx)
  const { body } = await post(host.routes[0], { text: 'hi' })
  assert.equal(body.text, 'A:hi')
  assert.equal(second.calls.length, 0)
})

test('reports a missing translation service instead of throwing', async () => {
  const host = createHost({ rootTranslator: null })
  apply(host.ctx)
  const { status, body } = await post(host.routes[0], { text: 'hi' })
  assert.equal(status, 200)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'NO_TRANSLATOR')
})

test('maps a service failure to its own code', async () => {
  const error = Object.assign(new Error('deadline exceeded'), { code: 'TRANSLATION_TIMEOUT' })
  const host = createHost({ rootTranslator: makeTranslator('译文', { translateThrows: error }) })
  apply(host.ctx)
  const { body } = await post(host.routes[0], { text: 'hi' })
  assert.equal(body.ok, false)
  assert.equal(body.code, 'TRANSLATION_TIMEOUT')
  assert.equal(body.message, 'deadline exceeded')
})

test('answers 400 for a malformed body', async () => {
  const host = createHost()
  apply(host.ctx)
  const { status, body } = await post(host.routes[0], '{oops')
  assert.equal(status, 400)
  assert.equal(body.code, 'BAD_REQUEST')
})

test('forwards the caller signal so cancellation reaches the service', async () => {
  const host = createHost()
  apply(host.ctx)
  const controller = new AbortController()
  await post(host.routes[0], { text: 'hi' }, controller.signal)
  const translateCall = host.calls.find(([name]) => name === 'translate')
  assert.ok(translateCall[2] instanceof AbortSignal)
})

test('lists providers', async () => {
  const host = createHost()
  apply(host.ctx)
  const body = await getProviders(host.routes[1])
  assert.equal(body.ok, true)
  assert.deepEqual(body.providers, ['bing', 'google'])
})

test('provider discovery failure degrades to an empty list', async () => {
  const host = createHost({ rootTranslator: makeTranslator('译文', { providersThrows: new Error('boom') }) })
  apply(host.ctx)
  const body = await getProviders(host.routes[1])
  assert.equal(body.ok, true)
  assert.deepEqual(body.providers, [])
})

test('provider discovery reports scope diagnostics when unreachable', async () => {
  const host = createHost({ rootTranslator: null })
  apply(host.ctx)
  const body = await getProviders(host.routes[1])
  assert.equal(body.ok, false)
  assert.equal(body.code, 'NO_TRANSLATOR')
  assert.deepEqual(body.diagnostics, { root: false, liveAgents: 0, scoped: 0 })
})

test('falls back to exact webServer routes when no connection is present', () => {
  const registered = []
  const webServer = { register(route) { registered.push(route); return () => {} } }
  const host = createHost({ connection: null, webServer })
  apply(host.ctx)
  assert.equal(registered.length, 4)
  assert.deepEqual(registered.map((route) => route.path), [
    '/plugins/smart-selection-translate/translate',
    '/plugins/smart-selection-translate/providers',
    '/plugins/smart-selection-translate/dict',
    '/plugins/smart-selection-translate/audio',
  ])
  assert.equal(registered[0].kind, 'exact')
})

test('the effect disposer releases every registered route', () => {
  const disposed = []
  const host = createHost({
    connection: {
      fetch: {
        register() {
          return () => disposed.push('route')
        },
      },
    },
  })
  apply(host.ctx)
  assert.equal(host.effects.length, 1)
  const disposer = host.effects[0]()
  disposer()
  assert.deepEqual(disposed, ['route', 'route', 'route', 'route'])
})

/* ── dictionary normalization ─────────────────────────────────────────── */

const YD_FIXTURE = {
  simple: { word: [{ usphone: 'ˈsetɪŋ', ukphone: 'ˈsetɪŋ', 'return-phrase': 'setting' }] },
  ec: {
    word: [
      {
        'return-phrase': 'setting',
        ukphone: 'ˈsetɪŋ',
        usphone: 'ˈsetɪŋ',
        trs: [
          { tr: [{ l: { i: ['n. （某事发生的）环境，场合；（戏剧的）场景'] } }] },
          { tr: [{ l: { i: ['v. （小心地）放置；嵌入（表面）'] } }] },
        ],
      },
    ],
  },
  web_trans: {
    'web-translation': [{ trans: [{ value: '设置' }, { value: '设定' }, { value: '设置' }, { value: '背景' }] }],
  },
}

test('normalizes a Youdao entry into phones, senses and web meanings', () => {
  const entry = parseDictionary(YD_FIXTURE, 'setting')
  assert.equal(entry.ok, true)
  assert.equal(entry.word, 'setting')
  assert.deepEqual(entry.phonetic, { uk: 'ˈsetɪŋ', us: 'ˈsetɪŋ' })
  assert.deepEqual(entry.senses, [
    { pos: 'n.', text: '（某事发生的）环境，场合；（戏剧的）场景' },
    { pos: 'v.', text: '（小心地）放置；嵌入（表面）' },
  ])
  assert.deepEqual(entry.web, ['设置', '设定', '背景'])
  assert.equal(entry.source, 'youdao')
})

test('accepts the numeric-key word shape and array sense text', () => {
  const entry = parseDictionary(
    {
      ec: { word: { 0: { 'return-phrase': 'run', trs: [{ tr: [{ l: { i: ['n.', '跑；奔跑'] } }] }] } } },
    },
    'run',
  )
  assert.equal(entry.word, 'run')
  assert.deepEqual(entry.senses, [{ pos: 'n.', text: '跑；奔跑' }])
})

test('a sense without a part of speech keeps its text', () => {
  const entry = parseDictionary({ ec: { word: [{ 'return-phrase': 'x', trs: [{ tr: [{ l: { i: ['随便一句'] } }] }] }] } }, 'x')
  assert.deepEqual(entry.senses, [{ pos: '', text: '随便一句' }])
})

test('an empty payload is not a hit', () => {
  const entry = parseDictionary({}, 'setting')
  assert.equal(entry.ok, false)
  assert.equal(entry.word, 'setting')
})

test('rejects text that is not a word before any request', async () => {
  const phrase = await lookupWord('this is not a word')
  assert.equal(phrase.ok, false)
  assert.equal(phrase.code, 'BAD_WORD')

  const digits = await lookupWord('12345')
  assert.equal(digits.ok, false)
  assert.equal(digits.code, 'BAD_WORD')

  const empty = await lookupWord('   ')
  assert.equal(empty.ok, false)
  assert.equal(empty.code, 'BAD_WORD')
})

/* ── Bing dictionary normalization ────────────────────────────────────── */

const BING_HTML =
  '<html><head><meta name="description" content="必应词典为您提供record的释义，美[&#39;rekərd]，英[&#39;rekɔːrd]，n. 记录；唱片；记载；经历； v. 记录；录制；记载；录（音）； 网络释义： 纪录；战绩；录音； " /></head></html>'

test('parses a Bing dictionary page into phones, grouped senses and web meanings', () => {
  const entry = parseBingDictionary(BING_HTML, 'record')
  assert.equal(entry.ok, true)
  assert.equal(entry.word, 'record')
  assert.equal(entry.source, 'bing')
  assert.deepEqual(entry.phonetic, { uk: "'rekɔːrd", us: "'rekərd" })
  assert.deepEqual(entry.senses, [
    { pos: 'n.', text: '记录；唱片；记载；经历' },
    { pos: 'v.', text: '记录；录制；记载；录（音）' },
  ])
  assert.deepEqual(entry.web, ['纪录', '战绩', '录音'])
})

test('a page without the description meta is not a hit', () => {
  const entry = parseBingDictionary('<html><body>nothing</body></html>', 'record')
  assert.equal(entry.ok, false)
  assert.equal(entry.word, 'record')
})

test('a phrase without IPA still yields senses', () => {
  const html = '<meta name="description" content="必应词典为您提供give up的释义，na. 放弃；断绝； 网络释义： 停止；抛弃；" />'
  const entry = parseBingDictionary(html, 'give up')
  assert.equal(entry.word, 'give up')
  assert.deepEqual(entry.senses, [{ pos: 'na.', text: '放弃；断绝' }])
  assert.deepEqual(entry.phonetic, { uk: '', us: '' })
  assert.deepEqual(entry.web, ['停止', '抛弃'])
})
