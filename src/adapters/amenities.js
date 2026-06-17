/**
 * 편의시설 버킷 매핑 — 검색 카드 amenities (#4).
 *
 * 배경(실측 2026-06-17):
 *  - 검색 다중호출에 responseOptions=features 를 넣으면 호텔마다 features:[숫자ID...] 가 온다(25/25 확인).
 *  - KAYAK facility 카탈로그는 ≈298종으로 매우 세분(예: '와이파이' '무료 와이파이' '전 구역 와이파이 사용 가능'
 *    '와이파이(유료)' 가 전부 별개 ID).
 *  - 앱 편의시설 필터는 고정 15개 버킷(아래 BUCKETS 키)이며, 옵션은 결과 집합의 amenities 에서 도출되고
 *    매칭은 정확 문자열 AND. 즉 raw 라벨을 그대로 넣으면 100+개의 잡다한 칩이 생겨 필터가 망가진다.
 *
 * 결정(codex 교차검토 채택):
 *  - raw 라벨 dump 거부. KAYAK facility ID → 앱 15버킷 라벨의 **정적 큐레이션 맵**을 둔다.
 *  - 버킷 라벨의 의미를 어기지 않는다:
 *     · '무료 WiFi' = 명시적 무료/일반 와이파이·인터넷만. **명시적 유료(389 와이파이 유료·362 인터넷 추가요금)는 제외.**
 *       (일반 '와이파이'(13)·'전 구역 와이파이'(778)는 국내 관행상 무료가 대다수라 포함하되, 유료 표기 ID 는 절대 무료로 분류하지 않는다.)
 *     · '주차' = 무료·유료·발레·장기 등 주차 일반(존재=주차 가능). 유료 포함 OK(라벨이 '무료'가 아님).
 *     · '반려동물' = 동반 가능만(363 '반려동물 동반 불가'는 제외).
 *
 * 카탈로그에 없는 신규 ID 는 무시(graceful) — 필터 무결성 우선. 새 ID 편입은 이 맵만 갱신.
 */

/**
 * 버킷 → KAYAK facility ID 집합. (라벨은 앱 AMENITY_CATALOG 와 1:1 일치해야 필터가 자연스럽다.)
 * ID 근거: constants-mapping?types=facility (ko_KR) 실측 카탈로그.
 */
const BUCKETS = {
  '무료 WiFi': [388, 361, 13, 11, 778], // 무료 와이파이·무료 인터넷·와이파이·인터넷·전 구역 와이파이 (유료 389·362 제외)
  주차: [77, 364, 365, 366, 367, 385, 393, 431, 617, 639, 665, 717, 753], // 주차 일반(무료·유료·발레·장기·실내·전용·장애인)
  조식: [105, 359, 465, 1065], // 조식 포함·컨티넨탈 조식·조식 객실 배달
  수영장: [371, 57, 58, 56, 547, 563, 619, 621, 655, 659, 414], // 실내/실외/어린이/온수/인피니티/루프탑/소금물/수영장 바
  피트니스: [335, 949, 969, 1093], // 피트니스 센터·피트니스 룸·헬스클럽·피트니스 클래스
  스파: [52, 899, 411, 790, 713, 555, 605], // 스파·스파웰니스·마사지·하맘·스파욕조·온천탕·노천탕
  반려동물: [394], // 요청 시 반려동물 동반 가능 (363 '불가'는 제외)
  공항셔틀: [230, 355, 356], // 공항 셔틀·무료·추가요금
  레스토랑: [72, 1157], // 레스토랑·레스토랑 및 바
  '바/라운지': [73, 1157, 1159, 697], // 바/라운지·레스토랑 및 바·테라스 라운지·스낵 바
  비즈니스센터: [7, 26, 1153, 782], // 비즈니스 센터·회의/연회 시설·컨퍼런스룸·팩스/복사
  금연객실: [67, 392], // 금연·금연 객실 이용 가능
  세탁: [24, 25, 386, 765, 935], // 세탁 시설·세탁 서비스·객실 내 세탁기/건조기·세탁기·동전세탁기
  '24시간 프런트': [124, 423, 422], // 프런트 24시간 운영·24시간 체크인·24시간 컨시어지
}

/** 앱 카탈로그 노출 순서(filters.ts AMENITY_CATALOG 와 동일). 결과 amenities 정렬에 사용. */
export const AMENITY_ORDER = [
  '무료 WiFi', '주차', '조식', '수영장', '피트니스', '스파', '반려동물',
  '공항셔틀', '레스토랑', '바/라운지', '사우나', '비즈니스센터', '금연객실', '세탁', '24시간 프런트',
]

// 사우나는 별도 버킷(스파와 구분). 한증막실(382) 포함.
BUCKETS['사우나'] = [225, 382]

/**
 * 버킷 라벨 → 앱 상세(HotelDetail.facilities)의 tag 슬러그 (S3).
 * - 앱 Detail.tsx 가 facilities 를 `key={f.tag}` 로 렌더 → tag 는 **유니크**해야 한다(중복 시 React key 충돌).
 * - 앱 FAC_ICON(wifi/parking/breakfast/poolspa/fitness/frontdesk24) 6키와 일치하는 것만 전용 아이콘,
 *   나머지는 앱이 IconCheck 로 폴백한다(앱 무변경). 그래서 슬러그를 라벨마다 유니크하게 부여한다.
 */
const BUCKET_TAG = {
  '무료 WiFi': 'wifi',        // FAC_ICON ✓ IconWifi
  주차: 'parking',           // FAC_ICON ✓ IconParking
  조식: 'breakfast',         // FAC_ICON ✓ IconRestaurant
  수영장: 'poolspa',         // FAC_ICON ✓ IconPool
  피트니스: 'fitness',        // FAC_ICON ✓ IconFitness
  '24시간 프런트': 'frontdesk24', // FAC_ICON ✓ IconClock
  스파: 'spa',
  반려동물: 'pet',
  공항셔틀: 'shuttle',
  레스토랑: 'restaurant',
  '바/라운지': 'bar',
  사우나: 'sauna',
  비즈니스센터: 'business',
  금연객실: 'nonsmoking',
  세탁: 'laundry',
}

/** facility ID → 버킷 라벨들(역색인). 한 ID 가 여러 버킷에 속할 수 있음(예: 1157→레스토랑·바/라운지). */
const ID_TO_BUCKETS = (() => {
  const m = new Map()
  for (const [label, ids] of Object.entries(BUCKETS)) {
    for (const id of ids) {
      const arr = m.get(id) ?? []
      arr.push(label)
      m.set(id, arr)
    }
  }
  return m
})()

/** features(숫자 ID 배열) → 존재하는 버킷 라벨(카탈로그 순서·중복 제거). 내부 공통. */
function presentBuckets(features) {
  if (!Array.isArray(features) || !features.length) return []
  const present = new Set()
  for (const id of features) {
    const labels = ID_TO_BUCKETS.get(id)
    if (labels) for (const l of labels) present.add(l)
  }
  return AMENITY_ORDER.filter((l) => present.has(l))
}

/**
 * 호텔의 features(숫자 ID 배열) → 앱 amenities 라벨 배열(검색 카드용·#4).
 * @param {number[]} features
 * @returns {string[]}
 */
export function featuresToAmenities(features) {
  return presentBuckets(features)
}

/**
 * 호텔의 features(숫자 ID 배열) → 앱 상세 facilities {tag,label}[] (S3·#20).
 * 검색 카드(라벨만)와 달리 상세는 tag(아이콘 매칭·유니크 key)가 필요하다.
 * raw 라벨 119개를 그대로 넣지 않고 S2 와 동일한 15버킷으로 큐레이션해 그리드 파손을 막는다(codex 동의).
 * @param {number[]} features
 * @returns {{tag:string,label:string}[]}
 */
export function featuresToFacilities(features) {
  return presentBuckets(features).map((label) => ({ tag: BUCKET_TAG[label], label }))
}

/** 테스트·검수용: 버킷 정의 노출(읽기 전용 사본). */
export function _buckets() {
  return Object.fromEntries(Object.entries(BUCKETS).map(([k, v]) => [k, [...v]]))
}
