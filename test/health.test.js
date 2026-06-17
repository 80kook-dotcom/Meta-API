/**
 * /health 운영 축소 + /internal/health 보호 + 캐시백 HMAC 게이팅 통합 테스트 (S6).
 * createApp 을 실제 listen 해 HTTP 로 검증한다(HMAC 거부 경로는 KAYAK 호출 전 단락 → hermetic).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { config } from '../src/config.js'

async function startServer() {
  const app = createApp()
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}` }
}

test('/health: 개발은 상세 노출, 운영은 {ok:true}로 축소', async () => {
  const { server, base } = await startServer()
  const orig = config.isProduction
  try {
    config.isProduction = false
    const dev = await (await fetch(`${base}/health`)).json()
    assert.equal(dev.ok, true)
    assert.ok('kayakHost' in dev, '개발 health 는 kayakHost 등 상세 노출')

    config.isProduction = true
    const prod = await (await fetch(`${base}/health`)).json()
    assert.deepEqual(prod, { ok: true }, '운영 health 는 내부정보 미노출')
  } finally {
    config.isProduction = orig
    server.close()
  }
})

test('/internal/health: 시크릿 설정 시 헤더 없으면 401, 일치 시 상세', async () => {
  const { server, base } = await startServer()
  const orig = config.security.relaySharedSecret
  try {
    config.security.relaySharedSecret = 'topsecret'
    const unauth = await fetch(`${base}/internal/health`)
    assert.equal(unauth.status, 401)

    const authed = await fetch(`${base}/internal/health`, { headers: { 'x-relay-secret': 'topsecret' } })
    assert.equal(authed.status, 200)
    const j = await authed.json()
    assert.equal(j.security.relayAuth, true)
    assert.equal(typeof j.security.rateLimitPerMin, 'number')
  } finally {
    config.security.relaySharedSecret = orig
    server.close()
  }
})

test('/internal/health: 운영 모드 + 시크릿 미설정 → 503(이중 방어선·적대리뷰 #5)', async () => {
  const { server, base } = await startServer()
  const origProd = config.isProduction
  const origSecret = config.security.relaySharedSecret
  try {
    config.isProduction = true
    config.security.relaySharedSecret = ''
    const r = await fetch(`${base}/internal/health`)
    assert.equal(r.status, 503)
    assert.equal((await r.json()).error, 'SERVICE_UNAVAILABLE')
  } finally {
    config.isProduction = origProd
    config.security.relaySharedSecret = origSecret
    server.close()
  }
})

test('/internal/health: 시크릿 미설정(개발)이면 헤더 없이도 상세', async () => {
  const { server, base } = await startServer()
  const orig = config.security.relaySharedSecret
  try {
    config.security.relaySharedSecret = ''
    const r = await fetch(`${base}/internal/health`)
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.security.relayAuth, false)
  } finally {
    config.security.relaySharedSecret = orig
    server.close()
  }
})

test('cashback HMAC: secret 설정 시 sig 없으면 401, 잘못된 sig 401(KAYAK 미호출)', async () => {
  const { server, base } = await startServer()
  const orig = config.cashback.labelHmacSecret
  try {
    config.cashback.labelHmacSecret = 'cb-secret'
    // sig 누락
    const noSig = await fetch(`${base}/api/cashback?labels=member-1`)
    assert.equal(noSig.status, 401)
    assert.equal((await noSig.json()).error, 'MISSING_LABEL_SIG')
    assert.equal(noSig.headers.get('cache-control'), 'no-store')

    // 형식상 유효하나 서명 불일치(만료 임계 내 exp + 짧은 sig → 길이 불일치)
    const exp = Math.floor(Date.now() / 1000) + 60
    const badSig = await fetch(`${base}/api/cashback?labels=member-1&exp=${exp}&sig=00`)
    assert.equal(badSig.status, 401)
    assert.equal((await badSig.json()).error, 'INVALID_LABEL_SIG')
  } finally {
    config.cashback.labelHmacSecret = orig
    server.close()
  }
})

test('cashback: 라벨 누락은 secret 유무와 무관하게 400 MISSING_LABELS', async () => {
  const { server, base } = await startServer()
  try {
    const r = await fetch(`${base}/api/cashback`)
    assert.equal(r.status, 400)
    assert.equal((await r.json()).error, 'MISSING_LABELS')
  } finally {
    server.close()
  }
})
