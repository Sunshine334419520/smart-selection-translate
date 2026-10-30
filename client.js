/*
 * smart-selection-translate — browser half.
 *
 * One document-level double-click listener covers the conversation text and the
 * right-sidebar document preview, because both are ordinary DOM text in this page.
 * The card floats in `shell.overlay` and asks the Host half for either a dictionary
 * entry (single word) or a machine translation (anything longer).
 */

window.__ModuleLoader__.load({
  id: '@local/smart-selection-translate',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const STORAGE_KEY = 'dsh.smart-selection-translate.v1'
    const API_BASE = '/api/smart-selection-translate'
    const FALLBACK_BASE = '/plugins/smart-selection-translate'
    const MAX_TEXT = 4000
    const MAX_WORD = 48
    const STYLE_ID = 'sst-style'

    const ENGINES = [
      { id: 'bing', label: 'Bing' },
      { id: 'google', label: 'Google' },
      { id: 'deepseek-account', label: 'DeepSeek Flash · 账号' },
      { id: 'deepseek-official', label: 'DeepSeek Flash · API Key' },
    ]
    const TARGETS = [
      { id: 'zh-CN', label: '简体中文' },
      { id: 'zh-TW', label: '繁體中文' },
      { id: 'en', label: 'English' },
      { id: 'ja', label: '日本語' },
      { id: 'ko', label: '한국어' },
    ]
    const DEFAULTS = {
      enabled: true,
      trigger: 'dblclick',
      provider: 'bing',
      targetLanguage: 'zh-CN',
      englishOnly: true,
      dictionary: true,
      dictSource: 'youdao',
    }

    const COPY = {
      zh: {
        sectionTitle: '智能划词翻译',
        sectionHint: '单词查有道词典，句子走机器翻译。PDF 与 Office 预览画在画布上，取不到文字层，暂不支持划词。',
        enabled: '启用划词翻译',
        enabledHint: '选中英文即翻译；双击单词等于选中它。',
        trigger: '触发方式',
        triggerDirect: '选中即翻译',
        triggerButton: '选中后显示按钮',
        triggerHint: '「选中即翻译」在松开鼠标时直接请求；后者先弹一个「翻译」按钮。',
        dictionary: '单词查词典',
        dictionaryHint: '词条来自有道词典（音标 + 词性 + 网络释义 + 真人发音），与下面的翻译引擎无关；关掉则单词也走机器翻译。',
        engine: '机器翻译引擎',
        engineHint: '只作用于句子和段落；单词走上面的词典，不受这里影响。匿名引擎免账号；DeepSeek Flash 走当前会话记账。',
        target: '译文语言',
        englishOnly: '只翻英文',
        englishOnlyHint: '选区里英文不比中日韩文字多时跳过。',
        unavailable: '当前不可用',
        checkFailed: '无法读取引擎状态',
        original: '原文',
        result: '译文',
        loading: '翻译中…',
        loadingDict: '查词典…',
        translate: '翻译',
        cancel: '取消',
        retry: '重试',
        copy: '复制',
        copied: '已复制',
        speak: '朗读',
        close: '关闭',
        network: '网络',
        meaning: '释义',
        entryPrefix: '词条',
        sourceYoudao: '有道词典',
        sourceBing: '必应词典',
        dictSourceRow: '词典源',
        dictSourceHint: '单词查哪本词典；选「自动」时先有道、查不到再必应，都查不到则回落机器翻译。',
        sourceAuto: '自动',
        dictFailed: '词典没有收录，下面按机器翻译',
      },
      en: {
        sectionTitle: 'Smart Selection Translate',
        sectionHint: 'Single words get a dictionary entry; longer text is machine translated. PDF and Office previews paint to a canvas without a text layer, so selection translate does not work there.',
        enabled: 'Enable selection translate',
        enabledHint: 'Select English and it translates; double-clicking a word selects it.',
        trigger: 'Trigger',
        triggerDirect: 'Translate on select',
        triggerButton: 'Show a button first',
        triggerHint: 'The first sends the request on mouse-up; the second shows a Translate button first.',
        dictionary: 'Dictionary for single words',
        dictionaryHint: 'Entries come from Youdao (IPA, senses, web meanings, pronunciation) and are independent of the engine below; off means words are machine translated too.',
        engine: 'Machine translation engine',
        engineHint: 'Applies to sentences and phrases only; single words use the dictionary above. Anonymous engines need no account; DeepSeek Flash bills through the current session.',
        target: 'Target language',
        englishOnly: 'English only',
        englishOnlyHint: 'Skips a selection that is mostly CJK text.',
        unavailable: 'Unavailable now',
        checkFailed: 'Cannot read engine status',
        original: 'Original',
        result: 'Translation',
        loading: 'Translating…',
        loadingDict: 'Looking up…',
        translate: 'Translate',
        cancel: 'Cancel',
        retry: 'Retry',
        copy: 'Copy',
        copied: 'Copied',
        speak: 'Read aloud',
        close: 'Close',
        network: 'Web',
        meaning: 'Senses',
        entryPrefix: 'Entry',
        sourceYoudao: 'Youdao',
        sourceBing: 'Bing',
        dictSourceRow: 'Dictionary source',
        dictSourceHint: 'Which dictionary single words use; Auto tries Youdao then Bing, and machine translation covers a miss.',
        sourceAuto: 'Auto',
        dictFailed: 'Not in the dictionary; machine translation below',
      },
    }

    /* ── settings: module store, persisted per browser ───────────────────── */

    let settings = { ...DEFAULTS }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) settings = { ...DEFAULTS, ...JSON.parse(raw) }
    } catch (error) {
      /* storage unavailable: defaults are fine */
    }
    const settingsListeners = new Set()

    function updateSettings(patch) {
      settings = { ...settings, ...patch }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      } catch (error) {
        /* ignore */
      }
      for (const listener of [...settingsListeners]) {
        try {
          listener()
        } catch (error) {
          /* ignore */
        }
      }
    }

    function useSettings() {
      const [, bump] = useState(0)
      useEffect(() => {
        const listener = () => bump((value) => value + 1)
        settingsListeners.add(listener)
        return () => settingsListeners.delete(listener)
      }, [])
      return settings
    }

    function isZhUI() {
      try {
        return String(navigator.language || '').toLowerCase().indexOf('zh') === 0
      } catch (error) {
        return false
      }
    }

    function t(key) {
      const dict = isZhUI() ? COPY.zh : COPY.en
      return dict[key] || COPY.en[key] || key
    }

    /* ── text picking ───────────────────────────────────────────────────── */

    function isEnglishLike(text) {
      const latin = (text.match(/[A-Za-z]/g) || []).length
      if (latin === 0) return false
      const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length
      return latin >= cjk
    }

    /** A short English phrase (up to three words) is also worth a dictionary lookup. */
    function lookupPhrase(text) {
      const trimmed = String(text || '')
        .replace(/[.!?。！？,;:]+$/, '')
        .trim()
      if (!trimmed || trimmed.length > MAX_WORD) return ''
      if (!/^[A-Za-z][A-Za-z'’ .\-]*$/.test(trimmed)) return ''
      if (trimmed.split(/\s+/).length > 3) return ''
      return trimmed
    }

    /** Read text aloud with the system voice; the word route prefers native audio. */
    function speak(text, lang) {
      try {
        if (!window.speechSynthesis) return
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(String(text || ''))
        utterance.lang = lang || 'en-US'
        utterance.rate = 1
        window.speechSynthesis.speak(utterance)
      } catch (error) {
        /* speech is best effort */
      }
    }

    function shouldIgnore(target) {
      if (!target || target.nodeType !== 1) return true
      if (typeof target.closest === 'function' && target.closest('[data-sst]')) return true
      const tag = String(target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option') return true
      if (target.isContentEditable) return true
      if (typeof target.closest === 'function' && target.closest('[contenteditable="true"]')) return true
      return false
    }

    function wordAt(x, y) {
      let node = null
      let offset = 0
      try {
        if (typeof document.caretRangeFromPoint === 'function') {
          const range = document.caretRangeFromPoint(x, y)
          if (range) {
            node = range.startContainer
            offset = range.startOffset
          }
        } else if (typeof document.caretPositionFromPoint === 'function') {
          const position = document.caretPositionFromPoint(x, y)
          if (position) {
            node = position.offsetNode
            offset = position.offset
          }
        }
      } catch (error) {
        return null
      }
      if (!node || node.nodeType !== 3) return null
      const data = String(node.data || '')
      if (!data) return null
      const isWordChar = (ch) => /[A-Za-z0-9_'\u2019-]/.test(ch)
      let start = offset
      let end = offset
      while (start > 0 && isWordChar(data.charAt(start - 1))) start -= 1
      while (end < data.length && isWordChar(data.charAt(end))) end += 1
      if (end <= start) return null
      const text = data.slice(start, end).trim()
      if (!text) return null
      try {
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)
        return { text: text.slice(0, MAX_TEXT), rect: range.getBoundingClientRect() }
      } catch (error) {
        return null
      }
    }

    /** The current non-collapsed selection, or null. */
    function readSelection() {
      try {
        const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
        const text = String(selection.toString() || '').replace(/\s+/g, ' ').trim()
        if (!text) return null
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (!rect || (!rect.width && !rect.height && !rect.left && !rect.top)) {
          const client = range.getClientRects && range.getClientRects()[0]
          return { text: text.slice(0, MAX_TEXT), rect: client || rect }
        }
        return { text: text.slice(0, MAX_TEXT), rect }
      } catch (error) {
        return null
      }
    }

    /** True when the selection sits inside an input, an editor, or our own card. */
    function selectionIgnored(selection) {
      const anchor = selection && selection.anchorNode
      const element = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement)
      if (!element) return true
      return shouldIgnore(element)
    }

    /* ── host calls ─────────────────────────────────────────────────────── */

    let currentSessionId = ''
    let resolvedBase = ''
    let lastAudio = null

    async function callHost(path, init) {
      const bases = resolvedBase ? [resolvedBase] : [API_BASE, FALLBACK_BASE]
      let lastError = null
      for (const base of bases) {
        try {
          const response = await fetch(base + path, init)
          const body = await response.text()
          let payload = null
          try {
            payload = JSON.parse(body)
          } catch (error) {
            payload = null
          }
          if (!payload || typeof payload !== 'object') {
            lastError = new Error('宿主半没有应答（插件可能未加载完成）')
            continue
          }
          resolvedBase = base
          return payload
        } catch (error) {
          lastError = error
        }
      }
      throw lastError || new Error('翻译接口不可达')
    }

    async function translateRequest(text, signal) {
      const payload = {
        text,
        provider: settings.provider,
        targetLanguage: settings.targetLanguage,
      }
      if (String(settings.provider).indexOf('deepseek-') === 0 && currentSessionId) {
        payload.sessionId = currentSessionId
      }
      const answer = await callHost('/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      if (!answer || !answer.ok) {
        const error = new Error((answer && answer.message) || (answer && answer.code) || '翻译失败')
        error.code = answer && answer.code
        throw error
      }
      return String(answer.text || '').trim()
    }

    async function dictRequest(word, signal) {
      const source = settings.dictSource || 'youdao'
      const answer = await callHost(`/dict?word=${encodeURIComponent(word)}&source=${encodeURIComponent(source)}`, { method: 'GET', signal })
      return answer && answer.ok ? answer : null
    }

    async function fetchProviders() {
      const answer = await callHost('/providers', { method: 'GET' })
      return Array.isArray(answer && answer.providers) ? answer.providers : []
    }

    function audioUrl(word, accent) {
      const base = resolvedBase || API_BASE
      return `${base}/audio?word=${encodeURIComponent(word)}&accent=${accent}`
    }

    function playAudio(word, accent) {
      try {
        const audio = new Audio(audioUrl(word, accent))
        lastAudio = audio
        const result = audio.play()
        if (result && typeof result.catch === 'function') {
          result.catch(() => speak(word, accent === 'uk' ? 'en-GB' : 'en-US'))
        }
      } catch (error) {
        speak(word, accent === 'uk' ? 'en-GB' : 'en-US')
      }
    }

    function dictToText(entry) {
      const lines = [entry.word]
      const uk = entry.phonetic && entry.phonetic.uk
      const us = entry.phonetic && entry.phonetic.us
      if (uk || us) {
        const parts = []
        if (uk) parts.push(`英 /${uk}/`)
        if (us) parts.push(`美 /${us}/`)
        lines.push(parts.join('  '))
      }
      for (const sense of entry.senses || []) {
        lines.push(`${sense.pos ? `${sense.pos} ` : ''}${sense.text}`)
      }
      if (entry.web && entry.web.length) lines.push(`${t('network')}: ${entry.web.join('；')}`)
      return lines.join('\n')
    }

    /* ── styles ─────────────────────────────────────────────────────────── */

    const CSS = [
      '[data-sst] .sst-btn{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:inherit}',
      '[data-sst] .sst-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '[data-sst] .sst-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}',
      '[data-sst] .sst-btn-primary:hover{background:var(--dsw-alias-brand-primary);filter:brightness(1.08)}',
      '[data-sst] .sst-icon{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;padding:4px 6px;border-radius:4px;cursor:pointer;font-family:inherit}',
      '[data-sst] .sst-icon:hover{background:var(--dsw-alias-bg-layer-2)}',
      '[data-sst] .sst-speak{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:2px 8px;border-radius:999px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:4px}',
      '[data-sst] .sst-speak:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '[data-sst] .sst-select{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;padding:3px 8px;border-radius:6px;font-family:inherit;cursor:pointer}',
      '.sst-switch{border-radius:999px !important;appearance:none;-webkit-appearance:none}',
      '.sst-knob{border-radius:999px !important;background:var(--dsw-alias-bg-base)}',
      '[data-sst] .sst-body{user-select:text;-webkit-user-select:text}',
    ].join('\n')

    function installStyles() {
      try {
        if (document.getElementById(STYLE_ID)) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        if (document.head) document.head.appendChild(style)
      } catch (error) {
        /* styling is cosmetic */
      }
    }

    /* ── geometry ───────────────────────────────────────────────────────── */

    function anchorGeometry(rect) {
      const width = Math.min(420, Math.max(280, window.innerWidth - 40))
      const margin = 12
      const safe =
        rect && (rect.width || rect.height || rect.left || rect.top)
          ? rect
          : { left: window.innerWidth / 2, right: window.innerWidth / 2, top: window.innerHeight / 2, bottom: window.innerHeight / 2 }
      const left = Math.round(Math.min(Math.max(margin, safe.left), window.innerWidth - width - margin))
      let top = Math.round(safe.bottom + 8)
      const estimated = 190
      if (top + estimated > window.innerHeight - margin) {
        top = Math.round(Math.max(margin, safe.top - estimated - 8))
      }
      return { left, top, width }
    }

    /* ── overlay card ───────────────────────────────────────────────────── */

    function Phonetic(props) {
      const phonetic = props.entry.phonetic || {}
      const ipa = props.accent === 'uk' ? phonetic.uk : phonetic.us
      if (!ipa) return null
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, props.accent === 'uk' ? '英' : '美'),
        h('button', {
          type: 'button',
          className: 'sst-speak',
          title: props.accent === 'uk' ? '英式发音' : '美式发音',
          onClick: () => playAudio(props.entry.word, props.accent),
        }, '🔊', `/${ipa}/`),
      )
    }

    function TranslatorOverlay() {
      useSettings()
      const [card, setCard] = useState(null)
      const [copied, setCopied] = useState(false)
      const controllerRef = useRef(null)
      const settingsRef = useRef(settings)
      const lastHandledRef = useRef({ key: '', at: 0 })
      settingsRef.current = settings

      const closeCard = useCallback(() => {
        const controller = controllerRef.current
        controllerRef.current = null
        if (controller) {
          try {
            controller.abort()
          } catch (error) {
            /* ignore */
          }
        }
        setCard(null)
      }, [])

      const startTranslation = useCallback((text, anchor) => {
        const previous = controllerRef.current
        if (previous) {
          try {
            previous.abort()
          } catch (error) {
            /* ignore */
          }
        }
        const controller = new AbortController()
        controllerRef.current = controller
        const phrase = lookupPhrase(text)
        setCard({ phase: 'loading', mode: settingsRef.current.dictionary && phrase ? 'dict' : 'mt', text, anchor })

        const settle = (next) => {
          if (controller.signal.aborted) return
          if (controllerRef.current === controller) controllerRef.current = null
          setCard(next)
        }

        const run = async () => {
          if (settingsRef.current.dictionary && phrase) {
            const entry = await dictRequest(phrase, controller.signal).catch(() => null)
            if (controller.signal.aborted) return
            if (entry) {
              settle({ phase: 'dict', mode: 'dict', text, anchor, entry })
              return
            }
          }
          const translated = await translateRequest(text, controller.signal)
          settle({ phase: 'done', mode: 'mt', text, anchor, result: translated })
        }

        run().catch((error) => {
          if (controller.signal.aborted) return
          if (controllerRef.current === controller) controllerRef.current = null
          setCard({ phase: 'error', mode: 'mt', text, anchor, error: (error && error.message) || String(error) })
        })
      }, [])

      /** One entry point for every gesture: dedupe, filter, then dispatch. */
      const submit = useCallback(
        (text, rect) => {
          const live = settingsRef.current
          if (!live.enabled) return
          const clean = String(text || '').trim()
          if (!clean) return
          const key = `${clean}\u0000${Math.round(rect.left)}\u0000${Math.round(rect.top)}`
          const now = Date.now()
          const last = lastHandledRef.current
          if (last.key === key && now - last.at < 800) return
          lastHandledRef.current = { key, at: now }
          if (live.englishOnly && !isEnglishLike(clean)) return
          if (live.trigger === 'button') {
            closeCard()
            setCard({ phase: 'offer', text: clean, anchor: rect })
          } else {
            startTranslation(clean, rect)
          }
        },
        [closeCard, startTranslation],
      )

      useEffect(() => {
        let timer = null
        const schedule = (delay) => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = null
            const selection = window.getSelection ? window.getSelection() : null
            if (!selection || selection.isCollapsed) return
            if (selectionIgnored(selection)) return
            const picked = readSelection()
            if (picked) submit(picked.text, picked.rect)
          }, delay)
        }

        function onMouseUp(event) {
          const target = event.target
          if (target && target.nodeType === 1 && typeof target.closest === 'function' && target.closest('[data-sst]')) return
          schedule(120)
        }
        function onKeyUp(event) {
          if (!event.shiftKey) return
          schedule(380)
        }
        function onDoubleClick(event) {
          if (event.defaultPrevented) return
          if (shouldIgnore(event.target)) return
          // A double-click already left a word selection; the mouseup path owns it.
          if (readSelection()) return
          const picked = wordAt(event.clientX, event.clientY)
          if (picked) submit(picked.text, picked.rect)
        }
        function onKeyDown(event) {
          if (event.key === 'Escape') closeCard()
        }
        function onMouseDown(event) {
          const target = event.target
          if (target && target.nodeType === 1 && typeof target.closest === 'function' && target.closest('[data-sst]')) return
          closeCard()
        }

        installStyles()
        document.addEventListener('mouseup', onMouseUp, true)
        document.addEventListener('keyup', onKeyUp, true)
        document.addEventListener('dblclick', onDoubleClick, true)
        document.addEventListener('keydown', onKeyDown, true)
        document.addEventListener('mousedown', onMouseDown, true)
        return () => {
          if (timer) clearTimeout(timer)
          document.removeEventListener('mouseup', onMouseUp, true)
          document.removeEventListener('keyup', onKeyUp, true)
          document.removeEventListener('dblclick', onDoubleClick, true)
          document.removeEventListener('keydown', onKeyDown, true)
          document.removeEventListener('mousedown', onMouseDown, true)
          closeCard()
        }
      }, [closeCard, submit])

      useEffect(() => {
        setCopied(false)
      }, [card])

      if (!card) return null

      const geometry = anchorGeometry(card.anchor)
      const engine = ENGINES.filter((item) => item.id === settings.provider)[0]
      const preview = card.text.length > 160 ? `${card.text.slice(0, 160)}…` : card.text
      const isDict = card.phase === 'dict'

      let body = null
      if (card.phase === 'offer') {
        body = h(
          'div',
          { style: { display: 'flex', gap: 8, marginTop: 10 } },
          h('button', {
            type: 'button',
            className: 'sst-btn sst-btn-primary',
            onClick: () => startTranslation(card.text, card.anchor),
          }, t('translate')),
          h('button', { type: 'button', className: 'sst-btn', onClick: closeCard }, t('cancel')),
        )
      } else if (card.phase === 'loading') {
        body = h(
          'div',
          { style: { marginTop: 10, fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' } },
          card.mode === 'dict' ? t('loadingDict') : t('loading'),
        )
      } else if (card.phase === 'dict') {
        const entry = card.entry
        const senses = entry.senses || []
        body = h(
          'div',
          { className: 'sst-body', style: { marginTop: 8 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 15, lineHeight: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, entry.word),
            h(Phonetic, { entry, accent: 'uk' }),
            h(Phonetic, { entry, accent: 'us' }),
          ),
          senses.length
            ? h(
                'div',
                { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 } },
                senses.map((sense, index) =>
                  h(
                    'div',
                    { key: index, style: { display: 'flex', gap: 6, fontSize: 13, lineHeight: '20px' } },
                    sense.pos
                      ? h('span', { style: { flexShrink: 0, fontWeight: 600, color: 'var(--dsw-alias-brand-primary)', minWidth: 30 } }, sense.pos)
                      : null,
                    h('span', { style: { color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-word' } }, sense.text),
                  ),
                ),
              )
            : null,
          entry.web && entry.web.length
            ? h(
                'div',
                { style: { display: 'flex', gap: 6, marginTop: 8, fontSize: 12, lineHeight: '18px' } },
                h('span', { style: { flexShrink: 0, color: 'var(--dsw-alias-label-secondary)' } }, t('network')),
                h('span', { style: { color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-word' } }, entry.web.join('；')),
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 } },
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
              `${t('entryPrefix')} · ${entry.source === 'bing' ? t('sourceBing') : t('sourceYoudao')}`),
            h('button', {
              type: 'button',
              className: 'sst-btn',
              onClick: () => {
                try {
                  navigator.clipboard.writeText(dictToText(entry)).then(() => setCopied(true)).catch(() => {})
                } catch (error) {
                  /* clipboard blocked */
                }
              },
            }, copied ? t('copied') : t('copy')),
          ),
        )
      } else if (card.phase === 'done') {
        body = h(
          'div',
          { className: 'sst-body', style: { marginTop: 10 } },
          h(
            'div',
            { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13.5, lineHeight: 1.65, color: 'var(--dsw-alias-label-primary)' } },
            card.result,
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } }, engine ? engine.label : String(settings.provider)),
              h('button', {
                type: 'button',
                className: 'sst-btn',
                title: t('speak'),
                'aria-label': t('speak'),
                onClick: () => speak(card.text, 'en-US'),
              }, '🔊'),
            ),
            h('button', {
              type: 'button',
              className: 'sst-btn',
              onClick: () => {
                try {
                  navigator.clipboard.writeText(card.result).then(() => setCopied(true)).catch(() => {})
                } catch (error) {
                  /* clipboard blocked */
                }
              },
            }, copied ? t('copied') : t('copy')),
          ),
        )
      } else {
        body = h(
          'div',
          { style: { marginTop: 10 } },
          h(
            'div',
            { style: { fontSize: 12.5, lineHeight: 1.6, color: 'var(--dsw-alias-state-error-primary)', wordBreak: 'break-word' } },
            card.error,
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 10 } },
            h('button', { type: 'button', className: 'sst-btn', onClick: () => startTranslation(card.text, card.anchor) }, t('retry')),
            h('button', { type: 'button', className: 'sst-btn', onClick: closeCard }, t('cancel')),
          ),
        )
      }

      const heading = isDict
        ? null
        : h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } }, card.phase === 'done' ? t('result') : t('original')),
            h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', className: 'sst-icon', 'aria-label': t('close'), onClick: closeCard }, '✕'),
          )

      return h(
        'div',
        {
          'data-sst': 'card',
          style: {
            position: 'fixed',
            left: geometry.left,
            top: geometry.top,
            width: geometry.width,
            pointerEvents: 'auto',
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-primary)',
            border: '.5px solid var(--dsw-alias-border-l1)',
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(20, 24, 40, 0.14), 0 2px 6px rgba(20, 24, 40, 0.08)',
            padding: '12px 14px 14px',
            fontFamily: 'inherit',
            zIndex: 40,
          },
        },
        isDict
          ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: -2 } },
              h('button', { type: 'button', className: 'sst-icon', 'aria-label': t('close'), onClick: closeCard }, '✕'))
          : heading,
        isDict
          ? null
          : h(
              'div',
              {
                className: 'sst-body',
                style: {
                  marginTop: 4,
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: 'var(--dsw-alias-label-secondary)',
                  maxHeight: 60,
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                },
              },
              preview,
            ),
        body,
      )
    }

    /* ── settings page ──────────────────────────────────────────────────── */

    /* Row metrics copied from the host's General settings row
       (ui-settings-general DeveloperToolsRow.module.css): 16px vertical padding,
       a .5px border-l2 divider, 14/20 title, 12/18 description, 24px gap. */
    function Row(props) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 24,
            padding: '16px 0',
            borderBottom: props.last ? 'none' : '.5px solid var(--dsw-alias-border-l2)',
          },
        },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('div', { style: { fontSize: 14, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' } }, props.title),
          props.hint
            ? h(
                'div',
                { style: { marginTop: 4, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } },
                props.hint,
              )
            : null,
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } }, props.children),
      )
    }

    function Toggle(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          className: 'sst-switch',
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label || props.title,
          onClick: () => props.onChange(!props.checked),
          style: {
            width: 32,
            height: 20,
            boxSizing: 'border-box',
            appearance: 'none',
            WebkitAppearance: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: props.checked ? 'flex-end' : 'flex-start',
            padding: 2,
            borderRadius: 999,
            border: props.checked ? '.5px solid var(--dsw-alias-label-primary)' : '.5px solid var(--dsw-alias-border-l1)',
            background: props.checked
              ? 'var(--dsw-alias-label-primary)'
              : 'color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)',
            cursor: 'pointer',
            transition: 'background 120ms ease',
          },
        },
        h('span', {
          className: 'sst-knob',
          style: {
            display: 'block',
            flex: '0 0 auto',
            width: 15,
            height: 15,
            borderRadius: 999,
            background: 'var(--dsw-alias-bg-base)',
            boxShadow: '0 0 0 0.5px rgba(0, 0, 0, 0.08)',
            transition: 'margin 120ms ease',
            marginLeft: props.checked ? 'auto' : 0,
          },
        }),
      )
    }

    function Segmented(props) {
      return h(
        'div',
        { style: { display: 'flex', gap: 2, padding: 2, border: '.5px solid var(--dsw-alias-border-l1)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)' } },
        props.options.map((option) =>
          h(
            'button',
            {
              key: option.id,
              type: 'button',
              onClick: () => props.onChange(option.id),
              style: {
                padding: '4px 10px',
                fontSize: 12,
                lineHeight: '18px',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: props.value === option.id ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
                color: props.value === option.id ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                fontWeight: props.value === option.id ? 600 : 400,
              },
            },
            option.label,
          ),
        ),
      )
    }

    function SettingsSection() {
      const current = useSettings()
      const [providers, setProviders] = useState(null)

      useEffect(() => {
        let alive = true
        fetchProviders()
          .then((list) => {
            if (alive) setProviders(list)
          })
          .catch(() => {
            if (alive) setProviders(null)
          })
        return () => {
          alive = false
        }
      }, [])

      const available = providers === null ? null : providers

      return h(
        'div',
        { style: { padding: '0 0 32px' } },
        h(
          Row,
          { title: t('enabled'), hint: t('enabledHint') },
          h(Toggle, { checked: current.enabled, title: t('enabled'), onChange: (value) => updateSettings({ enabled: value }) }),
        ),
        h(
          Row,
          { title: t('trigger'), hint: t('triggerHint') },
          h(Segmented, {
            value: current.trigger,
            options: [
              { id: 'dblclick', label: t('triggerDirect') },
              { id: 'button', label: t('triggerButton') },
            ],
            onChange: (value) => updateSettings({ trigger: value }),
          }),
        ),
        h(
          Row,
          { title: t('dictionary'), hint: t('dictionaryHint') },
          h(Toggle, { checked: current.dictionary, title: t('dictionary'), onChange: (value) => updateSettings({ dictionary: value }) }),
        ),
        h(
          Row,
          { title: t('dictSourceRow'), hint: t('dictSourceHint') },
          h(
            'select',
            {
              className: 'sst-select',
              value: current.dictSource,
              onChange: (event) => updateSettings({ dictSource: event.target.value }),
            },
            [
              ['youdao', t('sourceYoudao')],
              ['bing', t('sourceBing')],
              ['auto', t('sourceAuto')],
            ].map(([value, label]) => h('option', { key: value, value }, label)),
          ),
        ),
        h(
          Row,
          { title: t('engine'), hint: t('engineHint') },
          h(
            'select',
            {
              className: 'sst-select',
              value: current.provider,
              onChange: (event) => updateSettings({ provider: event.target.value }),
            },
            ENGINES.map((engine) =>
              h(
                'option',
                { key: engine.id, value: engine.id },
                available && available.indexOf(engine.id) < 0 ? `${engine.label} · ${t('unavailable')}` : engine.label,
              ),
            ),
          ),
        ),
        h(
          Row,
          { title: t('target') },
          h(
            'select',
            {
              className: 'sst-select',
              value: current.targetLanguage,
              onChange: (event) => updateSettings({ targetLanguage: event.target.value }),
            },
            TARGETS.map((target) => h('option', { key: target.id, value: target.id }, target.label)),
          ),
        ),
        h(
          Row,
          { title: t('englishOnly'), hint: t('englishOnlyHint'), last: true },
          h(Toggle, {
            checked: current.englishOnly,
            title: t('englishOnly'),
            onChange: (value) => updateSettings({ englishOnly: value }),
          }),
        ),
        h(
          'p',
          { style: { margin: '16px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } },
          t('sectionHint'),
        ),
        providers === null
          ? h(
              'p',
              { style: { margin: '6px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } },
              t('checkFailed'),
            )
          : null,
      )
    }

    /* ── session probe: the paid engines need the open Session id ───────── */

    function SessionProbe(props) {
      const sessionId = props && props.sessionId ? String(props.sessionId) : ''
      useEffect(() => {
        if (sessionId) currentSessionId = sessionId
      }, [sessionId])
      return null
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'smart-selection-translate', order: 20 }, TranslatorOverlay),
        )
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'smart-selection-translate', order: 50, label: () => t('sectionTitle') },
            SettingsSection,
          ),
        )
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'sst-session', order: 900 },
            SessionProbe,
          ),
        )
      },
    }
  },
})
