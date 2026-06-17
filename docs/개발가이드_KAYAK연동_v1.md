# 개발가이드 — Meta‑Re ↔ KAYAK Affiliate API 구현

> v1 (2026-06-17) · 동반 문서: `개발요청서_KAYAK연동_v1.md` · 원문: `_reference/`(RAML 4종 + 접속/QA)
> 읽는 사람: 연동 개발자. RAML 필드 ↔ 앱 타입(`Meta-Re/app/src/types/index.ts`)을 1:1 대조해 정리.
> 코드 전량 대신 **URL 형태 · 필드 매핑표 · 단계 체크리스트** 중심. ⚠ = 변환/주의 지점.

---

## 1. 아키텍처
```
[앱(브라우저, Cloudflare Pages)]  →  [중계 서버(고정 IP, 키 보관)]  →  [KAYAK API]
        |  같은 경로 /api/* 호출            |  apiKey 주입 + KAYAK 호출           |
        |  (응답은 앱 타입 형태)            |  + 응답을 앱 타입으로 변환          |
        ←──────────────────────────────────←────────────────────────────────←
[이동→] 딥링크는 중계 불필요: bookUri(공개 URL)로 브라우저가 직접 새 탭
```
- **중계 서버 책임**: ① API 키 보관(환경변수) ② 고정 IP에서 KAYAK 호출(화이트리스트) ③ CORS 허용(우리 도메인) ④ **KAYAK 응답 → 앱 타입(types/index.ts) 변환(어댑터)** ⑤ 폴링·constants 매핑 캐시.
- **앱 변경 최소화 원칙**: 앱은 지금처럼 `/api/hotels`·`/api/autocomplete`·`/api/hotel/:id`를 호출. 그 경로를 **MSW 대신 중계 서버**가 처리하고 **앱이 기대하는 형태(types/index.ts)** 로 응답하면 화면 코드 변경이 거의 없다.
- 개발 환경: 중계 서버를 **개발실 IP(58.75.223.130) 망에서 구동**. 운영: 고정 IP 서버 + 그 IP를 KAYAK 화이트리스트 추가.
- 중계 서버 형태(택1): Node/Express 소형 서버, 또는 Cloudflare Pages Functions(단 KAYAK이 Cloudflare egress IP 대역 허용 시).

## 2. KAYAK 엔드포인트 요약
| API | 메서드·경로 | 인증 | 용도 |
|---|---|---|---|
| 자동완성 | GET `{HOST}/api/affiliate/autocomplete/v1/hotels?apiKey=&searchTerm=` | apiKey(공용) | 목적지/호텔 후보(최대 6) |
| 검색(다중) | GET `{HOST}/api/3.0/hotels?apiKey=&userTrackId=&destination=&checkin=&checkout=&rooms=&currencyCode=KRW&languageCode=ko_KR&responseOptions=topRates,images,features,filter,destination&onlyIfComplete=false&includeTaxesInTotal=true` | apiKey + IP(접속전달본) | 목적지 호텔 목록. ⚠ 카드 amenities 채우려면 `features` 포함 필수. 세금포함 총액 표기하려면 `includeTaxesInTotal=true`(필요 시 `includeLocalTaxesInTotal=true`) |
| 검색(단일) | GET `{HOST}/api/3.0/hotel?apiKey=&userTrackId=&hotel=khotel:{id}&checkin=&checkout=&rooms=&responseOptions=features,featureTags,featureSummary,images,place,reviews,description,rateBreakdown&includeTaxesInTotal=true` | apiKey + IP(접속전달본) | 한 호텔 상세·공급사별 요금. ⚠ `featureTags` 포함해야 시설 태그그룹 옴 |
| 정적피드 | GET `{HOST}/api/4.0/constants-mapping?apiKey=&types=facility,property,placeType,theme,chain,imageTag&languageCode=ko_KR` (+ `/hotelfeed`,`/placefeed`) | apiKey + IP(접속전달본) | 숫자ID→이름표 / 정적 호텔·장소 DB. ⚠ **응답은 NDJSON**(`application/x-ndjson`·줄 단위 JSON) → 줄 단위 파서 필요. ⚠ types 값은 `property`(응답 필드명만 propertyType) |
| 리포팅 | GET `https://api.affiliates.hotelscombined.com/api/transactions/hotels?apiKey={reportingKey}&startDate=&endDate=&labels={회원라벨}&pageSize=` (헤더 `X-Version: 2.0`) | reportingKey + IP | 회원별 예약·캐시백 내역 |

- `{HOST}` = KAYAK affiliate 호스트. **샌드박스 예시(RAML)**: `https://sandbox-en-us.kayakaffiliates.com`. **운영 호스트·한국 마켓 값은 Getting Started 문서에서 확정 → `[운영 HOST 확정]`**.
- `rooms` 형식(`HotelRoomGuests`): `{성인}:{아동나이...}|...` 예 `2`(성인2) · `2:4`(성인2+4세아동) · `2|2:8`(2객실). 앱 `lib/guests.ts`의 `roomsParam`와 동일 규약 → 그대로 사용 가능.
- 🔴 **Hotel Search(`/api/3.0/*`)는 요청 헤더 2개가 필수**(실측 확정 2026-06-17): ① **`User-Agent`** = 실제 브라우저 값(예 `Mozilla/5.0 …Chrome/…`). curl 기본값 → `403 FORBIDDEN`, `PostmanRuntime/…` → `400 INVALID_USER_AGENT`. ② **`x-original-client-ip`** = 최종 사용자 IP(없으면 `400 MISSING_ORIGINAL_CLIENT_IP_HEADER`·문서 GettingStartedHeaders). **둘 다 넣으면 200**. ⚠ 중계 서버가 KAYAK 검색 호출 시 이 두 헤더를 반드시 세팅(브라우저 UA 고정값 + 손님 실 IP 전달). **자동완성·정적피드·리포팅은 이 헤더 불필요**(헤더 없이 200 실측). 비동기라 첫 응답 `isComplete:false`·results 0 → `isComplete:true`까지 폴링(또는 `onlyIfComplete=true`로 202 반복). 실측: 서울 `kplace:22028` → `totalResults 1247`·KRW·실제 OTA(호텔스닷컴/아고다/부킹닷컴…)·bookUri 호스트 `hapi-ko-kr.kayakaffiliates.com/in?…&a=kan_318930_594068&p=…`(AID 포함·`p=` 빈값 → 회원라벨 주입자리 확인). 샘플 응답: `_reference/_live_search_sample.json`.
- 비동기: `onlyIfComplete=false`면 200 + `isComplete` 플래그. `false`면 같은 요청 재호출하여 가격이 모일 때까지 갱신(폴링).

## 3. 필드 매핑 — 자동완성
KAYAK `HotelsAutocompleteRecordResponse` → 앱 `AutocompleteItem`
| 앱 필드 | KAYAK 필드 | 비고 |
|---|---|---|
| `entityKey` | `entityKey` (예 `kplace:59560`/`khotel:61746`) | 그대로. 검색 `destination`에 사용 |
| `primaryPlaceType` | `primaryPlaceType` | ⚠ KAYAK enum이 더 많음(airport/city/country/hotel/trainstation/region/touristregion/neighborhood/landmark/nationalpark/island). 앱은 city/region/hotel/airport/neighborhood만 → **매핑표 필요**(예: touristregion·landmark·island·nationalpark→region, trainstation→station 또는 region). |
| `fullname` | `fullName` | 표시명 |
| `hotelName?` | `hotelName` | hotel일 때 |
| `cityName?` | `cityName` | 보조설명 |
- 정렬: 앱 정책 city→region→hotel은 중계 서버에서 정렬해 전달(KAYAK은 최대 6건 반환).

## 4. 필드 매핑 — 검색 결과(다중)
KAYAK `HotelResult` → 앱 `Hotel`
| 앱 필드 | KAYAK | 비고 |
|---|---|---|
| `hotelId` | `key`(`khotel:{id}`) 또는 `id` | 앱은 문자열 id 사용 |
| `name` | `name` | |
| `starRating` | `starRating` | |
| `guestRating` | `guestRating` | ⚠ **KAYAK는 0~10**(예 8.6), 앱은 0~5 표기 가정 → 표시 스케일 통일(0~10로 바꾸거나 ÷2). ⚠ `-1`=평점없음 별도 처리. 정책 확정. |
| `numberOfReviews` | `numberOfReviews` | |
| `images[]` | `images[].large` | `responseOptions=images` 필요 |
| `numberOfProviders` | `numberOfProviders` | |
| `location`(표시 문자열) | `address` 또는 destination 조합 | 앱은 "서울 중구"식 문자열 |
| `propertyType`(라벨) | `propertyType`(숫자) | ⚠ constants-mapping `propertyType`로 숫자→한글 |
| `amenities[]`(라벨) | `features`(숫자[]) | ⚠ constants-mapping `facility`로 숫자→한글 |
| `topRates[]` | `rates[]`(`responseOptions=topRates`, 최대 4) | 아래 표 |

KAYAK `HotelRate` → 앱 `TopRate`
| 앱 필드 | KAYAK | 비고 |
|---|---|---|
| `providerName`/`providerLogo` | `providerIndex`→ `providers[]`의 name·logo | providers 배열에서 index로 조회. ⚠ KAYAK `logo`는 **이미지 URL**(앱은 'A'식 1글자 배지 가정) → 로고 이미지로 바꾸거나 name 첫 글자 파생 |
| `totalRate` | `totalRate` | currencyCode=KRW로 요청 시 원화 |
| `isCheapestRate` | `isCheapestRate` | |
| `inclusions[]` | `inclusions[]`(0~4) | ⚠ 앱은 0(조식)만 사용. 1~4(점심/저녁/식사/올인) 표시 정책 |
| `hasFreeCancellation`/`canPayLater`/`availableRooms` | 동일명 | |
| `cashback` | `providers[providerIndex].cashback` | ⚠ KAYAK PERCENTAGE/FLAT(+cap,currency). 앱은 PERCENTAGE/NONE만 → FLAT 표시 정책 + cap 반영 여부 결정 |
| **`bookUri`** | `rates[].bookUri` | **딥링크. 앱 TopRate에 bookUri 추가 권장**(현재 없음 → 아웃링크 폴백 대신 실 bookUri 사용) |

## 5. 필드 매핑 — 상세(단일)
KAYAK `SingleHotelSearchResponse` → 앱 `HotelDetail`
| 앱 필드 | KAYAK | 비고 |
|---|---|---|
| name/starRating/location | `name`/`starRating`/`address`(+place) | 단일 응답 최상위에 존재 |
| `guestRating` | ⚠ `reviews.guestRatings.OVERALL` | 단일 응답 최상위엔 **guestRating 없음**(0~10·`-1`=평점없음) |
| `numberOfReviews` | ⚠ `reviews.numberOfReviews` | 단일 응답 최상위엔 **없음** |
| `propertyType` | ⚠ 단일 응답에 **없음** | 다중검색 결과 캐시 또는 static feed에서 보강 |
| `description` | `description` | `responseOptions=description` |
| `facilities[]`(tag,label) | `features`(숫자[]) + `featureTags[]` + constants `facility` | 숫자→tag/label 매핑 |
| `policies`(checkin/out/cancel) | `policies[]`(code,name,description) | |
| `images[]`(url,tag) | `images[].large`(/small) | ⚠ 검색·단일 이미지는 large/small만 — **tag 없음**. tag는 static feed 이미지에만 있으니 병합 시에만 매핑 |
| `place`(lat,lon,address) | `latitude`,`longitude`,`address`(+`place`) | |
| `reviews.overall` | `reviews.guestRatings.OVERALL` | ⚠ 0~10 스케일 |
| `reviews.categories[]` | `reviews.guestRatings`(LOCATION/COMFORT…) | 키→라벨 |
| `reviews.items[]`(author/score/date/text) | ⚠ **KAYAK 미제공**(quotes/aspects/sentiment만) | 개별 리뷰(작성자·날짜)는 없음 → 인용구(quotes)·문장(aspects)로 대체하거나 리뷰탭 구성 조정 |
| `providers[]` / `results[](rates)` | `providers[]` / `results[]` | 가격비교 탭 |
| `isComplete` | `isComplete` | 폴링 |

## 6. 딥링크 [이동→] + 회원 추적 (`p=`)
- 검색/상세 응답의 `bookUri`는 이미 `…/in?cluster=…&a={AID}&p=&cc=&mc=&lc=&url=…&utid=…` 형태(예시: `hapi_affiliate.raml` 의 bookUri).
  - `a=` = Affiliate ID(우리 `kan_318930_594068`) — 이미 박혀서 옴.
  - `p=` = **회원 라벨(빈 값)** → **여기에 회원 식별 라벨을 넣어** 새 탭으로 열면 Reporting에서 그 회원으로 집계됨.
- **구현 방향(앱 `lib/outlink.ts`/`Outlink.tsx`)**: 현재 `trackedBookUri()`가 `userTrackId`를 **쿼리 끝에 덧붙임**(Reporting `labels`와 연결 안 됨) → **`bookUri`의 `p=` 파라미터 값을 회원 라벨로 set/치환**하도록 변경. ⚠ URL 파서(`URL`/`URLSearchParams`)로 **`p`만 교체하고 나머지 쿼리와 중첩 `url=`(이미 인코딩된 목적지)·`utid`·`cookieOverrides`는 그대로 보존**. 라벨 인코딩 규칙은 `[Getting Started > Tracking 확정]`. `userTrackId`(세션 식별)는 검색 API 파라미터로 별도 유지.
- 클릭 시점: **사용자 클릭 핸들러 안에서** `window.open(finalBookUri, '_blank')`(팝업 차단 회피). 현재 `Outlink.tsx`에 교체 지점·오류 폴백 anchor(`href={bookUri}`)가 이미 주석으로 준비됨.
- `userTrackId`(sessionStore에 이미 존재)는 검색 호출의 `userTrackId` 파라미터로 전달(세션 식별).

## 7. 정적 데이터(constants-mapping)
- `?types=facility,property,placeType,theme,chain,imageTag&languageCode=ko_KR` → 숫자 ID ↔ 한글 이름 표. **중계 서버에서 받아 캐시(일/주 단위 갱신)**. ⚠ 요청 `types` 값은 **`property`**(응답 필드명만 `propertyType`). ⚠ **응답은 NDJSON**(`application/x-ndjson`) → 한 줄 = JSON 한 건, 줄 단위 파싱.
- 용도: 검색·상세의 `propertyType`(숫자)·`features`(숫자[])·`themes`/`chains`·이미지 `tag`를 **한글 라벨**로 변환(필터칩·편의시설 표시).
- 대용량 호텔/장소 DB가 필요하면 `/hotelfeed`·`/placefeed`(NDJSON, `lastId`+`pageSize` 페이지네이션, pageSize 1,000+ 권장)로 적재.

## 8. 캐시백 리포팅 (마이 > 캐시백)
- 호출: `GET …/transactions/hotels?apiKey={reportingKey}&startDate=&endDate=&labels={회원라벨}` + 헤더 `X-Version: 2.0`. **IP + Key 둘 다 필수 → 반드시 중계 서버.**
- KAYAK `TransactionsResponse` → 앱 `CashbackTxn`
| 앱 필드 | KAYAK | 비고 |
|---|---|---|
| `bookingDate` | `bookingDate` | |
| `hotelName`/`hotelCity` | `hotelName`/`hotelCity` | `/hotels` vertical일 때 포함 |
| `siteBrandCode` | `siteBrandCode` | Kayak/HotelsCombined |
| `localisedBookingValue` | `localisedBookingValue` | 현지화(KRW) 예약액 |
| `cashbackAmountLocalised` | `cashbackAmountLocalised` | 현지화 캐시백액 |
| `paymentMonth` | `paymentMonth` | 정산월 |
| `status` | `transactionStatus`(Active(1)/Cancelled(11)) + `paymentMonth` | ⚠ **아래 상태 규칙** |
- ⚠ **구현 주의**: `transactionStatus`는 문자열이 아니라 **객체 `{ name, statusCode }`** (Active=1, Cancelled=11). `paymentMonth`는 RAML 타입이 `date` → 앱 `YYYY-MM` 문자열로 **포맷 변환** 필요.
- ⚠ **상태(`CashbackStatus`) 매핑 규칙**(KAYAK엔 Approved 상태값 없음):
  - `statusCode=11(Cancelled)` → **Cancelled**
  - `statusCode=1(Active)` + **제휴 포털 지급보고서 status=Approved(또는 해당 paymentMonth 정산일 경과 확인)** → **Approved(지급완료)**
  - `statusCode=1(Active)` + 그 전(정산 전) → **Waiting(지급대기)**
  - ⚠ **`paymentMonth` 값이 채워졌다는 사실만으로 Approved 단정 금지.** 최종 확정은 제휴 포털 "지급 보고서" 기준이라 Reporting API만으론 근사 → "정산일 경과 확인" 로직 또는 포털 연동 정책 확정 필요.
- ⚠ 통화: `localisedCurrencyCode` 계정단위 KRW 고정. 다통화는 `cashbackAmountUSD`+`exchangeRate`로 환산(KAYAK 회신 대기).
- 데이터 시점: ET 기준 + 테스트 예약은 익일 늦은 밤 이후 반영. 캐시 1시간(요청 동일 시) — 필요 시 `IsCacheEnabled=false`.

## 9. 기존 앱 교체 지점 (현행 코드 기준)
| 위치 | 현행 | 변경 |
|---|---|---|
| `main.tsx` `enableMocking` | MSW 항상 ON | 실연동 시 호출 제거(또는 개발 폴백만) |
| `mocks/` | 목 핸들러·데이터 | 운영 빌드에서 제외 |
| `screens/Results.tsx` `fetch('/api/hotels')` | MSW 응답 | **중계 서버 응답**(앱 타입으로 변환됨) — 경로 유지 |
| `screens/Detail.tsx` `fetch('/api/hotel/:id')` | 〃 | 〃 + 폴링(isComplete) |
| `screens/Search.tsx` `fetch('/api/autocomplete')` | 〃 | 〃 |
| `lib/outlink.ts`·`Outlink.tsx` | bookUri 폴백·시뮬 | 실 bookUri + `p=` 라벨 주입 + window.open |
| `types/index.ts` `TopRate` | bookUri 없음 | `bookUri` 필드 추가 |
| Cloudflare `_redirects` | `/* /index.html 200` | `/api/*` 는 SPA fallback 제외(중계/Functions로) |
| 통화/번역 | KRW·한글 고정 | `currencyCode`/`languageCode` 파라미터화(환율·i18n) |
| 보안 헤더 | 없음 | 외부 이미지·중계 도메인 허용 CSP |

## 10. 단계별 체크리스트
- **P1 연결**: 중계 서버에서 자동완성·검색 1회 호출 → 200 + 실데이터. (개발실 IP 확인: 호출 출발 IP=58.75.223.130)
- **P2 화면**: §3~§5 매핑 어댑터 구현 → 결과·상세·자동완성 실데이터 렌더. constants-mapping 캐시 적용.
- **P3 딥링크**: `p=` 회원 라벨 주입 + 클릭 핸들러 window.open. 실제 예약 페이지 도착 확인.
- **P4 캐시백**: 무료취소 호텔 테스트 예약 → 익일 Reporting 조회 → 상태/금액 매핑 표시.
- **P5 운영**: 운영 HOST·운영 고정IP 화이트리스트·통화/번역·CSP 마감 → 오픈.

## 11. 미정(확정 후 채움)
1. `[운영 HOST]` (Getting Started) 2. `p=` 인코딩 규칙(Tracking) 3. 호출 쿼터 4. guestRating 스케일(0~10 vs 0~5) 5. FLAT 캐시백·cap 표시 6. Approved 최종확정 판정 7. 다통화(엔화 등).
