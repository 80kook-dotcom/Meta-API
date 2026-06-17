/**
 * 자동완성 어댑터 단위 테스트 — KAYAK → 앱 AutocompleteItem[].
 * 픽스처는 실측 응답 형태(2026-06-17)를 본뜬 합성 데이터(비밀 없음).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adaptAutocomplete } from '../src/adapters/autocomplete.js'

// 실측: KAYAK 은 hotel 을 앞에 주는 경향 → 어댑터가 city→region→hotel→neighborhood 로 재정렬해야 함.
const RAW = [
  { entityKey: 'khotel:1072308625', primaryPlaceType: 'hotel', fullName: '서울스테이, Seoul, South Korea', hotelName: '서울스테이', cityName: 'Seoul' },
  { entityKey: 'khotel:11402171', primaryPlaceType: 'hotel', fullName: '서울 리버뷰 호텔', hotelName: '서울 리버뷰 호텔', cityName: 'Seoul' },
  { entityKey: 'kplace:22028', primaryPlaceType: 'city', fullName: 'Seoul, South Korea', cityName: 'Seoul' },
  { entityKey: 'kplace:2766662', primaryPlaceType: 'neighborhood', fullName: 'Myeong-dong, Seoul, South Korea', cityName: 'Seoul' },
  { entityKey: 'kplace:999', primaryPlaceType: 'touristregion', fullName: '강남 관광지구', cityName: 'Seoul' },
]

test('정렬: city → region(touristregion) → hotel → neighborhood', () => {
  const out = adaptAutocomplete(RAW)
  assert.deepEqual(out.map((x) => x.primaryPlaceType), ['city', 'region', 'hotel', 'hotel', 'neighborhood'])
})

test('필드 변환: fullName → fullname(소문자), hotel 만 hotelName', () => {
  const out = adaptAutocomplete(RAW)
  const city = out.find((x) => x.entityKey === 'kplace:22028')
  assert.equal(city.fullname, 'Seoul, South Korea')
  assert.equal(city.hotelName, undefined) // city 엔 hotelName 없음
  const hotel = out.find((x) => x.entityKey === 'khotel:1072308625')
  assert.equal(hotel.hotelName, '서울스테이')
  assert.equal(hotel.primaryPlaceType, 'hotel')
})

test('touristregion → region 흡수', () => {
  const out = adaptAutocomplete(RAW)
  assert.equal(out.find((x) => x.entityKey === 'kplace:999').primaryPlaceType, 'region')
})

test('최대 6건·entityKey 없는 항목 제거', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ entityKey: `khotel:${i}`, primaryPlaceType: 'hotel', hotelName: `h${i}`, fullName: `h${i}` }))
  many.push({ primaryPlaceType: 'hotel', hotelName: 'no-key' }) // entityKey 없음 → 제거
  assert.equal(adaptAutocomplete(many).length, 6)
})

test('배열이 아닌 래핑 응답({records:[...]})도 처리', () => {
  const out = adaptAutocomplete({ records: RAW })
  assert.equal(out.length, 5)
})

test('빈/이상 입력 → 빈 배열', () => {
  assert.deepEqual(adaptAutocomplete(null), [])
  assert.deepEqual(adaptAutocomplete({}), [])
})
