/**
 * S3 착수 프로브 — KAYAK 단일 호텔(/api/3.0/hotel) 실제 응답 형태를 확정한다.
 * (S2 프로브와 동일 취지: 추측 제거. 개발실 IP 58.75.223.130 망에서만 200.)
 *
 * 실행: node scripts/probe-detail.mjs [검색어]
 * 출력: 응답 구조(키·타입·샘플값)만. apiKey/href/bookUri 는 절대 평문 노출하지 않는다.
 *
 * 확정 대상:
 *  - 단일 응답 최상위 키 / propertyType 부재 여부 / description 언어
 *  - reviews.guestRatings 실제 키 집합(한글 라벨 매핑용) + quotes/aspects 형태 + numberOfReviews
 *  - policies[] 의 code 집합(checkin/checkout/cancel 분류)
 *  - features 길이 / featureTags tag 그룹 / featureSummary 샘플
 *  - results[](요금) / providers[](cashback) 형태
 */
import { config, missingSecrets } from '../src/config.js'
import { autocomplete, searchHotels, searchHotel } from '../src/kayak/endpoints.js'

const QUERY = process.argv[2] ?? '서울'
const L = (s = '') => process.stdout.write(s + '\n')
const ymd = (d) => {
  const x = new Date()
  x.setDate(x.getDate() + d)
  return x.toISOString().slice(0, 10)
}
const firstArray = (resp) => {
  if (Array.isArray(resp)) return resp
  if (resp && typeof resp === 'object') for (const v of Object.values(resp)) if (Array.isArray(v)) return v
  return []
}
/** URL 에서 host 만(키/쿼리 제거). */
const hostOnly = (u) => { try { return new URL(u).host } catch { return '(파싱불가)' } }
const clip = (s, n = 60) => (typeof s === 'string' ? s.slice(0, n).replace(/\s+/g, ' ') : String(s))

async function main() {
  L('═'.repeat(64))
  L('  S3 프로브 — KAYAK 단일 호텔 응답 형태 확정')
  L('═'.repeat(64))
  L(`host=${config.kayakHost}  clientIp=${config.devClientIp}`)
  if (missingSecrets().includes('KAYAK_API_KEY')) { L('❌ KAYAK_API_KEY 미설정'); process.exitCode = 1; return }

  const checkin = ymd(30), checkout = ymd(31)

  // ── 1) 자동완성 → 목적지 → 검색 → 첫 호텔 key 확보 ──
  const ac = firstArray(await autocomplete({ q: QUERY }))
  const place = ac.find((it) => String(it.entityKey).startsWith('kplace:')) ?? ac[0]
  const destination = place?.entityKey ?? 'kplace:22028'
  L(`\n[목적지] ${destination} (${place?.fullName ?? '?'})`)

  const search = await searchHotels({
    destination, checkin, checkout, rooms: '2',
    clientIp: config.devClientIp, userTrackId: 's3-probe', pageSize: 25,
  })
  const sresults = firstArray(search.results ?? search)
  const first = sresults[0]
  // 호텔 key: 검색 결과의 key(khotel:{id}) 우선, 없으면 id 로 구성.
  const hotelKey = first?.key ?? (first?.id != null ? `khotel:${first.id}` : null)
  L(`[검색] 반환 ${sresults.length}건 · 첫 호텔 "${first?.name ?? '?'}" key=${hotelKey}`)
  L(`       검색결과의 첫 호텔 propertyType(숫자)=${JSON.stringify(first?.propertyType)} guestRating=${first?.guestRating}`)
  if (!hotelKey) { L('❌ 호텔 key 확보 실패'); process.exitCode = 1; return }

  // ── 2) 단일 호텔 상세 호출 ──
  L(`\n[상세] GET /api/3.0/hotel hotel=${hotelKey} (폴링)`)
  const t0 = Date.now()
  const d = await searchHotel({
    hotelKey, checkin, checkout, rooms: '2',
    clientIp: config.devClientIp, userTrackId: 's3-probe',
  })
  L(`       → isComplete=${d.isComplete} searchTime=${d.searchTime} (${Date.now() - t0}ms)`)

  // ── 3) 구조 분석 ──
  L('\n── 최상위 키 ──')
  L('  ' + Object.keys(d).sort().join(', '))
  L(`  id=${d.id} key=${d.key} name="${d.name}" translatedName="${d.translatedName ?? '(없음)'}"`)
  L(`  starRating=${d.starRating} address="${clip(d.address, 50)}" lat=${d.latitude} lon=${d.longitude}`)
  L(`  propertyType 필드 존재? ${'propertyType' in d ? 'YES=' + JSON.stringify(d.propertyType) : 'NO (단일응답에 없음)'}`)
  L(`  currencyCode=${d.currencyCode} languageCode=${d.languageCode} totalResults=${d.totalResults}`)

  L('\n── description ──')
  L(`  존재? ${'description' in d ? 'YES' : 'NO'} · 길이=${d.description?.length ?? 0}`)
  if (d.description) L(`  앞 140자: ${clip(d.description, 140)}`)

  L('\n── reviews ──')
  if (d.reviews) {
    L(`  reviews 키: ${Object.keys(d.reviews).join(', ')}`)
    L(`  numberOfReviews=${d.reviews.numberOfReviews} sentiment="${d.reviews.sentiment ?? ''}"`)
    if (d.reviews.guestRatings) {
      L(`  guestRatings(0~10):`)
      for (const [k, v] of Object.entries(d.reviews.guestRatings)) L(`     ${k} = ${v}`)
    }
    const q = d.reviews.quotes ?? []
    const a = d.reviews.aspects ?? []
    L(`  quotes ${q.length}건 · 샘플: ${q.slice(0, 3).map((x) => `"${clip(x.text, 30)}"(${x.polarity})`).join(' / ')}`)
    L(`  aspects ${a.length}건 · 샘플: ${a.slice(0, 3).map((x) => `"${clip(x.text, 30)}"(${x.polarity})`).join(' / ')}`)
    L(`  reviewerTypes ${firstArray(d.reviews.reviewerTypes).length}건`)
  } else L('  reviews 없음')

  L('\n── policies ──')
  const pol = firstArray(d.policies)
  L(`  ${pol.length}건`)
  pol.forEach((p) => L(`     code="${p.code}" name="${p.name}" desc="${clip(p.description, 60)}"`))

  L('\n── features / featureTags / featureSummary ──')
  L(`  features(숫자[]) 길이=${firstArray(d.features).length} · 앞20=${firstArray(d.features).slice(0, 20).join(',')}`)
  const ftags = firstArray(d.featureTags)
  L(`  featureTags ${ftags.length}건:`)
  ftags.forEach((t) => L(`     tag="${t.tag}" features=[${firstArray(t.features).slice(0, 8).join(',')}${firstArray(t.features).length > 8 ? '…' : ''}] (${firstArray(t.features).length}개)`))
  const fsum = firstArray(d.featureSummary)
  L(`  featureSummary ${fsum.length}건 · 샘플:`)
  fsum.slice(0, 8).forEach((s) => L(`     name="${s.name}" desc="${clip(s.description, 50)}"`))

  L('\n── images ──')
  const imgs = firstArray(d.images)
  L(`  ${imgs.length}건 · 첫건 키=${imgs[0] ? Object.keys(imgs[0]).join(',') : '없음'} · large host=${imgs[0]?.large ? hostOnly(imgs[0].large) : '없음'}`)
  L(`  tag 필드 존재? ${imgs[0] && 'tag' in imgs[0] ? 'YES' : 'NO (검색·단일 이미지엔 tag 없음 — 가이드 §5 확인)'}`)

  L('\n── providers ──')
  const provs = firstArray(d.providers)
  L(`  ${provs.length}건 · 첫건 키=${provs[0] ? Object.keys(provs[0]).join(',') : '없음'}`)
  provs.slice(0, 5).forEach((p, i) => L(`     [${i}] code=${p.code} name="${p.name}" isDirect=${p.isDirect} logo=${p.logo ? 'URL(' + hostOnly(p.logo) + ')' : '없음'} cashback=${p.cashback ? JSON.stringify(p.cashback) : '없음'}`))

  L('\n── results(요금) ──')
  const rates = firstArray(d.results)
  L(`  ${rates.length}건 · 첫건 키=${rates[0] ? Object.keys(rates[0]).join(',') : '없음'}`)
  rates.slice(0, 5).forEach((r, i) => L(`     [${i}] room="${clip(r.roomName, 28)}" total=${r.totalRate} provIdx=${r.providerIndex} freeCxl=${r.hasFreeCancellation} payLater=${r.canPayLater} inc=[${firstArray(r.inclusions).join(',')}] rooms=${r.availableRooms} bookUri=${r.bookUri ? hostOnly(r.bookUri) + (r.bookUri.includes('p=') ? ' (p= 있음)' : ' (p= 없음)') : '없음'}`))

  // 🔒 키 누출 자가 점검: 응답 직렬화에 apiKey 흔적이 있으면 경고(href 필드 등).
  const dump = JSON.stringify(d)
  L('\n── 🔒 키 누출 점검 ──')
  L(`  전체 응답에 'apiKey=' 패턴 ${/apiKey=/i.test(dump) ? '⚠ 발견(어댑터가 해당 필드 미선택 필요)' : '없음'}`)
  L(`  (참고) href 류 필드: ${Object.keys(d).filter((k) => /href|uri|url/i.test(k)).join(', ') || '최상위엔 없음'}`)

  L('\n' + '═'.repeat(64))
  L('  ✅ S3 프로브 완료 — 위 구조로 어댑터 매핑 확정')
  L('═'.repeat(64))
}
main().catch((e) => { console.error('❌ 프로브 오류:', e?.code ?? '', e?.message ?? e); if (e?.body) console.error('body:', typeof e.body === 'string' ? e.body : JSON.stringify(e.body)); process.exitCode = 1 })
