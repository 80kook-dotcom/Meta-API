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
# { "ok": true, "phase": "S5-cashback", "secretsLoaded": true, ... }
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
> 잔여 IDOR(앱이 보낸 라벨 신뢰)은 운영(S6)에서 인증 백엔드의 서명 토큰으로 라벨을 도출해 막는다.

> `/api/member`, `/api/deals` 는 KAYAK 무관(올마이투어 자체 데이터) — 필요 시 별도 추가.

## 단계(세션)
- **S0** ✅: 레포 부트스트랩 + 중계 서버 골격 + `/health`. ← KAYAK 호출 없이 서버 기동 200.
- **S1** ✅: 자동완성·검색 실호출(개발실 IP에서 200 + 실데이터). 검색 헤더 2개 검증.
- **S2** ✅: 자동완성·검색결과 어댑터(KAYAK→앱 타입) + constants-mapping 캐시 + 검색 de-dupe. 단위테스트 `npm test`, 라우트 실측 `npm run test:route`.
- **S3** ✅: 상세 어댑터(KAYAK 단일 호텔→`HotelDetail`) + isComplete 폴링 재사용 + propertyType 검색캐시 보강. 단위테스트 `npm test`, 라우트 실측 `npm run test:route`(상세 포함).
- **S4** ✅: 딥링크 `p=` 회원 라벨 주입(앱 측 `Meta-Re/lib/outlink.ts`).
- **S5** ✅: 캐시백 리포팅(`/transactions/hotels`→`CashbackTxn[]`). 라벨 게이팅(누락→400)·상태판정(Active+정산경과→Approved·그외 Waiting·Cancelled)·Booking 필터·KRW 반올림. 단위테스트 `npm test`, 라우트 실측 `npm run test:route`(캐시백 포함).
- **S6**: 운영 전환(운영 HOST·고정 IP 화이트리스트·통화/번역·CSP·캐시백 라벨 서명 토큰).

상세 명세: `docs/개발요청서_KAYAK연동_v1.md`, `docs/개발가이드_KAYAK연동_v1.md`.
