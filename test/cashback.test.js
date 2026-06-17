/**
 * 캐시백 어댑터 단위 테스트 — KAYAK Reporting transactions/hotels → 앱 CashbackTxn[] (S5).
 * 픽스처는 reporting_v2.raml 예시 + 라이브 구조를 본뜬 합성 데이터(비밀·apiKey 없음).
 * ET 정산 경과 판정은 now 를 주입해 결정적으로 검증한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adaptTransactions,
  resolveStatus,
  isSettlementPassed,
  isBooking,
  pickCashbackAmount,
  isKrwAccount,
  toYmd,
  toYearMonth,
  roundKrw,
} from '../src/adapters/cashback.js'

// 정산월 2026-04 의 임계 = 2026-04-26 ET. 오프셋 영향 없는 정오(UTC)로 경계 검증.
const NOW_PASSED = new Date('2026-05-15T12:00:00Z') // 2026-03 정산(2026-04-26 ET) 경과
const NOW_BEFORE = new Date('2026-04-25T12:00:00Z') // 2026-03 정산 직전(ET 25일)
const NOW_ON_26 = new Date('2026-04-26T12:00:00Z') // 임계 당일(ET 26일) → 경과

function booking(over = {}) {
  return {
    transactionType: { name: 'Booking', typeCode: 10 },
    transactionStatus: { name: 'Active', statusCode: 1 },
    bookingDate: '2026-03-10T00:00:00',
    date: '2026-03-10T00:00:00',
    hotelName: '테스트 호텔',
    hotelCity: '서울',
    siteBrandCode: 'Kayak',
    localisedCurrencyCode: 'KRW',
    localisedBookingValue: 178000.4,
    cashbackAmountLocalised: 8900.6,
    paymentMonth: '2026-03-01T00:00:00',
    ...over,
  }
}

// ── 포맷 헬퍼 ──
test('toYmd: ISO 류 → YYYY-MM-DD(타임존 밀림 없음·오프셋 무시), 빈/오류 → ""', () => {
  assert.equal(toYmd('2023-07-02T00:00:00'), '2023-07-02')
  assert.equal(toYmd('2023-07-02T00:00:00+09:00'), '2023-07-02') // 타임존 오프셋 포함도 앞 10자
  assert.equal(toYmd('2026-03-10'), '2026-03-10')
  assert.equal(toYmd(''), '')
  assert.equal(toYmd(null), '')
  assert.equal(toYmd('not-a-date'), '')
})

test('toYearMonth: date → YYYY-MM, 빈 → ""', () => {
  assert.equal(toYearMonth('2026-07-01T00:00:00'), '2026-07')
  assert.equal(toYearMonth(null), '')
})

test('roundKrw: 반올림, 비유한수·음수 → 0', () => {
  assert.equal(roundKrw(8900.6), 8901)
  assert.equal(roundKrw(178000.4), 178000)
  assert.equal(roundKrw(undefined), 0)
  assert.equal(roundKrw(NaN), 0)
  assert.equal(roundKrw(Infinity), 0)
  assert.equal(roundKrw(-8901), 0) // 음수(데이터 이상) → 0 클램프(적대리뷰)
})

test('isKrwAccount: KRW/누락 → true, 비KRW → false', () => {
  assert.equal(isKrwAccount({ localisedCurrencyCode: 'KRW' }), true)
  assert.equal(isKrwAccount({}), true) // 필드 누락 → KRW 계정 간주
  assert.equal(isKrwAccount({ localisedCurrencyCode: 'EUR' }), false)
  assert.equal(isKrwAccount({ localisedCurrencyCode: 'USD' }), false)
})

// ── 정산 경과 추론(ET) ──
test('isSettlementPassed: 다음 달 26일(ET) 이후면 true', () => {
  assert.equal(isSettlementPassed('2026-03', NOW_BEFORE), false) // ET 2026-04-25
  assert.equal(isSettlementPassed('2026-03', NOW_ON_26), true) // ET 2026-04-26(임계 당일)
  assert.equal(isSettlementPassed('2026-03', NOW_PASSED), true)
  assert.equal(isSettlementPassed('', NOW_PASSED), false)
  assert.equal(isSettlementPassed('bad', NOW_PASSED), false)
})

test('isSettlementPassed: 연말 롤오버(2026-12 → 2027-01-26)', () => {
  assert.equal(isSettlementPassed('2026-12', new Date('2027-01-26T12:00:00Z')), true)
  assert.equal(isSettlementPassed('2026-12', new Date('2027-01-20T12:00:00Z')), false)
})

// ── 상태 판정 [10] ──
test('resolveStatus: Cancelled(11)', () => {
  assert.equal(resolveStatus(booking({ transactionStatus: { statusCode: 11 } }), NOW_PASSED), 'Cancelled')
})

test('resolveStatus: Active + 정산 경과 → Approved(추론)', () => {
  assert.equal(resolveStatus(booking(), NOW_PASSED), 'Approved')
})

test('resolveStatus: Active + 정산 전 → Waiting', () => {
  assert.equal(resolveStatus(booking(), NOW_BEFORE), 'Waiting')
})

test('resolveStatus: Active + paymentMonth 없음 → Waiting(과대표시 금지)', () => {
  assert.equal(resolveStatus(booking({ paymentMonth: null }), NOW_PASSED), 'Waiting')
})

test('resolveStatus: Unknown(0)·status 누락 → Waiting', () => {
  assert.equal(resolveStatus(booking({ transactionStatus: { statusCode: 0 } }), NOW_PASSED), 'Waiting')
  assert.equal(resolveStatus(booking({ transactionStatus: undefined }), NOW_PASSED), 'Waiting')
})

// ── Booking 필터 [D4] ──
test('isBooking: typeCode 10만 true', () => {
  assert.equal(isBooking(booking()), true)
  assert.equal(isBooking(booking({ transactionType: { typeCode: 1 } })), false) // Lead
  assert.equal(isBooking(booking({ transactionType: undefined })), false)
  assert.equal(isBooking({ bookingDate: '2026-03-10', transactionType: { typeCode: 1 } }), false) // bookingDate 있어도 Lead 제외
})

// ── 캐시백 금액 폴백 [D5] ──
test('pickCashbackAmount: localised 우선', () => {
  assert.equal(pickCashbackAmount(booking()), 8901)
})

test('pickCashbackAmount: localised 부재 + KRW + USD×환율 폴백', () => {
  const t = booking({ cashbackAmountLocalised: undefined, cashbackAmountUSD: 6.5, exchangeRate: 1300 })
  assert.equal(pickCashbackAmount(t), 8450) // round(6.5 * 1300)
})

test('pickCashbackAmount: localised 부재 + 비KRW → 0(과대표시 방지)', () => {
  const t = booking({ cashbackAmountLocalised: undefined, localisedCurrencyCode: 'USD', cashbackAmountUSD: 6.5, exchangeRate: 1 })
  assert.equal(pickCashbackAmount(t), 0)
})

test('pickCashbackAmount: localised·USD 모두 부재 → 0', () => {
  const t = booking({ cashbackAmountLocalised: undefined, cashbackAmountUSD: undefined })
  assert.equal(pickCashbackAmount(t), 0)
})

test('pickCashbackAmount: localised 있어도 비KRW 계정 → 0(통화 오표기 방지·적대리뷰)', () => {
  const t = booking({ localisedCurrencyCode: 'EUR', cashbackAmountLocalised: 25 })
  assert.equal(pickCashbackAmount(t), 0)
})

test('pickCashbackAmount: 음수 → 0(클램프)', () => {
  const t = booking({ cashbackAmountLocalised: -8900 })
  assert.equal(pickCashbackAmount(t), 0)
})

// ── adaptTransactions 통합 ──
test('adaptTransactions: Lead 제외·Booking 포함·필드 매핑·정렬(최근 먼저)', () => {
  const raw = [
    { transactionType: { typeCode: 1 }, transactionStatus: { statusCode: 1 }, bookingDate: '2026-06-01' }, // Lead → 제외
    booking({ bookingDate: '2026-03-10T00:00:00', paymentMonth: '2026-03-01T00:00:00' }), // Approved
    booking({
      bookingDate: '2026-06-03T00:00:00',
      hotelName: '포시즌스 호텔 서울',
      siteBrandCode: 'HotelsCombined',
      localisedBookingValue: 620000,
      cashbackAmountLocalised: 37200,
      transactionStatus: { statusCode: 1 },
      paymentMonth: '2026-08-01T00:00:00', // 정산 전 → Waiting
    }),
    booking({ bookingDate: '2026-04-20T00:00:00', transactionStatus: { statusCode: 11 } }), // Cancelled
  ]
  const out = adaptTransactions(raw, { now: NOW_PASSED })

  assert.equal(out.length, 3) // Lead 1건 제외
  // 정렬: 2026-06-03 → 2026-04-20 → 2026-03-10
  assert.deepEqual(out.map((t) => t.bookingDate), ['2026-06-03', '2026-04-20', '2026-03-10'])
  assert.deepEqual(out.map((t) => t.status), ['Waiting', 'Cancelled', 'Approved'])

  const fs = out[0]
  assert.equal(fs.hotelName, '포시즌스 호텔 서울')
  assert.equal(fs.hotelCity, '서울')
  assert.equal(fs.siteBrandCode, 'HotelsCombined')
  assert.equal(fs.localisedBookingValue, 620000)
  assert.equal(fs.cashbackAmountLocalised, 37200)
  assert.equal(fs.paymentMonth, '2026-08')
  // CashbackTxn 8필드 정확히
  assert.deepEqual(Object.keys(fs).sort(), [
    'bookingDate', 'cashbackAmountLocalised', 'hotelCity', 'hotelName',
    'localisedBookingValue', 'paymentMonth', 'siteBrandCode', 'status',
  ])
})

test('adaptTransactions: 비배열·빈·래퍼 방어', () => {
  assert.deepEqual(adaptTransactions(null), [])
  assert.deepEqual(adaptTransactions(undefined), [])
  assert.deepEqual(adaptTransactions({}), [])
  assert.deepEqual(adaptTransactions('oops'), [])
  assert.deepEqual(adaptTransactions([]), [])
  // {data:[...]} 래퍼도 인식
  const wrapped = { data: [booking()] }
  assert.equal(adaptTransactions(wrapped, { now: NOW_PASSED }).length, 1)
})

test('adaptTransactions: 비KRW 거래는 금액 0(오표기 방지)', () => {
  const raw = [booking({ localisedCurrencyCode: 'EUR', localisedBookingValue: 2000, cashbackAmountLocalised: 100 })]
  const [t] = adaptTransactions(raw, { now: NOW_PASSED })
  assert.equal(t.localisedBookingValue, 0) // EUR 2000 을 ₩2,000 으로 오표기하지 않음
  assert.equal(t.cashbackAmountLocalised, 0)
})

test('adaptTransactions: 동일 bookingDate 정렬 결정성(호텔명 asc → 캐시백 desc)', () => {
  const raw = [
    booking({ bookingDate: '2026-03-10', hotelName: '나 호텔', cashbackAmountLocalised: 1000 }),
    booking({ bookingDate: '2026-03-10', hotelName: '가 호텔', cashbackAmountLocalised: 2000 }),
    booking({ bookingDate: '2026-03-10', hotelName: '가 호텔', cashbackAmountLocalised: 5000 }),
  ]
  // 입력 순서를 바꿔도 동일 결과여야 결정적.
  const out1 = adaptTransactions(raw, { now: NOW_PASSED })
  const out2 = adaptTransactions(raw.slice().reverse(), { now: NOW_PASSED })
  const sig = (o) => o.map((t) => `${t.hotelName}:${t.cashbackAmountLocalised}`).join('|')
  assert.equal(sig(out1), sig(out2))
  // 가 호텔(5000) → 가 호텔(2000) → 나 호텔(1000)
  assert.deepEqual(out1.map((t) => `${t.hotelName}:${t.cashbackAmountLocalised}`), ['가 호텔:5000', '가 호텔:2000', '나 호텔:1000'])
})

test('adaptTransactions: 누락 필드 안전 매핑(빈 문자열·0)', () => {
  const raw = [{ transactionType: { typeCode: 10 }, transactionStatus: { statusCode: 1 } }]
  const [t] = adaptTransactions(raw, { now: NOW_PASSED })
  assert.equal(t.hotelName, '')
  assert.equal(t.hotelCity, '')
  assert.equal(t.siteBrandCode, '')
  assert.equal(t.bookingDate, '')
  assert.equal(t.localisedBookingValue, 0)
  assert.equal(t.cashbackAmountLocalised, 0)
  assert.equal(t.paymentMonth, '')
  assert.equal(t.status, 'Waiting') // paymentMonth 없음 → Waiting
})
