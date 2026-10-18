import type { Request, Response } from 'express';
import * as goalService from '../services/goalService';
import * as memberService from '../services/memberService';
import * as timeEntryService from '../services/timeEntryService';
import * as progressEntryService from '../services/progressEntryService';
import { listGoalsQuery } from '../validation/goalSchemas';
import { idParam } from '../validation/common';
import { buildPaginationMeta, parsePagination } from '../utils/pagination';

const goalId = (req: Request) => idParam.parse(req.params.goalId);

export async function list(req: Request, res: Response) {
  const { state } = listGoalsQuery.parse(req.query);
  res.json(await goalService.listGoals(req.user!.userId, state === 'archived'));
}

export async function get(req: Request, res: Response) {
  res.json(await goalService.getGoal(goalId(req), req.user!.userId));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await goalService.createGoal(req.user!.userId, req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await goalService.updateGoal(goalId(req), req.user!.userId, req.body));
}

export async function remove(req: Request, res: Response) {
  await goalService.deleteGoal(goalId(req), req.user!.userId);
  res.status(204).send();
}

export async function chart(req: Request, res: Response) {
  res.json(await goalService.getChart(goalId(req), req.user!.userId));
}

export async function periods(req: Request, res: Response) {
  res.json(await goalService.getPeriods(goalId(req), req.user!.userId));
}

export async function members(req: Request, res: Response) {
  res.json(await memberService.listMembers(goalId(req), req.user!.userId));
}

export async function removeMember(req: Request, res: Response) {
  await memberService.removeMember(goalId(req), idParam.parse(req.params.userId), req.user!.userId);
  res.status(204).send();
}

export async function invites(req: Request, res: Response) {
  res.json(await memberService.listInvites(goalId(req), req.user!.userId));
}

export async function createInvite(req: Request, res: Response) {
  res.status(201).json(await memberService.createInvite(goalId(req), req.user!.userId));
}

export async function revokeInvite(req: Request, res: Response) {
  await memberService.revokeInvite(
    goalId(req),
    idParam.parse(req.params.inviteId),
    req.user!.userId
  );
  res.status(204).send();
}

export async function timeEntries(req: Request, res: Response) {
  const pagination = parsePagination(req);
  const { data, total } = await timeEntryService.listGoalEntries(
    goalId(req),
    req.user!.userId,
    pagination
  );
  res.json({ data, meta: buildPaginationMeta(total, pagination.page, pagination.limit) });
}

export async function progressEntries(req: Request, res: Response) {
  const pagination = parsePagination(req);
  const { data, total } = await progressEntryService.listGoalEntries(
    goalId(req),
    req.user!.userId,
    pagination
  );
  res.json({ data, meta: buildPaginationMeta(total, pagination.page, pagination.limit) });
}

export async function createProgressEntry(req: Request, res: Response) {
  res
    .status(201)
    .json(await progressEntryService.createEntry(goalId(req), req.user!.userId, req.body));
}
