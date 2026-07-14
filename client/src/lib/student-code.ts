export const STUDENT_CODE_REQUIREMENTS =
  '학번은 31/32/33으로 시작하고, 가운데 두 자리는 11~14, 마지막 두 자리는 01~20이어야 합니다.';

export const STUDENT_CODE_PATTERN =
  /^(?:31|32|33)(?:11|12|13|14)(?:0[1-9]|1[0-9]|20)$/;

export function normalizeStudentCode(value: string) {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function isValidStudentCode(value: string) {
  return STUDENT_CODE_PATTERN.test(value);
}
