/**
 * 편의시설 버킷 매핑 단위 테스트 (#4).
 * codex 교차검토 핵심: 명시적 유료 와이파이를 '무료 WiFi'로 분류하지 않는다 / '반려동물 불가'는 제외.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { featuresToAmenities, AMENITY_ORDER, _buckets } from '../src/adapters/amenities.js'

test('무료 WiFi: 무료/일반 와이파이는 포함', () => {
  assert.ok(featuresToAmenities([388]).includes('무료 WiFi')) // 무료 와이파이
  assert.ok(featuresToAmenities([361]).includes('무료 WiFi')) // 무료 인터넷
  assert.ok(featuresToAmenities([13]).includes('무료 WiFi')) // 와이파이(일반)
})

test('무료 WiFi: 명시적 유료 와이파이(389)·인터넷 추가요금(362)은 무료로 분류하지 않음', () => {
  assert.deepEqual(featuresToAmenities([389]), []) // 와이파이(유료) — 무료 아님
  assert.deepEqual(featuresToAmenities([362]), []) // 인터넷(추가 요금)
})

test('주차: 유료 주차도 주차로 인정(라벨이 무료가 아님)', () => {
  assert.ok(featuresToAmenities([367]).includes('주차')) // 주차(추가 요금)
  assert.ok(featuresToAmenities([364]).includes('주차')) // 무료 주차
})

test('반려동물: 동반 가능(394)만 인정·동반 불가(363)는 제외', () => {
  assert.ok(featuresToAmenities([394]).includes('반려동물'))
  assert.deepEqual(featuresToAmenities([363]), []) // 반려동물 동반 불가 → 어떤 버킷도 아님
})

test('한 ID 가 여러 버킷(1157=레스토랑 및 바)', () => {
  const a = featuresToAmenities([1157])
  assert.ok(a.includes('레스토랑'))
  assert.ok(a.includes('바/라운지'))
})

test('출력은 카탈로그 순서·중복 제거', () => {
  // 사우나(225)·금연(67)·수영장(371)·주차(77) 를 뒤섞어 입력
  const a = featuresToAmenities([67, 225, 371, 77, 77])
  assert.deepEqual(a, ['주차', '수영장', '사우나', '금연객실']) // AMENITY_ORDER 순
  // 순서 검증: 주차 < 수영장 < 사우나 < 금연객실 (카탈로그 인덱스)
  for (let i = 1; i < a.length; i++) {
    assert.ok(AMENITY_ORDER.indexOf(a[i - 1]) < AMENITY_ORDER.indexOf(a[i]))
  }
})

test('미등록 ID·빈 입력 → 빈 배열(graceful)', () => {
  assert.deepEqual(featuresToAmenities([999999]), [])
  assert.deepEqual(featuresToAmenities([]), [])
  assert.deepEqual(featuresToAmenities(undefined), [])
})

test('버킷 정의는 15개(앱 AMENITY_CATALOG 와 동수)', () => {
  assert.equal(Object.keys(_buckets()).length, 15)
  assert.equal(AMENITY_ORDER.length, 15)
})
