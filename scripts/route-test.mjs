/**
 * S2 라우트 실측 — 실제 Express 앱(createApp)을 띄우고 /api/* 를 HTTP 로 호출해
 * "중계 경유로 앱 타입 실데이터가 나온다 + 키 누출 0"을 증명한다(개발실 IP 58.75.223.130 망에서만 200).
 *
 * 실행: npm run test:route
 * 검증: ① /health phase=S2-adapter  ② /api/autocomplete 앱 AutocompleteItem[]  ③ /api/hotels 앱 {results,totalCount}
 *       ④ 🔒 응답 본문에 apiKey 흔적 0  ⑤ 필수 파라미터 누락 → 400
 */
import { createApp } from '../src/app.js'

const PORT = Number(process.env.ROUTE_TEST_PORT ?? 8788)
const BASE = `http://127.0.0.1:${PORT}`
const L = (s = '') => process.stdout.write(s + '\n')
const ymd = (d) => {
  const x = new Date()
  x.setDate(x.getDate() + d)
  return x.toISOString().slice(0, 10)
}

let pass = true
const check = (cond, label, extra = '') => {
  L(`   ${cond ? '✔' : '✗'} ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) pass = false
}

async function main() {
  const app = createApp()
  const server = await new Promise((res) => {
    const s = app.listen(PORT, () => res(s))
  })
  L('═'.repeat(64))
  L(`  S3 라우트 실측  ${BASE}`)
  L('═'.repeat(64))

  try {
    // ① /health
    L('\n[1] GET /health')
    const health = await (await fetch(`${BASE}/health`)).json()
    check(health.phase === 'S3-detail', 'phase=S3-detail', health.phase)
    check(health.secretsLoaded === true, 'secretsLoaded=true (키 로드)', JSON.stringify(health.missingSecrets))

    // ② /api/autocomplete
    L('\n[2] GET /api/autocomplete?q=서울')
    const acRes = await fetch(`${BASE}/api/autocomplete?q=${encodeURIComponent('서울')}`)
    const acText = await acRes.text()
    check(acRes.status === 200, 'status 200', String(acRes.status))
    check(!/apiKey/i.test(acText), '🔒 응답에 apiKey 없음')
    let ac = []
    try { ac = JSON.parse(acText) } catch {}
    check(Array.isArray(ac) && ac.length > 0, 'AutocompleteItem[] 비어있지 않음', `${ac.length}건`)
    const APP_PLACE = new Set(['city', 'region', 'hotel', 'airport', 'neighborhood'])
    check(ac.every((it) => it.entityKey && APP_PLACE.has(it.primaryPlaceType)), '모든 항목 앱 PlaceType enum')
    check(ac.some((it) => 'fullname' in it), 'fullname(소문자) 필드 존재')
    ac.slice(0, 6).forEach((it) => L(`     - ${it.entityKey} · ${it.primaryPlaceType} · ${it.fullname ?? it.hotelName ?? ''}`))
    const dest = (ac.find((it) => it.entityKey.startsWith('kplace:')) ?? ac[0])?.entityKey ?? 'kplace:22028'

    // ③ /api/hotels
    const checkin = ymd(30), checkout = ymd(31)
    L(`\n[3] GET /api/hotels?destination=${dest}&checkin=${checkin}&checkout=${checkout}&rooms=2`)
    const t0 = Date.now()
    const hRes = await fetch(`${BASE}/api/hotels?destination=${encodeURIComponent(dest)}&checkin=${checkin}&checkout=${checkout}&rooms=2`)
    const hText = await hRes.text()
    L(`   (${Date.now() - t0}ms)`)
    check(hRes.status === 200, 'status 200', String(hRes.status))
    check(!/apiKey/i.test(hText), '🔒 응답에 apiKey 없음 (destination.href 미통과)')
    let body = {}
    try { body = JSON.parse(hText) } catch {}
    check(Array.isArray(body.results) && body.results.length > 0, '{results} 비어있지 않음', `${body.results?.length}건`)
    check(typeof body.totalCount === 'number' && body.totalCount === body.results?.length, 'totalCount=반환 건수', `${body.totalCount}`)
    check(typeof body.serverTotalResults === 'number', 'serverTotalResults(진단) 존재', `${body.serverTotalResults}`)
    const h = body.results?.[0]
    if (h) {
      L(`     첫 호텔: ${h.name} · ★${h.starRating} · 평점 ${h.guestRating}/5 · ${h.propertyType} · 공급사 ${h.numberOfProviders}`)
      L(`     amenities(${h.amenities.length}): ${h.amenities.join(', ')}`)
      const tr = h.topRates?.[0]
      L(`     최저요금: ${tr?.totalRate} (${tr?.providerName}/${tr?.providerLogo}) cashback=${JSON.stringify(tr?.cashback)}`)
      check(typeof h.name === 'string' && h.name.length > 0, '호텔명 존재')
      check(h.guestRating >= 0 && h.guestRating <= 5, 'guestRating 0~5 척도(#7)', String(h.guestRating))
      check(typeof h.propertyType === 'string' && !/^\d+$/.test(h.propertyType), 'propertyType 한글 라벨(AC5)', h.propertyType)
      check(Array.isArray(h.amenities), 'amenities 배열(#4)')
      check(Array.isArray(h.images), 'images 배열')
      check(Array.isArray(h.topRates) && h.topRates.length > 0, 'topRates 존재')
      // topRates[0] 이 최저가인지
      const minRate = Math.min(...h.topRates.map((r) => r.totalRate))
      check(tr?.totalRate === minRate, 'topRates[0]=최저가')
      check(tr && 'cashback' in tr && ['PERCENTAGE', 'NONE'].includes(tr.cashback.type), 'cashback 앱 타입(#5)')
      check(typeof tr?.bookUri === 'string' && tr.bookUri.includes('p='), 'bookUri 딥링크 보존(p= 자리·S4)')
    }

    // ④ 필수 파라미터 누락 → 400
    L('\n[4] GET /api/hotels (파라미터 누락) → 400')
    const bad = await fetch(`${BASE}/api/hotels`)
    const badBody = await bad.json().catch(() => ({}))
    check(bad.status === 400 && badBody.error === 'MISSING_SEARCH_PARAMS', '400 MISSING_SEARCH_PARAMS', `${bad.status}/${badBody.error}`)

    // ⑤ de-dupe: 동시 2회 → 둘 다 200
    L('\n[5] de-dupe: 동일조건 동시 2회 → 둘 다 200')
    const [d1, d2] = await Promise.all([
      fetch(`${BASE}/api/hotels?destination=${encodeURIComponent(dest)}&checkin=${checkin}&checkout=${checkout}&rooms=2`),
      fetch(`${BASE}/api/hotels?destination=${encodeURIComponent(dest)}&checkin=${checkin}&checkout=${checkout}&rooms=2`),
    ])
    check(d1.status === 200 && d2.status === 200, '동시 요청 둘 다 200(캐시/공유)', `${d1.status}/${d2.status}`)

    // ⑥ /api/hotel/:id (상세·S3)
    if (h?.hotelId) {
      L(`\n[6] GET /api/hotel/${h.hotelId}?checkin=${checkin}&checkout=${checkout}&rooms=2`)
      const t6 = Date.now()
      const dRes = await fetch(`${BASE}/api/hotel/${encodeURIComponent(h.hotelId)}?checkin=${checkin}&checkout=${checkout}&rooms=2`)
      const dText = await dRes.text()
      L(`   (${Date.now() - t6}ms)`)
      check(dRes.status === 200, 'status 200', String(dRes.status))
      check(!/apiKey/i.test(dText), '🔒 응답에 apiKey 없음')
      let dd = {}
      try { dd = JSON.parse(dText) } catch {}
      check(String(dd.hotelId) === String(h.hotelId), 'hotelId 일치', `${dd.hotelId}`)
      check(typeof dd.name === 'string' && dd.name.length > 0, '호텔명 존재', dd.name)
      check(dd.guestRating >= 0 && dd.guestRating <= 5, 'guestRating 0~5 척도(#11)', String(dd.guestRating))
      check(typeof dd.propertyType === 'string' && dd.propertyType.length > 0, 'propertyType 라벨(검색캐시/폴백·#20)', dd.propertyType)
      check(Array.isArray(dd.facilities) && dd.facilities.every((f) => f.tag && f.label), 'facilities {tag,label}[](#20)', `${dd.facilities?.length}개`)
      check(dd.policies && typeof dd.policies.checkin === 'string' && typeof dd.policies.checkout === 'string', 'policies checkin/checkout', JSON.stringify(dd.policies))
      check(Array.isArray(dd.images) && dd.images.every((im) => typeof im.url === 'string' && 'tag' in im), 'images {url,tag}[]', `${dd.images?.length}장`)
      check(dd.place && typeof dd.place.lat === 'number' && typeof dd.place.address === 'string', 'place {lat,lon,address}')
      check(dd.reviews && dd.reviews.overall >= 0 && dd.reviews.overall <= 5 && Array.isArray(dd.reviews.categories), 'reviews.overall 0~5 + categories[]', `cat ${dd.reviews?.categories?.length}`)
      check(Array.isArray(dd.reviews?.items) && dd.reviews.items.length === 0, 'reviews.items=[](개별리뷰 미제공·#19)')
      check(Array.isArray(dd.providers) && dd.providers.length > 0 && dd.providers.every((p) => typeof p.index === 'number'), 'providers[](index 명시)', `${dd.providers?.length}곳`)
      check(Array.isArray(dd.results) && dd.results.length > 0, 'results[](요금)', `${dd.results?.length}건`)
      const provIdxSet = new Set((dd.providers ?? []).map((p) => p.index))
      check((dd.results ?? []).every((r) => provIdxSet.has(r.providerIndex)), 'results.providerIndex ↔ providers.index 조인 정합')
      const withBook = (dd.results ?? []).find((r) => r.bookUri)
      check(!!withBook && withBook.bookUri.includes('p='), 'results.bookUri 딥링크 p= 보존(S4)')
      check(dd.isComplete === true, 'isComplete=true(폴링 완료)', String(dd.isComplete))
      L(`     ${dd.name} · ★${dd.starRating} · ${dd.propertyType} · 평점 ${dd.guestRating}/5(리뷰 ${dd.numberOfReviews})`)
      L(`     facilities(${dd.facilities?.length}): ${dd.facilities?.map((f) => f.label).join(', ')}`)
      L(`     categories(${dd.reviews?.categories?.length}): ${dd.reviews?.categories?.map((c) => `${c.name} ${c.score}`).join(' / ')}`)
      L(`     공급사 ${dd.providers?.length}곳 · 요금 ${dd.results?.length}건 · checkin ${dd.policies?.checkin} / checkout ${dd.policies?.checkout} / cancel "${dd.policies?.cancel}"`)

      // ⑦ 상세 de-dupe: 동일 호텔 동시 2회 → 둘 다 200
      L('\n[7] 상세 de-dupe: 동일 호텔 동시 2회 → 둘 다 200')
      const [e1, e2] = await Promise.all([
        fetch(`${BASE}/api/hotel/${encodeURIComponent(h.hotelId)}?checkin=${checkin}&checkout=${checkout}&rooms=2`),
        fetch(`${BASE}/api/hotel/${encodeURIComponent(h.hotelId)}?checkin=${checkin}&checkout=${checkout}&rooms=2`),
      ])
      check(e1.status === 200 && e2.status === 200, '동시 요청 둘 다 200(in-flight 공유)', `${e1.status}/${e2.status}`)
    } else {
      check(false, '[6] 상세: 검색 결과에서 hotelId 미확보')
    }
  } catch (e) {
    pass = false
    L(`\n❌ 예외: ${e?.code ?? ''} ${e?.message ?? e}`)
  } finally {
    server.close()
  }

  L('\n' + '═'.repeat(64))
  L(pass ? '  ✅ S3 라우트 실측 통과' : '  ❌ S3 라우트 실측 실패 — 위 ✗ 확인')
  L('═'.repeat(64))
  process.exitCode = pass ? 0 : 1
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
