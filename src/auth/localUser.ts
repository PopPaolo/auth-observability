export const localTestUser = {
  username: "walter.white",
  password: "say-my-name",
  token: "heisenberg-local-token",
  displayName: "Walter White",
};

export function isValidLocalLogin(username: string | undefined, password: string | undefined): boolean {
  return username === localTestUser.username && password === localTestUser.password;
}

export function isValidLocalToken(token: string | null): boolean {
  return token === localTestUser.token;
}
