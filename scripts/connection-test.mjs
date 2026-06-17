/**
 * S1 연결 테스트 — 중계 서버의 KAYAK 연결 계층(src/kayak/*)을 직접 호출해
 * "개발실 IP에서 200 + 실데이터"를 증명한다. HTTP 라우트(/api/*)는 S2에서 연결되므로
 * 여기서는 endpoints 헬퍼를 서버측에서 직접 호출(연결 계층 단위 검증).
 *
 * 실행: npm run test:connect   (개발실 IP=58.75.223.130 망에서만 200)
 * 검증 항목: ① 자동완성 200+후보  ② 검색 200+폴링 완료+실호텔/가격  ③(보조) 정적피드 NDJSON
 */
import { config, missingSecrets } from '../src/config.js'
import { autocomplete, searchHotels, getConstantsMapping } from '../src/kayak/endpoints.js'

const FALLBACK_SEOUL = 'kplace:22028' // 가이드 실측(totalResults 1247)
const QUERY = process.argv[2] ?? '서울'

function ymd(daysFromNow) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

/** 응답이 배열이든 {records|results|data:[...]} 든 첫 배열을 꺼낸다(자동완성 형태 미상 대비). */
function firstArray(resp) {
  if (Array.isArray(resp)) return resp
  if (resp && typeof resp === 'object') {
    for (const v of Object.values(resp)) if (Array.isArray(v)) return v
  }
  return []
}

function line(s = '') {
  process.stdout.write(s + '\n')
}

async function main() {
  line('═'.repeat(60))
  line('  Meta-API S1 연결 테스트')
  line('═'.repeat(60))
  line(`KAYAK host : ${config.kayakHost}`)
  line(`검색 UA    : ${config.searchUserAgent.slice(0, 40)}…`)
  line(`client IP  : ${config.devClientIp} (검색 x-original-client-ip)`)
  const missing = missingSecrets()
  if (missing.includes('KAYAK_API_KEY')) {
    line('\n❌ KAYAK_API_KEY 미설정 — .env 확인 필요. 중단.')
    process.exitCode = 1
    return
  }
  line(`키 로드    : ${missing.length ? '⚠ 일부 누락 ' + missing.join(',') : '✓ 전체'}`)

  let ok = true

  // ── ① 자동완성 ──────────────────────────────
  line('\n[1] 자동완성  GET /api/affiliate/autocomplete/v1/hotels?searchTerm=' + QUERY)
  let destination = FALLBACK_SEOUL
  try {
    const t0 = Date.now()
    const ac = await autocomplete({ q: QUERY })
    const items = firstArray(ac)
    line(`    → 200 · 후보 ${items.length}건 · ${Date.now() - t0}ms`)
    items.slice(0, 5).forEach((it, i) =>
      line(`      ${i + 1}. ${it.entityKey} · ${it.primaryPlaceType ?? '?'} · ${it.fullName ?? it.hotelName ?? ''}`),
    )
    // 목적지로 쓸 첫 place(kplace) 선택 — 없으면 첫 후보, 그것도 없으면 폴백.
    const place = items.find((it) => String(it.entityKey).startsWith('kplace:')) ?? items[0]
    if (place?.entityKey) destination = place.entityKey
    line(`    선택 목적지: ${destination}`)
  } catch (e) {
    ok = false
    line(`    ❌ 실패: ${e.code ?? ''} ${e.message}`)
  }

  // ── ② 검색(다중) + 폴링 ─────────────────────
  const checkin = ymd(30)
  const checkout = ymd(31)
  line(`\n[2] 검색  GET /api/3.0/hotels  destination=${destination} checkin=${checkin} checkout=${checkout} rooms=2`)
  line('    (헤더 UA + x-original-client-ip · isComplete 폴링)')
  try {
    const t0 = Date.now()
    const r = await searchHotels({
      destination,
      checkin,
      checkout,
      rooms: '2',
      clientIp: config.devClientIp,
      userTrackId: 's1-connection-test',
      pageSize: 25,
    })
    const results = firstArray(r.results ?? r)
    line(`    → 200 · isComplete=${r.isComplete} · totalResults=${r.totalResults} · 반환 ${results.length}건 · ${Date.now() - t0}ms`)
    line(`    통화=${r.currencyCode} 언어=${r.languageCode} 최저가=${r.lowestTotalRate} 최고가=${r.highestTotalRate}`)
    const h = results[0]
    if (h) {
      const rate = (h.rates ?? [])[0]
      const prov = rate ? (r.providers ?? [])[rate.providerIndex] : null
      line(`    첫 호텔: ${h.name} · ★${h.starRating} · 평점 ${h.guestRating}/10(리뷰 ${h.numberOfReviews}) · 공급사 ${h.numberOfProviders}`)
      if (rate) {
        line(`      최저요금: ${rate.totalRate} ${r.currencyCode} · 공급사=${prov?.name ?? '?'} · 무료취소=${rate.hasFreeCancellation}`)
        line(`      cashback: ${prov?.cashback ? JSON.stringify(prov.cashback) : '없음'}`)
        line(`      bookUri host: ${rate.bookUri ? new URL(rate.bookUri).host : '없음'} (a=, p= 포함 딥링크)`)
      }
      if (!results.length || !rate) ok = false
    } else {
      line('    ⚠ 결과 0건 — 날짜/목적지 확인 필요.')
      ok = false
    }
  } catch (e) {
    ok = false
    line(`    ❌ 실패: ${e.code ?? ''} ${e.message}`)
    if (e.body) line(`       body: ${typeof e.body === 'string' ? e.body : JSON.stringify(e.body)}`)
  }

  // ── ③ (보조) 정적피드 NDJSON ────────────────
  line('\n[3] (보조) 정적피드 NDJSON  GET /api/4.0/constants-mapping?types=placeType')
  try {
    const t0 = Date.now()
    const rows = await getConstantsMapping({ types: 'placeType' })
    line(`    → 200 · NDJSON ${rows.length}행 · ${Date.now() - t0}ms · 예: ${JSON.stringify(rows[0] ?? {}).slice(0, 80)}`)
  } catch (e) {
    line(`    (보조 실패·S1 합격 영향 없음): ${e.code ?? ''} ${e.message}`)
  }

  line('\n' + '═'.repeat(60))
  line(ok ? '  ✅ S1 연결 테스트 통과 — 자동완성·검색 200 + 실데이터' : '  ❌ S1 연결 테스트 실패 — 위 오류 확인')
  line('═'.repeat(60))
  process.exitCode = ok ? 0 : 1
}

main().catch((e) => {
  console.error('예기치 못한 오류:', e)
  process.exitCode = 1
})
