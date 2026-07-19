export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface PublicUser {
  id: string;
  nickname: string;
  realName: string;
  studentCode: string | null;
  role: string;
  level: number;
  profileImage: string | null;
}
