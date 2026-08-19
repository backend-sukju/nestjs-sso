/** 세 앱을 한 번에 띄운다. Ctrl+C 로 모두 종료. */
import { fork } from 'node:child_process';
import path from 'node:path';

// ESM 에는 __dirname 이 없다. Node 20.11+ 의 import.meta.dirname 을 쓴다.
const here = import.meta.dirname;

const children = ['portal.js', 'notes.js', 'admin.js'].map((f) =>
  fork(path.join(here, f), { stdio: 'inherit' }),
);

const shutdown = () => {
  children.forEach((c) => c.kill('SIGTERM'));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
