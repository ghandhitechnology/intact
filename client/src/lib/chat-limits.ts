export const CHAT_MAX_OTHER_MEMBERS = 20;
export const CHAT_ROOM_CAPACITY = CHAT_MAX_OTHER_MEMBERS + 1;
export const CHAT_MIN_GROUP_TITLE_LENGTH = 2;

export function chatTooManyMembersMessage() {
  return `한 대화방에는 본인 제외 최대 ${CHAT_MAX_OTHER_MEMBERS}명까지 초대할 수 있습니다.`;
}

export function takeCompletedParticipantCodes(value: string) {
  const hasTerminator = /[\s,]$/.test(value);
  const parts = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  if (hasTerminator) return { completed: parts, rest: '' };
  return { completed: parts.slice(0, -1), rest: parts.at(-1) ?? '' };
}
