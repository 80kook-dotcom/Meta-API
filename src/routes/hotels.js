import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { searchHotels } from '../kayak/endpoints.js'
import { adaptHotels } from '../adapters/hotels.js'
import { dedupe } from '../lib/dedupe.js'

const router = Router()

// codex S1 결정: 단발 pageSize=250(앱 무변경·상위 결과). 250 초과분은 '상위 결과'로 수용.
const PAGE_SIZE = 250

/**
 * GET /api/hotels?destination=&checkin=&checkout=&rooms=&currencyCode=&languageCode=&userTrackId=
 *   → 앱 { results: Hotel[], totalCount }
 * KAYAK: GET {HOST}/api/3.0/hotels (헤더 UA + x-original-client-ip, isComplete 폴링)
 *
 * 검색조건은 필수(KAYAK 요구). 앱이 searchStore 조건을 쿼리로 실어 보내도록 한다(Meta-Re 연동 트랙).
 * clientIp 는 미들웨어가 계산한 신뢰경계 값(req.clientIp)만 사용한다.
 */
router.get('/hotels', async (req, res, next) => {
  try {
    const destination = String(req.query.destination ?? '').trim()
    const checkin = String(req.query.checkin ?? '').trim()
    const checkout = String(req.query.checkout ?? '').trim()
    const rooms = String(req.query.rooms ?? '2').trim() || '2'
    const currencyCode = String(req.query.currencyCode ?? 'KRW').trim() || 'KRW'
    const languageCode = String(req.query.languageCode ?? 'ko_KR').trim() || 'ko_KR'
    // userTrackId 는 KAYAK 검색 필수 파라미터(없으면 400 MISSING_USER_TRACK_ID·실측).
    // 앱 sessionStore.userTrackId 를 받되, 누락 시 폴백 생성해 호출이 실패하지 않게 한다.
    const userTrackId = String(req.query.userTrackId ?? '').trim() || `relay-${randomUUID()}`

    const missing = []
    if (!destination) missing.push('destination')
    if (!checkin) missing.push('checkin')
    if (!checkout) missing.push('checkout')
    if (missing.length) {
      return res.status(400).json({
        error: 'MISSING_SEARCH_PARAMS',
        message: `검색 필수 파라미터 누락: ${missing.join(', ')}`,
        required: ['destination', 'checkin', 'checkout'],
      })
    }

    const clientIp = req.clientIp
    // de-dupe 키: 동일 검색조건 + market IP. (가격이 IP market 종속이라 IP 포함.)
    const key = JSON.stringify({ destination, checkin, checkout, rooms, currencyCode, languageCode, clientIp })

    const payload = await dedupe(key, async () => {
      const raw = await searchHotels({
        destination,
        checkin,
        checkout,
        rooms,
        clientIp,
        userTrackId,
        currencyCode,
        languageCode,
        pageSize: PAGE_SIZE,
      })
      return adaptHotels(raw, { languageCode })
    })

    res.json(payload)
  } catch (e) {
    next(e)
  }
})

export default router
