/**
 * 운영 설정 강제 검증(validateProductionConfig) 단위 테스트 (S6·fail-fast).
 * config 객체를 라이브로 읽으므로 테스트가 필드를 토글하고 복원한다(파일별 프로세스 격리).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config, validateProductionConfig, num } from '../src/config.js'

// ── num(): 숫자 env 검증·fail-fast (S6 적대리뷰 #7) ──
test('num: 유효 문자열 숫자 통과', () => {
  assert.equal(num('5', 3, { min: 0, name: 'X' }), 5)
})
test('num: 미설정(undefined) → fallback', () => {
  assert.equal(num(undefined, 7, { name: 'X' }), 7)
})
test('num: NaN(잘못된 문자열) → throw(fail-fast)', () => {
  assert.throws(() => num('abc', 3, { name: 'X' }), /올바르지 않습니다/)
})
test('num: 음수 < min → throw', () => {
  assert.throws(() => num('-1', 5, { min: 0, name: 'X' }))
})
test('num: 비정수 + integer → throw', () => {
  assert.throws(() => num('1.5', 5, { integer: true, name: 'X' }))
})
test('num: max 초과 → throw (settleDay 같은 상한)', () => {
  assert.throws(() => num('40', 26, { min: 1, max: 31, name: 'CASHBACK_SETTLE_DAY' }))
})
test('num: 실제 config 숫자값은 모두 유한 정수(기동 시 검증 통과 증거)', () => {
  for (const v of [config.port, config.autocompleteCacheTtlMs, config.poll.intervalMs, config.poll.maxAttempts, config.poll.timeoutMs, config.poll.maxTransientRetries, config.requestTimeoutMs, config.cashback.lookbackDays, config.cashback.pageSize, config.cashback.settleDay, config.cashback.labelTokenMaxAgeSec, config.security.rateLimitPerMin, config.trustProxyHops]) {
    assert.ok(Number.isFinite(v) && Number.isInteger(v), `값 ${v} 가 유한 정수`)
  }
})

/** 운영 모드 + 완전 하드닝 기준값으로 세팅한 뒤 overrides 적용, fn 실행, 원복. */
function withProd(overrides, fn) {
  const o = {
    isProduction: config.isProduction,
    allowedOrigins: config.allowedOrigins,
    relaySharedSecret: config.security.relaySharedSecret,
    rateLimitPerMin: config.security.rateLimitPerMin,
    allowNoOrigin: config.security.allowNoOrigin,
    labelHmacSecret: config.cashback.labelHmacSecret,
    trustProxyHops: config.trustProxyHops,
    apiKey: config.apiKey,
    reportingKey: config.reportingKey,
    affiliateId: config.affiliateId,
  }
  try {
    // 완전 하드닝 기준값(이 상태면 fatal·warn 모두 0).
    config.isProduction = true
    config.allowedOrigins = ['https://meta-re.pages.dev']
    config.security.relaySharedSecret = 'shared-secret'
    config.security.rateLimitPerMin = 60
    config.security.allowNoOrigin = false
    config.cashback.labelHmacSecret = 'cb-secret'
    config.trustProxyHops = 1
    config.apiKey = 'k1'
    config.reportingKey = 'k2'
    config.affiliateId = 'kan_x'
    // overrides
    if ('isProduction' in overrides) config.isProduction = overrides.isProduction
    if ('allowedOrigins' in overrides) config.allowedOrigins = overrides.allowedOrigins
    if ('relaySharedSecret' in overrides) config.security.relaySharedSecret = overrides.relaySharedSecret
    if ('rateLimitPerMin' in overrides) config.security.rateLimitPerMin = overrides.rateLimitPerMin
    if ('allowNoOrigin' in overrides) config.security.allowNoOrigin = overrides.allowNoOrigin
    if ('labelHmacSecret' in overrides) config.cashback.labelHmacSecret = overrides.labelHmacSecret
    if ('trustProxyHops' in overrides) config.trustProxyHops = overrides.trustProxyHops
    if ('apiKey' in overrides) config.apiKey = overrides.apiKey
    return fn(validateProductionConfig())
  } finally {
    config.isProduction = o.isProduction
    config.allowedOrigins = o.allowedOrigins
    config.security.relaySharedSecret = o.relaySharedSecret
    config.security.rateLimitPerMin = o.rateLimitPerMin
    config.security.allowNoOrigin = o.allowNoOrigin
    config.cashback.labelHmacSecret = o.labelHmacSecret
    config.trustProxyHops = o.trustProxyHops
    config.apiKey = o.apiKey
    config.reportingKey = o.reportingKey
    config.affiliateId = o.affiliateId
  }
}

test('개발 모드면 검증 통과(빈 결과)', () => {
  const orig = config.isProduction
  try {
    config.isProduction = false
    const { fatal, warn } = validateProductionConfig()
    assert.equal(fatal.length, 0)
    assert.equal(warn.length, 0)
  } finally {
    config.isProduction = orig
  }
})

test('운영 + 완전 하드닝 → fatal 0 · warn 0', () => {
  withProd({}, ({ fatal, warn }) => {
    assert.equal(fatal.length, 0, `fatal: ${fatal.join(' | ')}`)
    assert.equal(warn.length, 0, `warn: ${warn.join(' | ')}`)
  })
})

test('운영 + 공유 시크릿 미설정 → fatal', () => {
  withProd({ relaySharedSecret: '' }, ({ fatal }) => {
    assert.ok(fatal.some((f) => f.includes('RELAY_SHARED_SECRET')))
  })
})

test('운영 + rate-limit 0 → fatal', () => {
  withProd({ rateLimitPerMin: 0 }, ({ fatal }) => {
    assert.ok(fatal.some((f) => f.includes('RATE_LIMIT_PER_MIN')))
  })
})

test('운영 + allowNoOrigin true → fatal', () => {
  withProd({ allowNoOrigin: true }, ({ fatal }) => {
    assert.ok(fatal.some((f) => f.includes('ALLOW_NO_ORIGIN')))
  })
})

test('운영 + ALLOWED_ORIGINS 에 localhost 포함 → fatal', () => {
  withProd({ allowedOrigins: ['https://meta-re.pages.dev', 'http://localhost:5173'] }, ({ fatal }) => {
    assert.ok(fatal.some((f) => f.includes('로컬 도메인')))
  })
})

test('운영 + ALLOWED_ORIGINS 빈 목록 → fatal', () => {
  withProd({ allowedOrigins: [] }, ({ fatal }) => {
    assert.ok(fatal.some((f) => f.includes('ALLOWED_ORIGINS 비어')))
  })
})

test('운영 + KAYAK 키 누락 → fatal', () => {
  withProd({ apiKey: '' }, ({ fatal }) => {
    assert.ok(fatal.some((f) => f.includes('KAYAK 키 미설정')))
  })
})

test('운영 + 라벨 HMAC 미설정 → warn(기동 허용)', () => {
  withProd({ labelHmacSecret: '' }, ({ fatal, warn }) => {
    assert.equal(fatal.length, 0)
    assert.ok(warn.some((w) => w.includes('CASHBACK_LABEL_HMAC_SECRET')))
  })
})

test('운영 + trustProxyHops 0 → warn(기동 허용)', () => {
  withProd({ trustProxyHops: 0 }, ({ fatal, warn }) => {
    assert.equal(fatal.length, 0)
    assert.ok(warn.some((w) => w.includes('TRUST_PROXY_HOPS')))
  })
})
