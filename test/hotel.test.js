/**
 * 상세(단일) 어댑터 단위 테스트 — KAYAK Single Hotel Search → 앱 HotelDetail (S3).
 * 픽스처는 라이브 실측 구조(2026-06-17·노보텔 앰배서더 서울 동대문)를 본뜬 합성 데이터(비밀·apiKey 없음).
 * propertyType 캐시는 모듈 전역이라 각 테스트 전에 reset 하여 격리한다.
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { adaptHotelDetail } from '../src/adapters/hotel.js'
import { rememberPropertyType, _resetPropertyTypeCache } from '../src/lib/propertyTypeCache.js'

beforeEach(() => _resetPropertyTypeCache())

const RAW = {
  id: 3756840,
  key: 'khotel:3756840',
  name: 'Novotel Ambassador Seoul Dongdaemun',
  translatedName: '노보텔 앰배서더 서울 동대문',
  address: '중구 을지로 238',
  latitude: 37.56633,
  longitude: 127.00433,
  starRating: 5,
  description: '서울 중심부에 위치한 프리미엄 호텔로서 놀라운 도시 경관을 감상할 수 있습니다.',
  isComplete: true,
  currencyCode: 'KRW',
  // 무료WiFi(388)·주차(77)·레스토랑(72)·바라운지(73)·피트니스(335)·24시간프런트(124) + 반려동물불가(363·제외)
  features: [388, 77, 72, 73, 335, 124, 363],
  images: [
    { large: 'https://img/1.jpg', small: 's1', sprites: 'x' },
    { large: 'https://img/2.jpg' },
    { small: 'only-small' }, // large 없음 → 제외
  ],
  policies: [
    { code: 'checkin', name: '체크인', description: '15:00 이후' },
    { code: 'checkout', name: '체크아웃', description: '12:00 이전' },
  ],
  providers: [
    { code: 'ACCOR', name: '사이트 직접 예약', logo: 'https://cdn/accor.png', isDirect: true }, // cashback 없음
    { code: 'AGODA', name: '아고다', logo: 'https://cdn/agoda.png', isDirect: false, cashback: { type: 'PERCENTAGE', value: 5.5, cap: 1200000, currency: 'KRW' } },
  ],
  results: [
    { roomName: '스탠다드', totalRate: 429000, isCheapestRate: true, providerIndex: 0, hasFreeCancellation: false, canPayLater: false, availableRooms: 9, inclusions: [], bookUri: 'https://hapi-ko-kr.example/in?a=kan_318930_594068&p=&url=%2Fbook' },
    { roomName: '디럭스', totalRate: 403920, isCheapestRate: false, providerIndex: 1, hasFreeCancellation: true, canPayLater: true, inclusions: [0], bookUri: 'https://hapi-ko-kr.example/in?a=kan_318930_594068&p=&url=%2Fbook2' }, // availableRooms 누락
  ],
  reviews: {
    numberOfReviews: 2172,
    sentiment: '훌륭함, 8.7',
    quotes: [],
    aspects: [],
    guestRatings: { OVERALL: 8.7, LOCATION: 9.1, COMFORT: 8.9, SERVICES: 8.6, STAFF: 9, CLEAN: 9.1, VALUE: 8.5 },
  },
}

test('기본 매핑: 한글명·starRating·numberOfReviews·location·description·isComplete', () => {
  const d = adaptHotelDetail(RAW)
  assert.equal(d.hotelId, '3756840')
  assert.equal(d.name, '노보텔 앰배서더 서울 동대문') // translatedName 우선
  assert.equal(d.starRating, 5)
  assert.equal(d.numberOfReviews, 2172)
  assert.equal(d.location, '중구 을지로 238')
  assert.ok(d.description.startsWith('서울 중심부'))
  assert.equal(d.isComplete, true)
})

test('guestRating(#11): reviews.guestRatings.OVERALL(0~10) ÷2 → 0~5', () => {
  const d = adaptHotelDetail(RAW)
  assert.equal(d.guestRating, 4.4) // 8.7/2=4.35→4.4
  assert.equal(d.reviews.overall, 4.4)
})

test('reviews.categories: guestRatings 키→한글·÷2·OVERALL 제외·고정 순서', () => {
  const d = adaptHotelDetail(RAW)
  assert.deepEqual(d.reviews.categories, [
    { name: '위치', score: 4.6 }, // LOCATION 9.1/2=4.55→4.6
    { name: '청결도', score: 4.6 }, // CLEAN 9.1
    { name: '편안함', score: 4.5 }, // COMFORT 8.9/2=4.45→4.5
    { name: '서비스', score: 4.3 }, // SERVICES 8.6/2=4.3
    { name: '직원', score: 4.5 }, // STAFF 9/2=4.5
    { name: '가격 대비', score: 4.3 }, // VALUE 8.5/2=4.25→4.3
  ])
  // OVERALL 은 categories 에 없음(overall 로 분리)
  assert.ok(!d.reviews.categories.some((c) => c.name === '전체'))
})

test('reviews.items=[] (#19): KAYAK 개별리뷰 미제공 → 빈 배열(author/date 임의생성 금지)', () => {
  const d = adaptHotelDetail(RAW)
  assert.deepEqual(d.reviews.items, [])
})

test('propertyType(#20): 캐시 미스 → "숙소" 폴백', () => {
  const d = adaptHotelDetail(RAW)
  assert.equal(d.propertyType, '숙소')
})

test('propertyType(#20): 검색 캐시 hit → 라벨 사용', () => {
  rememberPropertyType('3756840', '호텔', 'ko_KR')
  const d = adaptHotelDetail(RAW, { languageCode: 'ko_KR' })
  assert.equal(d.propertyType, '호텔')
})

test('propertyType(#20): 언어 키 불일치면 미스(폴백)', () => {
  rememberPropertyType('3756840', 'Hotel', 'en_US')
  const d = adaptHotelDetail(RAW, { languageCode: 'ko_KR' }) // 다른 언어 → 미스
  assert.equal(d.propertyType, '숙소')
})

test('policies: checkin/checkout HH:MM 추출(앱이 "이후/이전" 부착) · cancel 없으면 ""', () => {
  const d = adaptHotelDetail(RAW)
  assert.deepEqual(d.policies, { checkin: '15:00', checkout: '12:00', cancel: '' })
})

test('policies: cancel code 있으면 원문(문장) 보존', () => {
  const raw = { ...RAW, policies: [...RAW.policies, { code: 'cancellation', name: '취소', description: '체크인 3일 전까지 무료 취소' }] }
  const d = adaptHotelDetail(raw)
  assert.equal(d.policies.cancel, '체크인 3일 전까지 무료 취소')
})

test('policies: HH:MM 없는 예외 형식 → 후행 "이후/이전" 제거(중복 방지)', () => {
  const raw = { ...RAW, policies: [{ code: 'checkin', description: '오후 3시 이후' }, { code: 'checkout', description: '정오 이전' }] }
  const d = adaptHotelDetail(raw)
  assert.equal(d.policies.checkin, '오후 3시') // "이후" 꼬리 제거(앱이 다시 붙임)
  assert.equal(d.policies.checkout, '정오')
})

test('facilities(#20): features → 15버킷 {tag,label}·카탈로그 순서·반려동물불가 제외', () => {
  const d = adaptHotelDetail(RAW)
  assert.deepEqual(d.facilities, [
    { tag: 'wifi', label: '무료 WiFi' },
    { tag: 'parking', label: '주차' },
    { tag: 'fitness', label: '피트니스' },
    { tag: 'restaurant', label: '레스토랑' },
    { tag: 'bar', label: '바/라운지' },
    { tag: 'frontdesk24', label: '24시간 프런트' },
  ])
})

test('providers: index 명시·logo 약자·logoUrl 전방호환·isDirect→cashback NONE', () => {
  const d = adaptHotelDetail(RAW)
  assert.equal(d.providers.length, 2)
  assert.deepEqual(d.providers[0], { index: 0, name: '사이트 직접 예약', logo: '사', cashback: { type: 'NONE' }, logoUrl: 'https://cdn/accor.png' })
  assert.equal(d.providers[1].index, 1)
  assert.equal(d.providers[1].logo, '아')
  assert.deepEqual(d.providers[1].cashback, { type: 'PERCENTAGE', value: 5.5, cap: 1200000, currency: 'KRW' })
})

test('results: 매핑·availableRooms 99폴백·bookUri(p=) 보존·providerIndex 조인키', () => {
  const d = adaptHotelDetail(RAW)
  assert.equal(d.results.length, 2)
  const standard = d.results.find((r) => r.roomName === '스탠다드')
  const deluxe = d.results.find((r) => r.roomName === '디럭스')
  assert.equal(standard.availableRooms, 9)
  assert.equal(deluxe.availableRooms, 99) // 누락 → 99(거짓 매진 방지)
  assert.equal(standard.providerIndex, 0)
  assert.equal(deluxe.providerIndex, 1)
  assert.ok(deluxe.bookUri.includes('p=')) // S4 회원라벨 주입 자리 보존
  assert.deepEqual(standard.inclusions, [])
  assert.deepEqual(deluxe.inclusions, [0])
})

test('results.isCheapestRate: 전체 최저가만 true(KAYAK 원본 플래그 어긋나도 교정)', () => {
  const d = adaptHotelDetail(RAW)
  // RAW 는 비싼 스탠다드(429000)에 isCheapestRate=true(오류), 싼 디럭스(403920)에 false.
  const standard = d.results.find((r) => r.roomName === '스탠다드')
  const deluxe = d.results.find((r) => r.roomName === '디럭스')
  assert.equal(deluxe.isCheapestRate, true) // 실제 최저가
  assert.equal(standard.isCheapestRate, false) // 교정됨
})

test('images: {url,tag:""} · large 없는 항목 제외(사진탭 "모든 사진"만)', () => {
  const d = adaptHotelDetail(RAW)
  assert.deepEqual(d.images, [
    { url: 'https://img/1.jpg', tag: '' },
    { url: 'https://img/2.jpg', tag: '' },
  ])
})

test('place: lat/lon/address', () => {
  const d = adaptHotelDetail(RAW)
  assert.deepEqual(d.place, { lat: 37.56633, lon: 127.00433, address: '중구 을지로 238' })
})

test('🔒 키 누출 0: 직렬화 결과에 apiKey 흔적·href 류 통째 전달 없음', () => {
  const d = adaptHotelDetail(RAW)
  const json = JSON.stringify(d)
  assert.ok(!/apiKey/i.test(json))
  assert.ok(!json.includes('"href"'))
})

test('dataless 방어: results 없음 → results []·providers 매핑·요금 정합 skip', () => {
  const raw = { ...RAW, results: undefined }
  const d = adaptHotelDetail(raw)
  assert.deepEqual(d.results, [])
  assert.equal(d.providers.length, 2) // 호텔 정보·공급사는 여전히 매핑
  assert.equal(d.facilities.length, 6)
})

test('빈 응답 방어: null·{} 도 앱 타입 형태 유지', () => {
  for (const empty of [null, {}, undefined]) {
    const d = adaptHotelDetail(empty)
    assert.equal(d.hotelId, '')
    assert.equal(d.name, '')
    assert.equal(d.starRating, 0)
    assert.equal(d.guestRating, 0)
    assert.equal(d.numberOfReviews, 0)
    assert.equal(d.propertyType, '숙소')
    assert.equal(d.description, '')
    assert.deepEqual(d.facilities, [])
    assert.deepEqual(d.policies, { checkin: '', checkout: '', cancel: '' })
    assert.deepEqual(d.images, [])
    assert.deepEqual(d.place, { lat: 0, lon: 0, address: '' })
    assert.deepEqual(d.reviews, { overall: 0, categories: [], items: [] })
    assert.deepEqual(d.providers, [])
    assert.deepEqual(d.results, [])
    assert.equal(d.isComplete, false)
  }
})

// ── 적대 리뷰(wf) confirmed 수정 회귀 방지 ──
test('적대리뷰 #2/#4/#5: 무효 요금(totalRate<=0·providerIndex<0) 드롭 + isCheapestRate 정합', () => {
  const raw = {
    ...RAW,
    results: [
      { roomName: '정상', totalRate: 300000, providerIndex: 1 },
      { roomName: '무료오류', totalRate: 0, providerIndex: 1 }, // ₩0 phantom → 드롭
      { roomName: '음수', totalRate: -100, providerIndex: 1 }, // 음수 → 드롭
      { roomName: '조인불가', totalRate: 200000 }, // providerIndex 누락(-1) → 드롭
      { roomName: '정상2', totalRate: 250000, providerIndex: 0 },
    ],
  }
  const d = adaptHotelDetail(raw)
  assert.deepEqual(d.results.map((r) => r.roomName).sort(), ['정상', '정상2']) // 무효 3건 드롭
  const cheapest = d.results.filter((r) => r.isCheapestRate)
  assert.equal(cheapest.length, 1)
  assert.equal(cheapest[0].totalRate, 250000) // 남은 요금 중 최저가만 true
})

test('적대리뷰 #2: 유효 요금 0건이면 results [](거짓 ₩0 노출 안 함)', () => {
  const raw = { ...RAW, results: [{ roomName: 'x', totalRate: 0, providerIndex: 0 }] }
  const d = adaptHotelDetail(raw)
  assert.deepEqual(d.results, [])
})

test('적대리뷰 #3: guestRatings 손상값(>10·NaN) 카테고리 제외·guestRating 클램프', () => {
  const raw = {
    ...RAW,
    reviews: { numberOfReviews: 10, guestRatings: { OVERALL: 8, LOCATION: 11, COMFORT: NaN, STAFF: 9 } },
  }
  const d = adaptHotelDetail(raw)
  // LOCATION(11·범위초과)·COMFORT(NaN) 제외 → STAFF(직원)만
  assert.deepEqual(d.reviews.categories, [{ name: '직원', score: 4.5 }])
  assert.equal(d.guestRating, 4) // OVERALL 8/2=4
})
