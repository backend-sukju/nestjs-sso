import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { CLIENTS } from './config/clients.js';
import { RESOURCES } from './config/resources.js';
import { createInteractionRouter } from './interactions.js';
import { createProvider } from './provider.factory.js';

@Module({})
class OpModule {}

const PORT = Number(process.env.PORT ?? 3000);
const ISSUER = process.env.ISSUER ?? `http://localhost:${PORT}`;

async function bootstrap(): Promise<void> {
  // bodyParser:false 가 필수 — oidc-provider 는 요청 스트림을 직접 읽는다.
  // 앞단에서 body 를 소비해버리면 토큰 엔드포인트가 깨진다.
  const app = await NestFactory.create<NestExpressApplication>(OpModule, { bodyParser: false });
  app.enableCors({ origin: true, credentials: true });

  const provider = await createProvider(ISSUER);

  const index = express.Router();
  index.get('/', (_req, res) => {
    res.json({
      name: 'NestJS + oidc-provider 버전 (OpenID Certified 구현체)',
      issuer: ISSUER,
      discovery: `${ISSUER}/.well-known/openid-configuration`,
      demoUsers: [
        { username: 'alice', password: 'password123' },
        { username: 'bob', password: 'password123' },
      ],
      registeredClients: CLIENTS.map((c) => ({
        client_id: c.client_id,
        name: c.client_name,
        scope: c.scope,
        allowed_resources: (c as any).allowed_resources,
      })),
      registeredResources: RESOURCES.map((r) => ({
        identifier: r.identifier,
        name: r.name,
        scopes: r.scopes.map((s) => s.name),
      })),
    });
  });

  // 순서가 중요하다: 우리 화면 → 그 외 전부 oidc-provider
  app.use(index);
  app.use(createInteractionRouter(provider));
  app.use(provider.callback());

  await app.listen(PORT);

  const log = new Logger('Bootstrap');
  log.log(`SSO 서버(oidc-provider) 기동: ${ISSUER}`);
  log.log(`Discovery: ${ISSUER}/.well-known/openid-configuration`);
}

void bootstrap();
