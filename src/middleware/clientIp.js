/**
 * 클라이언트 IP 신뢰경계 미들웨어 (codex #2/#13 · 사용자 결정).
 *
 * 원칙: 앱/외부가 보낸 `x-original-client-ip` 는 신뢰하지 않는다. 서버가 계산한 값만
 *       req.clientIp 에 싣고, 그 값을 KAYAK 검색 헤더에 쓴다(라우트 S2~).
 *
 * - trustProxyHops=0(기본·직결): 소켓 IP. localhost 면 devClientIp 폴백.
 * - trustProxyHops>0(CF/LB 뒤): CF-Connecting-IP 우선, 없으면 XFF 체인에서
 *   신뢰 프록시 hop 만큼 안쪽 IP를 취한다(XFF 최좌측 임의 위조 방지).
 */
import { config } from '../config.js'

function normalizeIp(ip) {
  if (!ip) return ''
  // IPv4-mapped IPv6(::ffff:1.2.3.4) → 1.2.3.4
  return ip.replace(/^::ffff:/i, '').trim()
}

function isLocal(ip) {
  return !ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')
}

export function computeClientIp(req) {
  const hops = config.trustProxyHops
  if (hops > 0) {
    const cf = req.headers['cf-connecting-ip']
    if (cf) return normalizeIp(String(cf).split(',')[0])
    const xff = req.headers['x-forwarded-for']
    if (xff) {
      const chain = String(xff)
        .split(',')
        .map((s) => normalizeIp(s))
        .filter(Boolean)
      // 신뢰 프록시가 본 IP = 오른쪽에서 hops 번째. 범위 밖이면 최좌측.
      const idx = chain.length - hops
      const picked = idx >= 0 ? chain[idx] : chain[0]
      if (picked) return picked
    }
  }
  const sock = normalizeIp(req.socket?.remoteAddress || req.ip || '')
  return isLocal(sock) ? config.devClientIp : sock || config.devClientIp
}

export function clientIp(req, _res, next) {
  // 외부가 주입한 값은 즉시 폐기(신뢰경계).
  delete req.headers['x-original-client-ip']
  req.clientIp = computeClientIp(req)
  next()
}
