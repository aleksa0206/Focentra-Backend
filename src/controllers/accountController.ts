import type { Request, Response } from 'express';
import * as profileService from '../services/profileService';
import * as statsService from '../services/statsService';
import * as memberService from '../services/memberService';
import { heatmapQuery, rangeQuery, trendQuery } from '../validation/entrySchemas';
import { z } from 'zod';

const inviteToken = (req: Request) => z.string().min(1).max(200).parse(req.params.token);

export async function updateProfile(req: Request, res: Response) {
  res.json(await profileService.updateProfile(req.user!.userId, req.body));
}

export async function deleteAccount(req: Request, res: Response) {
  await profileService.deleteAccount(req.user!.userId, req.body.password);
  res.clearCookie('refreshToken', { path: '/auth' });
  res.status(204).send();
}

export async function exportData(req: Request, res: Response) {
  res.setHeader('Content-Disposition', 'attachment; filename="focentra-export.json"');
  res.json(await profileService.exportData(req.user!.userId));
}

export async function heatmap(req: Request, res: Response) {
  res.json(await statsService.heatmap(req.user!.userId, heatmapQuery.parse(req.query)));
}

export async function trend(req: Request, res: Response) {
  res.json(await statsService.trend(req.user!.userId, trendQuery.parse(req.query).weeks));
}

export async function breakdown(req: Request, res: Response) {
  res.json(await statsService.breakdown(req.user!.userId, rangeQuery.parse(req.query)));
}

export async function previewInvite(req: Request, res: Response) {
  res.json(await memberService.previewInvite(inviteToken(req), req.user!.userId));
}

export async function acceptInvite(req: Request, res: Response) {
  res.json(await memberService.acceptInvite(inviteToken(req), req.user!.userId));
}
