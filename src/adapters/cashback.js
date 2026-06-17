/**
 * 캐시백 리포팅 어댑터 — KAYAK Reporting `transactions/hotels` → 앱 CashbackTxn[] (S5).
 *
 * 순수 함수(네트워크·전역상태 없음·`now` 주입 가능)로 단위 테스트가 결정적이게 한다.
 * 핵심 결정(CODEX_REVIEW_POINTS S5·codex 자문 2026-06-17):
 *  - [10] 상태판정: Reporting 응답에 'Approved' 상태값이 없다(Active=1/Cancelled=11뿐).
 *      · statusCode 11 → 'Cancelled'
 *      · statusCode 1(Active) + paymentMonth 있음 + ET 정산 경과 → 'Approved'(추론)
 *      · 그 외(Active·정산 전 / Unknown / 누락) → 'Waiting'(보수적·과대표시 금지)
 *      ⚠ paymentMonth 가 채워졌다는 사실만으로 Approved 단정 금지(가이드 §8). 정산 경과를
 *        'ET 기준 paymentMonth 다음 달 26일 00:00 이후'로 보수적 추론(codex 정교화 D3).
 *  - [D4] Booking(transactionType.typeCode===10)만 포함. Lead(클릭·typeCode 1)는 제외.
 *      typeCode 누락+bookingDate만 있는 경우도 제외(명시 booking type 만 신뢰).
 *  - [D5] 금액 KRW 정수 반올림. cashbackAmountLocalised 부재 시 USD×환율 폴백은
 *      localisedCurrencyCode==='KRW' + 유한수 + 환율>0 일 때만(과대표시 방지).
 *  - siteBrandCode 는 KAYAK 사이트 브랜드(Kayak/HotelsCombined)이며 OTA 공급사가 아니다
 *      (Reporting 응답에 OTA/provider 필드 없음). 가이드 §8대로 직매핑하되 의미 주의.
 */

/** KAYAK transactionType.typeCode: Lead=1, Booking=10, Unknown=0. */
const TYPE_BOOKING = 10
/** KAYAK transactionStatus.statusCode: Active=1, Cancelled=11, Unknown=0. */
const STATUS_ACTIVE = 1
const STATUS_CANCELLED = 11

// 정산 경과 추론 임계 '일'(ET 기준 paymentMonth 다음 달 N일 00:00 이후 → Approved).
// QA: paymentMonth 익월 15~25일 정산 → 26일 이후를 '경과'로 보수적 판정(codex D3).
const SETTLE_DAY = Number(process.env.CASHBACK_SETTLE_DAY ?? 26)

/** Date|string → 'YYYY-MM-DD'(빈 입력/파싱 실패 시 ''). KAYAK date 예: '2023-07-02T00:00:00'. */
export function toYmd(value) {
  if (!value) return ''
  const s = String(value)
  // 이미 ISO 류면 앞 10자만 취해도 안전(로컬 타임존 변환으로 날짜가 밀리는 것 방지).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

/** Date|string → 'YYYY-MM'(빈 입력/파싱 실패 시 ''). paymentMonth 포맷 변환. */
export function toYearMonth(value) {
  const ymd = toYmd(value)
  return ymd ? ymd.slice(0, 7) : ''
}

/** 정수 KRW 반올림. 유한수 아니면 0. 음수(데이터 이상)는 0으로 클램프(음수 금액 표시 방지·적대리뷰). */
export function roundKrw(n) {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * 거래 통화가 KRW 계정인지(QA Q3: localisedCurrencyCode 는 계정 단위 단일 설정·현재 KRW 고정).
 * 비KRW 거래(데이터 이상·계정 설정상 발생 안 함)는 금액을 KRW 로 오표기하지 않도록 0 처리한다(적대리뷰).
 * 필드 누락 시 KRW 계정으로 간주(우리 계정은 KRW 고정·필드 생략 가능).
 */
export function isKrwAccount(txn) {
  const c = txn?.localisedCurrencyCode
  return c == null || c === 'KRW'
}

/** now(Date) 의 미국 동부시간(ET) 연·월·일. 리포트가 ET 기준이므로 정산 경과를 ET 로 판정. */
function etDateParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/**
 * 정산 경과 추론 — paymentMonth('YYYY-MM') 다음 달 SETTLE_DAY일(ET) 이후면 true.
 * ⚠ 포털 'Approved' 직접 확인이 아니라 정산일 경과 추론이다(함수명·주석에 명시).
 * @param {string} paymentMonth 'YYYY-MM'
 * @param {Date} now
 * @returns {boolean}
 */
export function isSettlementPassed(paymentMonth, now) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(paymentMonth ?? ''))
  if (!m) return false
  let sy = Number(m[1])
  let sm = Number(m[2]) + 1 // 정산월 = paymentMonth 다음 달
  if (sm > 12) {
    sm -= 12
    sy += 1
  }
  const { y, m: cm, d } = etDateParts(now)
  if (!Number.isFinite(y)) return false
  const nowNum = y * 10000 + cm * 100 + d
  const threshNum = sy * 10000 + sm * 100 + SETTLE_DAY
  return nowNum >= threshNum
}

/**
 * 거래 1건의 앱 상태 판정([10]).
 * @param {object} txn KAYAK transaction
 * @param {Date} now
 * @returns {'Waiting'|'Approved'|'Cancelled'}
 */
export function resolveStatus(txn, now) {
  const statusCode = txn?.transactionStatus?.statusCode
  if (statusCode === STATUS_CANCELLED) return 'Cancelled'
  if (statusCode === STATUS_ACTIVE) {
    const paymentMonth = toYearMonth(txn?.paymentMonth)
    if (paymentMonth && isSettlementPassed(paymentMonth, now)) return 'Approved'
    return 'Waiting'
  }
  // Unknown(0)·누락 → 보수적으로 Waiting(Approved 로 과대표시하지 않는다).
  return 'Waiting'
}

/** Booking(예약) 거래인지 — typeCode===10 만 신뢰(Lead/클릭 제외, D4). */
export function isBooking(txn) {
  return txn?.transactionType?.typeCode === TYPE_BOOKING
}

/**
 * 캐시백 금액(현지화·KRW 정수). cashbackAmountLocalised 우선.
 * 부재 시 USD×환율 폴백은 유한수 + 환율>0 일 때만(D5·과대표시 방지). 아니면 0.
 * ⚠ 비KRW 계정 거래(데이터 이상)는 0(통화 오표기 방지·적대리뷰). 음수는 roundKrw 가 0으로 클램프.
 */
export function pickCashbackAmount(txn) {
  if (!isKrwAccount(txn)) return 0
  if (Number.isFinite(txn?.cashbackAmountLocalised)) return roundKrw(txn.cashbackAmountLocalised)
  const usd = txn?.cashbackAmountUSD
  const rate = txn?.exchangeRate
  if (Number.isFinite(usd) && Number.isFinite(rate) && rate > 0) {
    return roundKrw(usd * rate)
  }
  return 0
}

/** KAYAK 응답을 거래 배열로 정규화(바 배열 / {data|transactions|items} 래퍼 / 그 외 → []). */
function toTransactionArray(raw) {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    for (const k of ['data', 'transactions', 'items', 'results']) {
      if (Array.isArray(raw[k])) return raw[k]
    }
  }
  return []
}

/** 단일 거래 → 앱 CashbackTxn. */
function mapTxn(txn, now) {
  return {
    bookingDate: toYmd(txn?.bookingDate || txn?.date),
    hotelName: String(txn?.hotelName ?? ''),
    hotelCity: String(txn?.hotelCity ?? ''),
    // ⚠ KAYAK 사이트 브랜드(Kayak/HotelsCombined)이며 OTA 공급사가 아니다(Reporting 미제공).
    siteBrandCode: String(txn?.siteBrandCode ?? ''),
    // 비KRW 계정 거래(데이터 이상)는 0 — KRW 로 오표기하지 않는다(적대리뷰·pickCashbackAmount 와 일관).
    localisedBookingValue: isKrwAccount(txn) ? roundKrw(txn?.localisedBookingValue) : 0,
    cashbackAmountLocalised: pickCashbackAmount(txn),
    status: resolveStatus(txn, now),
    paymentMonth: toYearMonth(txn?.paymentMonth),
  }
}

/**
 * KAYAK TransactionsResponse[] → 앱 CashbackTxn[].
 * Booking 만 포함 → 매핑 → bookingDate 내림차순(최근 예약 먼저) 정렬.
 * @param {any} raw KAYAK 리포팅 응답(배열 또는 래퍼)
 * @param {{now?: Date}} opts now 주입(테스트 결정성). 기본 현재시각.
 * @returns {Array<object>} CashbackTxn[]
 */
export function adaptTransactions(raw, { now = new Date() } = {}) {
  return toTransactionArray(raw)
    .filter(isBooking)
    .map((t) => mapTxn(t, now))
    // bookingDate 내림차순. 동일 날짜는 결정적 순서를 위해 호텔명·캐시백액으로 tie-break(적대리뷰: 불안정 정렬 고정).
    .sort((a, b) => {
      if (a.bookingDate !== b.bookingDate) return a.bookingDate < b.bookingDate ? 1 : -1
      if (a.hotelName !== b.hotelName) return a.hotelName.localeCompare(b.hotelName)
      return b.cashbackAmountLocalised - a.cashbackAmountLocalised
    })
}
