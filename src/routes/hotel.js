import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { searchHotel } from '../kayak/endpoints.js'
import { adaptHotelDetail } from '../adapters/hotel.js'
import { dedupe } from '../lib/dedupe.js'

const router = Router()

/**
 * GET /api/hotel/:id?checkin=&checkout=&rooms=&currencyCode=&languageCode=&userTrackId=
 *   → 앱 HotelDetail
 * KAYAK: GET {HOST}/api/3.0/hotel (헤더 UA + x-original-client-ip, isComplete 폴링)
 *
 * - :id 는 앱 hotelId(예 '3756840'). KAYAK 은 'khotel:{id}' 형식이라 변환한다.
 * - checkin/checkout 미전달 시 dataless 호출(호텔 정보·시설·리뷰만, 요금 results 비어 옴) — 딥링크 직접진입 대응.
 * - clientIp 는 미들웨어가 계산한 신뢰경계 값(req.clientIp)만 사용.
 * - 동일 호텔+조건 동시 진입은 dedupe 로 in-flight 공유(검색과 동일·앱 detailCacheStore 와 별개·codex 권고).
 */
router.get('/hotel/:id', async (req, res, next) => {
  try {
    const rawId = String(req.params.id ?? '').trim()
    if (!rawId) {
      return res.status(400).json({ error: 'MISSING_HOTEL_ID', message: '호텔 id 가 필요합니다.' })
    }
    // 앱 hotelId(숫자 문자열) → KAYAK hotel 파라미터('khotel:{id}'). 이미 접두사가 있으면 그대로.
    const hotelKey = rawId.startsWith('khotel:') ? rawId : `khotel:${rawId}`

    const checkin = String(req.query.checkin ?? '').trim()
    const checkout = String(req.query.checkout ?? '').trim()
    const rooms = String(req.query.rooms ?? '2').trim() || '2'
    const currencyCode = String(req.query.currencyCode ?? 'KRW').trim() || 'KRW'
    const languageCode = String(req.query.languageCode ?? 'ko_KR').trim() || 'ko_KR'
    // userTrackId 는 검색 패밀리 필수 파라미터(없으면 400). 앱 미전달 시 폴백 생성.
    const userTrackId = String(req.query.userTrackId ?? '').trim() || `relay-${randomUUID()}`

    const clientIp = req.clientIp
    // de-dupe 키: 상세 네임스페이스(detail) + 호텔 + 조건 + market IP. (가격이 IP market 종속이라 IP 포함.)
    const key = JSON.stringify({ detail: hotelKey, checkin, checkout, rooms, currencyCode, languageCode, clientIp })

    const payload = await dedupe(key, async () => {
      const raw = await searchHotel({
        hotelKey,
        checkin: checkin || undefined, // 빈 값이면 dataless(buildUrl 이 생략)
        checkout: checkout || undefined,
        rooms,
        clientIp,
        userTrackId,
        currencyCode,
        languageCode,
      })
      return adaptHotelDetail(raw, { languageCode })
    })

    res.json(payload)
  } catch (e) {
    next(e)
  }
})

export default router
