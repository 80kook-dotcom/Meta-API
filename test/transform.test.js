/**
 * 어댑터 공통 변환 헬퍼 단위 테스트 (#5·#7 등 cross-cutting 결정 보장).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeGuestRating,
  mapCashback,
  mapPlaceType,
  providerInitial,
  pickImages,
  ratesCheapestFirst,
} from '../src/adapters/transform.js'

test('normalizeGuestRating: 0~10 → 0~5 (÷2·소수1자리)', () => {
  assert.equal(normalizeGuestRating(8.7), 4.4) // 4.35 → 4.4
  assert.equal(normalizeGuestRating(9.0), 4.5)
  assert.equal(normalizeGuestRating(10), 5)
  assert.equal(normalizeGuestRating(0), 0)
  assert.equal(normalizeGuestRating(7.7), 3.9) // 3.85 → 3.9
})

test('normalizeGuestRating: -1(평점없음)·비정상 → 0', () => {
  assert.equal(normalizeGuestRating(-1), 0)
  assert.equal(normalizeGuestRating(undefined), 0)
  assert.equal(normalizeGuestRating(null), 0)
  assert.equal(normalizeGuestRating('8'), 0) // 문자열은 0(방어)
  assert.equal(normalizeGuestRating(NaN), 0) // NaN(손상) → 0
  assert.equal(normalizeGuestRating(Infinity), 0) // Infinity → 0
})

test('normalizeGuestRating: 손상값(>10)은 10으로 클램프(앱 0~5 척도 보호·적대리뷰 #3)', () => {
  assert.equal(normalizeGuestRating(11), 5) // min(11,10)/2=5
  assert.equal(normalizeGuestRating(20), 5)
})

test('mapCashback: PERCENTAGE 는 value + cap/currency 보존', () => {
  const c = mapCashback({ type: 'PERCENTAGE', value: 5.5, cap: 1200000, currency: 'KRW' }, false)
  assert.deepEqual(c, { type: 'PERCENTAGE', value: 5.5, cap: 1200000, currency: 'KRW' })
})

test('mapCashback: isDirect 공급사·캐시백 없음 → NONE', () => {
  assert.deepEqual(mapCashback({ type: 'PERCENTAGE', value: 5.5 }, true), { type: 'NONE' })
  assert.deepEqual(mapCashback(undefined, false), { type: 'NONE' })
  assert.deepEqual(mapCashback({ type: 'FLAT', value: 1000 }, false), { type: 'NONE' }) // 미지원 타입 → NONE
})

test('mapPlaceType: 앱 enum 흡수', () => {
  assert.equal(mapPlaceType('city'), 'city')
  assert.equal(mapPlaceType('hotel'), 'hotel')
  assert.equal(mapPlaceType('neighborhood'), 'neighborhood')
  assert.equal(mapPlaceType('touristregion'), 'region')
  assert.equal(mapPlaceType('country'), 'region')
  assert.equal(mapPlaceType('UNKNOWN_X'), 'region') // 기본 region
})

test('providerInitial: 공급사명 첫 글자', () => {
  assert.equal(providerInitial('아고다'), '아')
  assert.equal(providerInitial('호텔스닷컴'), '호')
  assert.equal(providerInitial(''), '?')
  assert.equal(providerInitial(undefined), '?')
})

test('pickImages: large URL 만 추출·누락 방어', () => {
  assert.deepEqual(
    pickImages([{ large: 'a', small: 's' }, { small: 'only-small' }, { large: 'b' }]),
    ['a', 'b'],
  )
  assert.deepEqual(pickImages(undefined), [])
})

test('ratesCheapestFirst: 총액 오름차순(앱 topRates[0]=최저가 보장)', () => {
  const sorted = ratesCheapestFirst([
    { totalRate: 412720, isCheapestRate: false },
    { totalRate: 403920, isCheapestRate: true },
    { totalRate: 500000 },
  ])
  assert.deepEqual(sorted.map((r) => r.totalRate), [403920, 412720, 500000])
  assert.equal(sorted[0].isCheapestRate, true)
})
