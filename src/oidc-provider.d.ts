/**
 * oidc-provider 9 는 타입 정의를 함께 배포하지 않는다.
 * (@types/oidc-provider 는 v8 기준이라 v9 설정 키와 어긋난다)
 * 모듈 선언만 해두고 설정 객체는 런타임에서 검증한다 — 잘못된 키를 주면
 * oidc-provider 가 기동 시점에 TypeError 로 알려준다.
 */
declare module 'oidc-provider';
