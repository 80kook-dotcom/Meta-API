# Meta-API — Meta-Re ↔ KAYAK Affiliate 중계(프록시) 서버

[Meta-Re](https://github.com/80kook-dotcom/Meta-Re) 앱(호텔 메타서치)을 KAYAK Affiliate API 실데이터에 연결하는 중계 서버입니다.
브라우저가 KAYAK을 직접 못 부르므로(IP 화이트리스트·키 비밀·CORS), 이 서버가 사이에서 키를 보관하고 허용된 IP에서 KAYAK을 대신 호출합니다.

```
[앱(브라우저)]  →  [Meta-API 중계 서버(키 보관·허용 IP)]  →  [KAYAK API]
   /api/* 호출          apiKey 주입 + 헤더 + 앱 타입 변환
```

> [이동→] 딥링크(bookUri)는 공개 URL이라 중계 불필요 — 브라우저가 직접 새 탭으로 엽니다.

## ⚠ 보안 (이 저장소는 PUBLIC)
- **API 키는 절대 커밋하지 않습니다.** 키는 `.env`(로컬) 또는 운영 서버 환경변수로만 보관합니다.
- `.gitignore` 가 `.env` · `docs/_reference/KAYAK_접속정보_및_QA.md`(키 포함) · `_live_search_sample.json` 을 차단합니다.
- `KAYAK_AFFILIATE_ID`(`kan_318930_594068`)는 딥링크 `a=` 로 공개되는 값이라 비밀이 아닙니다.

## 실행
KAYAK 호출은 **화이트리스트 IP(`58.75.223.130` = 회사 개발실 망)에서만** 200을 반환합니다.

```bash
npm install
cp .env.example .env   # .env 를 열어 KAYAK_API_KEY / KAYAK_REPORTING_KEY 를 채운다
npm start              # → http://localhost:8787
```

헬스체크:
```bash
curl http://localhost:8787/health
# 개발: { "ok": true, "phase": "S6-ops", "secretsLoaded": true, "kayakHost": ... }
# 운영(RELAY_ENV=production): { "ok": true }  ← 내부정보 미노출(상세는 /internal/health)
```

## 환경변수
`.env.example` 참고. 핵심: `PORT`, `KAYAK_HOST`(운영 확정 `ko-kr`·샌드박스 `sandbox-en-us`는 403), `KAYAK_API_KEY`, `KAYAK_REPORTING_KEY`, `KAYAK_AFFILIATE_ID`, `KAYAK_SEARCH_UA`(검색 API 필수 User-Agent), `ALLOWED_ORIGINS`.

## 앱 측 계약 (`/api/*`)
중계 서버는 Meta-Re 앱이 기대하는 경로·응답 형태를 그대로 제공합니다(앱 코드 변경 최소화).

| 경로 | 응답(앱 타입) | KAYAK 매핑 | 구현 단계 |
|---|---|---|---|
| `GET /api/autocomplete?q=` | `AutocompleteItem[]` | Autocomplete | ✅ S2 |
| `GET /api/hotels?destination=&checkin=&checkout=&rooms=` | `{ results, totalCount }` | Hotel Search(다중) `/api/3.0/hotels` 🔴헤더2 | ✅ S2 |
| `GET /api/hotel/:id` | `HotelDetail` | Hotel Search(단일) `/api/3.0/hotel` 🔴헤더2 | ✅ S3 |
| `GET /api/cashback?labels=` | `CashbackTxn[]` | Reporting `/transactions/hotels` | ✅ S5 |

> ⚠ `/api/hotels` 는 검색 파라미터(`destination`·`checkin`·`checkout` 필수, `rooms` 기본 2)를 쿼리로 받는다.
> 앱이 searchStore 조건을 쿼리로 실어 보내도록 연결한다(Meta-Re 연동 트랙). `userTrackId` 누락 시 중계가 폴백 생성.

> 🔒 `/api/cashback` 의 `labels`(회원 라벨)는 **단일·필수**다. 누락/빈 값이면 `400 MISSING_LABELS` 로 차단하고
> KAYAK 을 호출하지 않는다 — labels 를 생략하면 KAYAK 이 **전 회원** 거래를 반환(대량 유출)하기 때문(결정 [11]).
> 잔여 IDOR(앱이 보낸 라벨 신뢰)은 **S6 에서 라벨 서명(HMAC)으로 방어**: `CASHBACK_LABEL_HMAC_SECRET` 설정 시
> `?labels=&exp=&sig=`(인증 백엔드가 회원 본인 라벨에 발급한 HMAC-SHA256(`label.exp`))를 강제. 미설정(개발/데모)은 현행 trust-label.

> `/api/member`, `/api/deals` 는 KAYAK 무관(올마이투어 자체 데이터) — 필요 시 별도 추가.

## 단계(세션)
- **S0** ✅: 레포 부트스트랩 + 중계 서버 골격 + `/health`. ← KAYAK 호출 없이 서버 기동 200.
- **S1** ✅: 자동완성·검색 실호출(개발실 IP에서 200 + 실데이터). 검색 헤더 2개 검증.
- **S2** ✅: 자동완성·검색결과 어댑터(KAYAK→앱 타입) + constants-mapping 캐시 + 검색 de-dupe. 단위테스트 `npm test`, 라우트 실측 `npm run test:route`.
- **S3** ✅: 상세 어댑터(KAYAK 단일 호텔→`HotelDetail`) + isComplete 폴링 재사용 + propertyType 검색캐시 보강. 단위테스트 `npm test`, 라우트 실측 `npm run test:route`(상세 포함).
- **S4** ✅: 딥링크 `p=` 회원 라벨 주입(앱 측 `Meta-Re/lib/outlink.ts`).
- **S5** ✅: 캐시백 리포팅(`/transactions/hotels`→`CashbackTxn[]`). 라벨 게이팅(누락→400)·상태판정(Active+정산경과→Approved·그외 Waiting·Cancelled)·Booking 필터·KRW 반올림. 단위테스트 `npm test`, 라우트 실측 `npm run test:route`(캐시백 포함).
- **S6** ✅: 운영 전환 하드닝. ① 운영모드 fail-fast(`RELAY_ENV=production` 시 시크릿/rate-limit/CORS/키 미흡이면 기동 거부) ② `/health` 운영 축소 + 보호된 `/internal/health` ③ 캐시백 라벨 서명(HMAC-SHA256(`label.exp`)·IDOR 방어·env 게이트) ④ 검색 폴링 transient 재시도(연속 상한) + 자동완성 단기 캐시(쿼터 절감) ⑤ 통화/언어 허용목록(비KRW→400·무음 오표기 금지) ⑥ 구조화(JSON) 로깅. 단위테스트 `npm test`, 라우트 실측 `npm run test:route`. **⚠ 실제 운영 배포(고정 IP 서버 + KAYAK 화이트리스트 추가)는 외부 절차(KAYAK 승인) 필요 — 본 단계는 코드·설정 완비까지.**

## 운영 배포 런북(S6)
실제 손님 오픈 전 체크리스트:
1. **고정 IP 서버**에 배포하고, 그 IP를 **KAYAK 화이트리스트에 추가 요청**(개발실 `58.75.223.130` 외 신규 IP는 KAYAK 승인 필요). Cloudflare egress 로 직접 KAYAK 호출은 화이트리스트 밖이라 불가 → 중계는 고정 IP 서버에서.
2. **환경변수**(`.env.example` 참고): `RELAY_ENV=production` · `RELAY_SHARED_SECRET`(설정) · `RATE_LIMIT_PER_MIN`(양수) · `ALLOW_NO_ORIGIN=false` · `ALLOWED_ORIGINS`(앱 도메인만·localhost 제거) · KAYAK 키 3종 · 캐시백 운영 시 `CASHBACK_LABEL_HMAC_SECRET` · 프록시 뒤면 `TRUST_PROXY_HOPS`. 미흡하면 기동이 거부된다(fail-fast).
3. **신뢰경계 주의(codex)**: ⓐ `RELAY_SHARED_SECRET`·CORS 는 인증이 아니다(브라우저 노출·curl 우회) → 진짜 보호는 앱과 같은 출처의 리버스프록시(CF `_redirects` 200)·Cloudflare Access·인증 백엔드 주입. ⓑ 손님 실 IP(`CF-Connecting-IP`/XFF)는 **신뢰 프록시 뒤에서만** 믿을 수 있다 → 원 서버는 방화벽으로 직접 인터넷 노출을 막아 헤더 위조를 차단. ⓒ 캐시백 라벨 서명(`sig`)은 query·로그·Referer 에 남으므로 짧은 만료 + `Cache-Control: no-store`(적용됨) + 로그 redaction(적용됨).
4. **앱(Meta-Re) 측 운영 전환은 별도 트랙**(이 레포 아님): MSW/mocks 제거(`/api/deals` 누수 점검) · `_redirects` 에서 `/api/*` SPA fallback 제외(중계로 라우팅) · 통화/번역 i18n · 외부 이미지·중계 도메인 허용 CSP.

### 핸드오프 주의(S6 적대 리뷰 confirmed)
- **캐시백 라벨 서명 켜는 순서**: 운영에서 `CASHBACK_LABEL_HMAC_SECRET` 를 설정하면 `/api/cashback` 이 `exp+sig` 를 강제한다. **앱(Meta-Re)이 인증 백엔드의 서명을 받아 `?exp=&sig=` 로 전달하도록 먼저 배포**해야 한다. 안 그러면 회원 캐시백 조회가 전부 401 이 된다. → 앱 배포 선행 후 시크릿 활성화(또는 앱 준비 전까지 시크릿 비워 두기).
- **헬스체크 자동화**: 운영 공개 `/health` 는 `{ok:true}` 만 준다. LB·업타임 모니터는 **HTTP 200 만 확인**하도록 설정(응답 본문 필드 파싱 금지). 상세(키 로드·게이트 상태)는 `x-relay-secret` 헤더로 `/internal/health` 호출.
- **통화/언어**: 앱은 현재 `currencyCode`/`languageCode` 를 보내지 않아 기본 KRW/ko_KR 가 적용된다(안전). 다통화·다국어 확장 시 앱이 명시 전달하도록 + 중계 `SUPPORTED_CURRENCIES`/`SUPPORTED_LANGUAGES` 확장을 **함께** 조정(비허용 값은 400 으로 거부됨·무음 오표기 없음).
- **프록시 뒤 배포(선택)**: 고정 IP 직결이 기본이며 그때 `TRUST_PROXY_HOPS=0` 이 맞다. CF/LB 뒤(KAYAK 화이트리스트가 그 IP 를 허용하는 경우)라면 `TRUST_PROXY_HOPS` 를 hop 수로 설정해야 손님 실 IP 가 KAYAK 에 전달된다(기동 시 warn 로 안내).

상세 명세: `docs/개발요청서_KAYAK연동_v1.md`, `docs/개발가이드_KAYAK연동_v1.md`, `docs/CODEX_REVIEW_POINTS.md`(S6 결정·검증).
