import type { Request } from 'express';

export interface PaginationParams {
  skip: number;
  take: number;
  page: number;
  limit: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePagination(req: Request): PaginationParams {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  return { skip, take: limit, page, limit };
}

export function buildPaginationMeta(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.ceil(total / limit) };
}
