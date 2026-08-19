# oidc-provider 동작 노트

`src/provider.factory.ts`의 설정 중 "왜 이렇게 했는지" 설명이 필요한 것들입니다.
대부분 기본값이 스펙에 더 충실하거나 더 엄격해서, 이 목업의 편의를 위해 조정한 항목입니다.
**운영으로 가져갈 때는 각각 다시 판단해야 합니다.**

## 조정한 기본값

### `conformIdTokenClaims: false`
기본값(`true`)이면 code 플로우의 id_token에는 `sub`만 담기고 프로필·이메일은
UserInfo로 따로 가져가야 합니다 (OIDC Core 권장). 데모 화면에서 클레임을 바로 보여주려고 껐습니다.
운영에서는 켜두는 편이 낫습니다 — id_token이 작아지고, 클레임 최신성도 UserInfo 쪽이 낫습니다.

### `rotateRefreshToken: true`
기본값은 public 클라이언트에만 회전을 적용합니다. confidential 클라이언트에도 회전을 켰습니다.
탈취 감지 관점에서 켜두는 게 맞습니다.

### `issueRefreshToken` 재정의
스펙상 `offline_access`는 `prompt=consent`가 함께 와야 유효하고, oidc-provider는
조건이 안 맞으면 scope에서 **조용히 제거**합니다 (`lib/actions/authorization/check_scope.js:26`).
데모에서 리프레시 버튼이 동작하도록 클라이언트 등록 기준으로만 판단하게 바꿨습니다.
운영에서는 기본 동작을 따르고, 앱이 `prompt=consent`를 보내게 하는 편이 맞습니다.

### `fetch` 훅으로 SSRF 방어 우회 (localhost 한정)
oidc-provider는 아웃바운드 요청(백채널 로그아웃 등)이 특수 용도 IP로 가는 것을 차단합니다.

```
백채널 로그아웃 통지 실패: portal-app — fetch failed
  cause=hostname resolves to a special-use IP address
```

이 목업은 앱이 전부 localhost라 통지가 전부 막혔습니다. `localhost`에 한해 보호 디스패처를
제거했습니다. **운영에서는 절대 하면 안 됩니다** — 내부망 스캔을 막는 장치입니다.

### `useGrantedResource: () => false`
클라이언트가 `resource`를 명시하지 않으면 토큰을 특정 API에 묶지 않습니다.
묶이면 그 토큰은 UserInfo에서 거부됩니다(아래 참고).

### `interactions.url: () => '/interaction'`
상호작용 URL에 uid를 넣지 않습니다. oidc-provider가 상호작용 쿠키의 `path`를 이 URL로 잡기 때문에,
`/interaction/<uid>`로 하면 폼 POST 경로가 쿠키 범위를 벗어납니다.

### `logoutSource` 자동 제출
기본 로그아웃 확인 화면(영문 "Do you want to sign-out?")을 자동 제출 폼으로 바꿨습니다.
확인 단계 자체는 남아 있습니다.

## 알아둘 기본 동작

건드리지 않았지만 직접 구현했다면 놓쳤을 것들입니다.

### 인가 코드 재사용 시 grant 전체를 폐기
재사용을 **탈취 신호**로 보고 그 grant에서 나온 액세스·리프레시 토큰을 전부 무효화합니다
(`lib/helpers/grant_common.js:30`). 코드만 거부하는 것보다 훨씬 강한 방어입니다.
`npm run test:e2e`의 `[10]`이 이 동작을 확인합니다.

### `sid`가 클라이언트마다 다름
`session.sidFor(clientId)`로 RP별 세션 식별자를 발급합니다. 같은 사용자가 여러 앱에
로그인해도 앱끼리 `sid`를 대조해 동일인임을 알 수 없습니다.
`npm run test:multi`의 `[2]`가 이걸 출력합니다.

### aud가 붙은 토큰은 UserInfo에서 거부
`accessToken.aud !== undefined`면 UserInfo 접근을 막습니다 (`lib/actions/userinfo.js:46`).
즉 **UserInfo는 리소스가 아닙니다.** 그래서 `resource`를 지정하지 않은 로그인 토큰은
불투명(opaque) 문자열로 발급됩니다 — 검증할 리소스 서버가 없으니 JWT일 이유도 없다는 관점입니다.
`apps/lib/rp.js`의 `decodeJwt`가 JWT가 아니면 `null`을 반환하는 이유입니다.

### 거부 방식
미등록 `response_type` 등은 리다이렉트하지 않고 에러 화면으로 거부합니다.
또 `response_type=token` 계열의 에러는 query가 아니라 **fragment**로 옵니다.

### `code_verifier` 길이 검증이 먼저
43자 미만이면 PKCE 대조 전에 `invalid_request`로 걸립니다.

## 직접 구현해야 했던 것

라이브러리가 커버하지 않는 부분입니다.

| | 파일 | 이유 |
| --- | --- | --- |
| 토큰 교환 (RFC 8693) | `token-exchange.ts` | oidc-provider에 없음 — `registerGrantType`으로 등록 |
| 리소스(API) 레지스트리 | `config/resources.ts`, `resources.runtime.ts` | **표준 자체가 없음** |
| 로그인·동의 화면 | `interactions.ts`, `views/templates.ts` | 프로토콜이 아니라 UX |

반대로 **클라이언트 등록은 표준(RFC 7591/7592)이 있어서** `features.registration` 한 줄로
DCR 엔드포인트가 생깁니다. `config/clients.ts`의 필드명이 전부 표준 메타데이터인 이유입니다.

## 토큰 교환에서 반드시 지킬 것

`token-exchange.ts`의 scope 계산입니다.

```
최종 scope = 요청 ∩ 원본 토큰 ∩ 클라이언트 허용 ∩ 리소스 지원
```

**원본 토큰과의 교집합이 핵심입니다.** 이걸 빼면 로그인 때 사용자가 동의하지 않은 권한을
교환 단계에서 새로 만들어낼 수 있습니다. `npm run test:multi`의 `[6]`이 이 경로를 막는지 확인합니다.
