export function loginPasswordError(password: string) {
  if (!password) return '비밀번호를 입력해 주세요.';
  if (password.length > 128) return '비밀번호는 128자 이하여야 합니다.';
  return null;
}
