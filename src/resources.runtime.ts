import { findResource, type ProtectedResource } from './config/resources.js';

export const resourceOf = (identifier: string): ProtectedResource | undefined =>
  findResource(identifier);

/** 클라이언트 메타데이터는 등록 시 준 키 이름 그대로 보존된다 */
const allowedResourcesOf = (client: any): string[] =>
  client.allowed_resources ?? client.allowedResources ?? [];

/**
 * features.resourceIndicators.getResourceServerInfo 구현.
 * "이 resource 는 어떤 aud/scope/토큰 형식을 갖는가" 를 알려주는 지점이고,
 * 클라이언트별 접근 허용 여부도 여기서 막는다.
 */
export async function getResourceServerInfo(
  _ctx: any,
  resourceIndicator: string,
  client: any,
  errors: any,
): Promise<{ scope: string; audience: string; accessTokenTTL: number; accessTokenFormat: string }> {
  const resource = findResource(resourceIndicator);
  if (!resource) {
    throw new errors.InvalidTarget(`등록되지 않은 resource 입니다: ${resourceIndicator}`);
  }
  if (!allowedResourcesOf(client).includes(resourceIndicator)) {
    throw new errors.InvalidTarget('이 클라이언트는 해당 API 에 접근할 수 없습니다');
  }
  return {
    scope: resource.scopes.map((s) => s.name).join(' '),
    audience: resource.identifier,
    accessTokenTTL: resource.accessTokenTTL,
    accessTokenFormat: 'jwt',
  };
}
