import type { Request, Response } from 'express';
import * as timeEntryService from '../services/timeEntryService';
import * as progressEntryService from '../services/progressEntryService';
import { listTimeEntriesQuery } from '../validation/entrySchemas';
import { idParam } from '../validation/common';
import { buildPaginationMeta, parsePagination } from '../utils/pagination';

const entryId = (req: Request) => idParam.parse(req.params.entryId);

export async function runningTimer(req: Request, res: Response) {
  res.json({ entry: await timeEntryService.getRunning(req.user!.userId) });
}

export async function startTimer(req: Request, res: Response) {
  res.status(201).json(await timeEntryService.startTimer(req.user!.userId, req.body));
}

export async function stopTimer(req: Request, res: Response) {
  res.json(await timeEntryService.stopTimer(req.user!.userId));
}

export async function listTimeEntries(req: Request, res: Response) {
  const filters = listTimeEntriesQuery.parse(req.query);
  const pagination = parsePagination(req);
  const { data, total } = await timeEntryService.listEntries(req.user!.userId, filters, pagination);
  res.json({ data, meta: buildPaginationMeta(total, pagination.page, pagination.limit) });
}

export async function createTimeEntry(req: Request, res: Response) {
  res.status(201).json(await timeEntryService.createEntry(req.user!.userId, req.body));
}

export async function updateTimeEntry(req: Request, res: Response) {
  res.json(await timeEntryService.updateEntry(entryId(req), req.user!.userId, req.body));
}

export async function deleteTimeEntry(req: Request, res: Response) {
  await timeEntryService.deleteEntry(entryId(req), req.user!.userId);
  res.status(204).send();
}

export async function updateProgressEntry(req: Request, res: Response) {
  res.json(await progressEntryService.updateEntry(entryId(req), req.user!.userId, req.body));
}

export async function deleteProgressEntry(req: Request, res: Response) {
  await progressEntryService.deleteEntry(entryId(req), req.user!.userId);
  res.status(204).send();
}
