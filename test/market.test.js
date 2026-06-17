/**
 * 통화·언어 허용목록 검증(lib/market.js) 단위 테스트 (S6·#21).
 * 환경(.env) 영향을 배제하기 위해 허용목록을 테스트에서 고정한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../src/config.js'
import { resolveCurrency, resolveLanguage } from '../src/lib/market.js'

function withMarket(fn) {
  const o = {
    currencyCode: config.market.currencyCode,
    languageCode: config.market.languageCode,
    supportedCurrencies: config.market.supportedCurrencies,
    supportedLanguages: config.market.supportedLanguages,
  }
  try {
    config.market.currencyCode = 'KRW'
    config.market.languageCode = 'ko_KR'
    config.market.supportedCurrencies = ['KRW']
    config.market.supportedLanguages = ['ko_KR']
    return fn()
  } finally {
    Object.assign(config.market, o)
  }
}

test('통화: 누락 → 기본(KRW)', () => {
  withMarket(() => {
    assert.equal(resolveCurrency('').value, 'KRW')
    assert.equal(resolveCurrency(undefined).value, 'KRW')
    assert.equal(resolveCurrency('  ').value, 'KRW')
  })
})

test('통화: KRW 허용 · USD 거부(400 UNSUPPORTED_CURRENCY)', () => {
  withMarket(() => {
    assert.equal(resolveCurrency('KRW').value, 'KRW')
    const bad = resolveCurrency('USD')
    assert.ok(bad.error)
    assert.equal(bad.error.error, 'UNSUPPORTED_CURRENCY')
    assert.ok(bad.error.message.includes('USD'))
  })
})

test('언어: 누락 → 기본(ko_KR) · ko_KR 허용 · en_US 거부', () => {
  withMarket(() => {
    assert.equal(resolveLanguage('').value, 'ko_KR')
    assert.equal(resolveLanguage('ko_KR').value, 'ko_KR')
    const bad = resolveLanguage('en_US')
    assert.ok(bad.error)
    assert.equal(bad.error.error, 'UNSUPPORTED_LANGUAGE')
  })
})

test('허용목록 확장 시 추가 통화 허용', () => {
  withMarket(() => {
    config.market.supportedCurrencies = ['KRW', 'USD']
    assert.equal(resolveCurrency('USD').value, 'USD')
  })
})
