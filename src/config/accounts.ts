/** oidc-provider 의 findAccount 에 물리는 사용자 저장소 (직접 짠 버전과 동일한 데이터) */
export interface DemoUser {
  id: string;
  username: string;
  password: string;
  name: string;
  email: string;
  emailVerified: boolean;
  picture: string;
}

export const USERS: DemoUser[] = [
  {
    id: 'user-1001', username: 'alice', password: 'password123',
    name: '앨리스', email: 'alice@example.com', emailVerified: true,
    picture: 'https://i.pravatar.cc/150?u=alice',
  },
  {
    id: 'user-1002', username: 'bob', password: 'password123',
    name: '밥', email: 'bob@example.com', emailVerified: false,
    picture: 'https://i.pravatar.cc/150?u=bob',
  },
];

export const findUserById = (id: string) => USERS.find((u) => u.id === id);

export const validateUser = (username: string, password: string) =>
  USERS.find((u) => u.username === username && u.password === password);
