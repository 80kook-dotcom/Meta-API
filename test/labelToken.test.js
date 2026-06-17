/**
 * 캐시백 라벨 서명 토큰 검증 단위 테스트 (S6·#11/D2·IDOR 방어).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signLabel, verifyLabelToken } from '../src/lib/labelToken.js'

const secret = 'test-secret'
const label = 'member-123'
const NOW = 1_700_000_000 // 고정 Unix 초(결정성)

test('유효 서명(만료 전·수명 내) → ok', () => {
  const exp = NOW + 100
  const sig = signLabel(label, exp, secret)
  assert.deepEqual(verifyLabelToken({ label, exp, sig, secret, nowSec: NOW, maxAgeSec: 300 }), { ok: true })
})

test('sig/exp 누락 → 401 MISSING_LABEL_SIG', () => {
  const r1 = verifyLabelToken({ label, exp: NOW + 100, sig: '', secret, nowSec: NOW })
  assert.equal(r1.ok, false)
  assert.equal(r1.status, 401)
  assert.equal(r1.code, 'MISSING_LABEL_SIG')
  const r2 = verifyLabelToken({ label, exp: undefined, sig: 'abcd', secret, nowSec: NOW })
  assert.equal(r2.code, 'MISSING_LABEL_SIG')
})

test('exp 비정수 → 400 INVALID_LABEL_EXP', () => {
  const r = verifyLabelToken({ label, exp: 'soon', sig: 'aa', secret, nowSec: NOW })
  assert.equal(r.status, 400)
  assert.equal(r.code, 'INVALID_LABEL_EXP')
})

test('만료된 서명 → 401 EXPIRED_LABEL_SIG', () => {
  const exp = NOW - 1
  const sig = signLabel(label, exp, secret)
  const r = verifyLabelToken({ label, exp, sig, secret, nowSec: NOW, maxAgeSec: 300 })
  assert.equal(r.code, 'EXPIRED_LABEL_SIG')
})

test('장기 토큰(만료가 maxAge 초과) → 401 LABEL_SIG_TTL_TOO_LONG', () => {
  const exp = NOW + 100_000 // maxAge 300 보다 훨씬 멀다
  const sig = signLabel(label, exp, secret)
  const r = verifyLabelToken({ label, exp, sig, secret, nowSec: NOW, maxAgeSec: 300 })
  assert.equal(r.code, 'LABEL_SIG_TTL_TOO_LONG')
})

test('라벨 변조(다른 라벨로 검증) → 401 INVALID_LABEL_SIG', () => {
  const exp = NOW + 100
  const sig = signLabel(label, exp, secret) // member-123 로 서명
  const r = verifyLabelToken({ label: 'attacker-999', exp, sig, secret, nowSec: NOW, maxAgeSec: 300 })
  assert.equal(r.code, 'INVALID_LABEL_SIG')
})

test('잘못된 시크릿으로 서명 → 401 INVALID_LABEL_SIG', () => {
  const exp = NOW + 100
  const sig = signLabel(label, exp, 'wrong-secret')
  const r = verifyLabelToken({ label, exp, sig, secret, nowSec: NOW, maxAgeSec: 300 })
  assert.equal(r.code, 'INVALID_LABEL_SIG')
})

test('길이가 다른 sig hex → 401 INVALID_LABEL_SIG(timingSafeEqual 길이 가드)', () => {
  const exp = NOW + 100
  const r = verifyLabelToken({ label, exp, sig: 'abcd', secret, nowSec: NOW, maxAgeSec: 300 })
  assert.equal(r.code, 'INVALID_LABEL_SIG')
})

test('maxAgeSec 미지정(0)이면 장기 토큰 허용(만료만 검사)', () => {
  const exp = NOW + 100_000
  const sig = signLabel(label, exp, secret)
  assert.deepEqual(verifyLabelToken({ label, exp, sig, secret, nowSec: NOW }), { ok: true })
})
