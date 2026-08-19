/**
 * 리소스(API) 레지스트리.
 * ★ OAuth/OIDC 표준에 "리소스 등록" 규격이 없어서, 이 파일만은
 *   oidc-provider 를 써도 직접 만들어야 하는 부분이다.
 *   (클라이언트 등록은 RFC 7591 이 있어서 라이브러리가 대신해준다)
 */
export interface ScopeDefinition {
  name: string;
  description: string;
}

export interface ProtectedResource {
  identifier: string;
  name: string;
  scopes: ScopeDefinition[];
  accessTokenTTL: number;
}

export const RESOURCES: ProtectedResource[] = [
  {
    identifier: 'http://localhost:4100/api',
    name: '메모 앱 API (:4100)',
    scopes: [
      { name: 'notes:read', description: '메모 앱에 저장된 메모 읽기' },
      { name: 'notes:write', description: '메모 앱의 메모 작성·수정' },
    ],
    accessTokenTTL: 600,
  },
];

/**
 * OIDC 표준 scope 설명. 리소스가 소유하는 scope 와 달리 이건 SSO 자신의 것이라
 * 여기 함께 둔다 — scope 이름과 설명이 흩어지지 않게 하는 게 요점.
 */
export const STANDARD_SCOPE_LABELS: Record<string, string> = {
  openid: '로그인 상태 및 사용자 식별자(sub)',
  profile: '이름, 사용자명, 프로필 사진',
  email: '이메일 주소와 인증 여부',
  offline_access: '오프라인 접근 (리프레시 토큰 발급)',
};

export const findResource = (identifier: string): ProtectedResource | undefined =>
  RESOURCES.find((r) => r.identifier === identifier);

/** 동의 화면에서 쓸 scope 설명 = 표준 scope + 각 리소스가 소유한 scope */
export const SCOPE_LABELS: Record<string, string> = {
  ...STANDARD_SCOPE_LABELS,
  ...Object.fromEntries(RESOURCES.flatMap((r) => r.scopes.map((s) => [s.name, s.description]))),
};

/** 모든 리소스가 지원하는 scope 이름 (클라이언트 등록 검증용) */
export const ALL_RESOURCE_SCOPES = RESOURCES.flatMap((r) => r.scopes.map((s) => s.name));
