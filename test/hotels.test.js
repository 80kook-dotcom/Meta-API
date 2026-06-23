/**
 * 검색(다중) 어댑터 단위 테스트 — KAYAK → 앱 { results, totalCount }.
 * 픽스처는 실측 응답 구조(2026-06-17)를 본뜬 합성 데이터(비밀·apiKey·실토큰 없음).
 * propertyTypes 패싯이 사용 id 를 전부 커버 → constants 폴백(네트워크) 미발생(테스트 hermetic).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adaptHotels } from '../src/adapters/hotels.js'

const RAW = {
  isComplete: true,
  totalResults: 1256, // KAYAK 전체 매치 수(반환은 일부)
  currencyCode: 'KRW',
  propertyTypes: [
    { id: 0, name: '호텔', hotelCount: 606 },
    { id: 8, name: '게스트하우스', hotelCount: 12 },
  ],
  providers: [
    { name: '호텔스닷컴', logo: 'https://cdn/h.png', cashback: { type: 'PERCENTAGE', value: 5.5, cap: 1200000, currency: 'KRW' }, isDirect: false },
    { name: '사이트 직접 예약', logo: 'https://cdn/d.png', isDirect: true }, // cashback 없음
  ],
  results: [
    {
      id: 3756840,
      key: 'khotel:3756840',
      name: 'Novotel Ambassador Seoul',
      translatedName: '노보텔 앰배서더 서울',
      address: '중구 을지로 238',
      starRating: 5,
      guestRating: 8.7,
      numberOfReviews: 1234,
      numberOfProviders: 9,
      propertyType: 0,
      features: [388, 77, 72, 73, 67, 124, 363], // 무료WiFi·주차·레스토랑·바라운지·금연·24시간프런트 + 반려동물불가(제외)
      images: [{ large: 'https://img/1-large.jpg', small: 's' }, { large: 'https://img/2-large.jpg' }],
      rates: [
        // 일부러 최저가가 [0] 이 아니게 — 어댑터가 정렬해야 함.
        { roomName: 'A', totalRate: 412720, isCheapestRate: false, providerIndex: 1, hasFreeCancellation: false, canPayLater: false, availableRooms: 9, inclusions: [], bookUri: 'https://hapi-ko-kr.example/in?a=kan_318930_594068&p=&url=%2Fbook' },
        { roomName: 'B', totalRate: 403920, isCheapestRate: true, providerIndex: 0, hasFreeCancellation: true, canPayLater: true, availableRooms: 3, inclusions: [0], bookUri: 'https://hapi-ko-kr.example/in?a=kan_318930_594068&p=&url=%2Fbook2' },
      ],
    },
    {
      id: 555,
      key: 'khotel:555',
      name: 'Some Guesthouse',
      address: '마포구',
      starRating: -1, // 무성급
      guestRating: -1, // 평점 없음
      numberOfReviews: 0,
      numberOfProviders: 1,
      propertyType: 8,
      features: [],
      images: [],
      rates: [{ totalRate: 50000, providerIndex: 0, inclusions: [] }],
    },
  ],
}

test('totalCount=반환 건수 / serverTotalResults=KAYAK totalResults 보존(#17)', async () => {
  const out = await adaptHotels(RAW)
  assert.equal(out.results.length, 2)
  assert.equal(out.totalCount, 2)
  assert.equal(out.serverTotalResults, 1256)
})

test('호텔 1건 매핑: 한글명·평점÷2·propertyType 패싯·이미지·amenities', async () => {
  const { results } = await adaptHotels(RAW)
  const h = results[0]
  assert.equal(h.hotelId, '3756840') // 숫자 id 문자열
  assert.equal(h.name, '노보텔 앰배서더 서울') // translatedName 우선
  assert.equal(h.starRating, 5)
  assert.equal(h.guestRating, 4.4) // 8.7/2=4.35→4.4 (#7)
  assert.equal(h.numberOfReviews, 1234)
  assert.equal(h.propertyType, '호텔') // 패싯 id 0
  assert.equal(h.numberOfProviders, 8) // 원본 9 − 이 호텔에 끼어 있던 「사이트 직접 예약」 1종(노출 제외)
  assert.equal(h.location, '중구 을지로 238')
  assert.deepEqual(h.images, ['https://img/1-large.jpg', 'https://img/2-large.jpg'])
  // amenities: 무료WiFi·주차·레스토랑·바/라운지·금연객실·24시간 프런트 (반려동물불가 363 제외)
  assert.deepEqual(h.amenities, ['무료 WiFi', '주차', '레스토랑', '바/라운지', '금연객실', '24시간 프런트'])
})

test('topRates: 최저가가 [0] (가격 정렬·필터 정확성)', async () => {
  const { results } = await adaptHotels(RAW)
  const tr = results[0].topRates
  assert.equal(tr[0].totalRate, 403920)
  assert.equal(tr[0].isCheapestRate, true)
  assert.equal(tr[0].providerName, '호텔스닷컴')
  assert.equal(tr[0].providerLogo, '호') // 첫 글자 배지
  assert.equal(tr[0].providerLogoUrl, 'https://cdn/h.png') // 전방호환 추가 필드
  assert.ok(tr[0].bookUri.includes('p=')) // 딥링크 보존(S4 p= 주입 지점)
  assert.deepEqual(tr[0].cashback, { type: 'PERCENTAGE', value: 5.5, cap: 1200000, currency: 'KRW' })
})

test('「사이트 직접 예약」(isDirect) 요금은 topRates 에서 제외(노출 정책 2026-06-23)', async () => {
  const { results } = await adaptHotels(RAW)
  // direct 공급사는 노출하지 않음 → topRates 에 등장하지 않는다(mapCashback NONE 은 transform.test 에서 별도 커버).
  assert.equal(results[0].topRates.find((r) => r.providerName === '사이트 직접 예약'), undefined)
  // 노보텔은 호텔스닷컴만 남는다(direct 412720 제외 · 호텔스닷컴 403920 유지).
  assert.deepEqual(results[0].topRates.map((r) => r.providerName), ['호텔스닷컴'])
})

test('무성급·평점없음 호텔: starRating 0·guestRating 0·numberOfReviews 0·amenities []', async () => {
  const { results } = await adaptHotels(RAW)
  const g = results[1]
  assert.equal(g.starRating, 0)
  assert.equal(g.guestRating, 0)
  assert.equal(g.numberOfReviews, 0)
  assert.equal(g.propertyType, '게스트하우스') // 패싯 id 8
  assert.deepEqual(g.amenities, [])
})

test('availableRooms 누락 → 99 폴백(거짓 "잔여 0개"=매진 방지)', async () => {
  const { results } = await adaptHotels(RAW)
  // 게스트하우스 rate 에는 availableRooms 가 없음 → 99(임계 3 초과 → 앱 배지 미노출)
  assert.equal(results[1].topRates[0].availableRooms, 99)
  // 정상값은 보존
  assert.equal(results[0].topRates.find((r) => r.providerName === '호텔스닷컴').availableRooms, 3)
})

test('isCheapestRate: 정렬 후 최저가만 true (KAYAK 원본 플래그가 어긋나도 교정)', async () => {
  // KAYAK 가 비싼 rate 에 isCheapestRate=true 를 잘못 단 경우.
  const raw = {
    propertyTypes: [{ id: 0, name: '호텔' }],
    providers: [{ name: 'P0' }, { name: 'P1' }],
    results: [{
      id: 1, propertyType: 0, guestRating: 8, features: [],
      rates: [
        { totalRate: 200000, isCheapestRate: true, providerIndex: 0 }, // 비싼데 true(오류)
        { totalRate: 100000, isCheapestRate: false, providerIndex: 1 }, // 실제 최저가인데 false
      ],
    }],
  }
  const { results } = await adaptHotels(raw)
  const tr = results[0].topRates
  assert.equal(tr[0].totalRate, 100000) // 최저가가 [0]
  assert.equal(tr[0].isCheapestRate, true) // 교정됨
  assert.equal(tr[1].isCheapestRate, false) // 비싼 rate 는 false 로 교정
})

test('numberOfProviders 누락 → distinct 공급사 수 폴백(topRates 4건 상한에 과소표시 안 됨)', async () => {
  // 공급사 6곳·numberOfProviders 누락. topRates 는 4건으로 잘리지만 카운트는 6 이어야 함.
  const providers = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}` }))
  const rates = Array.from({ length: 6 }, (_, i) => ({ totalRate: 100000 + i * 1000, providerIndex: i }))
  const raw = {
    propertyTypes: [{ id: 0, name: '호텔' }],
    providers,
    results: [{ id: 1, propertyType: 0, guestRating: 8, features: [], rates }],
  }
  const { results } = await adaptHotels(raw)
  assert.equal(results[0].topRates.length, 4) // 표시용 상한
  assert.equal(results[0].numberOfProviders, 6) // 실제 공급사 수(과소표시 아님)
})

test('🔒 키 누출 0: 직렬화 결과에 apiKey 흔적 없음', async () => {
  const out = await adaptHotels(RAW)
  const json = JSON.stringify(out)
  assert.ok(!/apiKey/i.test(json))
  assert.ok(!json.includes('destination')) // href(키 포함) 통째 전달 안 함
})

test('direct-only 호텔(요금이 「사이트 직접 예약」뿐)은 목록에서 제외(가격 0개 방지·사용자 결정)', async () => {
  const raw = {
    propertyTypes: [{ id: 0, name: '호텔' }],
    providers: [{ name: '호텔스닷컴', isDirect: false }, { name: '사이트 직접 예약', isDirect: true }],
    results: [
      { id: 1, propertyType: 0, guestRating: 8, features: [], rates: [{ totalRate: 100000, providerIndex: 1 }] }, // direct 뿐 → 제외
      { id: 2, propertyType: 0, guestRating: 8, features: [], rates: [{ totalRate: 90000, providerIndex: 0 }] }, // 호텔스닷컴 → 유지
    ],
  }
  const { results, totalCount } = await adaptHotels(raw)
  assert.equal(results.length, 1)
  assert.equal(results[0].hotelId, '2') // direct-only 인 1번 호텔은 빠지고 2번만 남음
  assert.equal(totalCount, 1)
})

test('numberOfProviders: 끼어 있던 direct 공급사 종 수만큼 차감 + direct 요금은 topRates 제외', async () => {
  const raw = {
    propertyTypes: [{ id: 0, name: '호텔' }],
    providers: [{ name: 'A', isDirect: false }, { name: '사이트 직접 예약', isDirect: true }],
    results: [{
      id: 1, propertyType: 0, guestRating: 8, features: [], numberOfProviders: 5, // KAYAK 전체(direct 포함)
      rates: [{ totalRate: 100000, providerIndex: 0 }, { totalRate: 110000, providerIndex: 1 }], // direct(1) 포함
    }],
  }
  const { results } = await adaptHotels(raw)
  assert.equal(results[0].numberOfProviders, 4) // 5 − 1(direct)
  assert.deepEqual(results[0].topRates.map((r) => r.providerName), ['A']) // direct 빠짐
})

test('무효 요금 드롭(상세와 동일 기준·codex #4): ₩0·음수·providerIndex 범위밖/누락 제외', async () => {
  const raw = {
    propertyTypes: [{ id: 0, name: '호텔' }],
    providers: [{ name: 'A', isDirect: false }],
    results: [{ id: 1, propertyType: 0, guestRating: 8, features: [], rates: [
      { totalRate: 100000, providerIndex: 0 }, // 정상
      { totalRate: 0, providerIndex: 0 }, // ₩0 → 드롭
      { totalRate: -5, providerIndex: 0 }, // 음수 → 드롭
      { totalRate: 90000, providerIndex: 5 }, // 범위밖(provider 없음) → 드롭
      { totalRate: 80000 }, // providerIndex 누락 → 드롭
    ] }],
  }
  const { results } = await adaptHotels(raw)
  assert.equal(results.length, 1)
  assert.equal(results[0].topRates.length, 1) // 정상 1건만
  assert.equal(results[0].topRates[0].totalRate, 100000)
  assert.equal(results[0].topRates[0].providerName, 'A')
})

test('빈 응답 방어', async () => {
  assert.deepEqual(await adaptHotels({}), { results: [], totalCount: 0 })
  assert.deepEqual(await adaptHotels(null), { results: [], totalCount: 0 })
})
