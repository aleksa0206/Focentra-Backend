// Every route here requires a signed-in user. Express 5 forwards rejected promises from async
// handlers to the error middleware, so handlers need no try/catch.
import { Router } from 'express';
import * as goals from '../controllers/goalController';
import * as entries from '../controllers/entryController';
import * as account from '../controllers/accountController';
import { authMiddleware } from '../middleware/authMiddleware';
import { authRateLimiter } from '../middleware/dbRateLimiter';
import { validate } from '../middleware/validate';
import { createGoalSchema, updateGoalSchema } from '../validation/goalSchemas';
import {
  createProgressEntrySchema,
  createTimeEntrySchema,
  startTimerSchema,
  updateProgressEntrySchema,
  updateTimeEntrySchema,
} from '../validation/entrySchemas';
import { passwordConfirmationSchema, updateProfileSchema } from '../validation/authSchemas';

const router = Router();
router.use(authMiddleware);

router.patch('/me', validate(updateProfileSchema), account.updateProfile);
router.delete('/me', authRateLimiter, validate(passwordConfirmationSchema), account.deleteAccount);
router.get('/me/export', account.exportData);

router.get('/goals', goals.list);
router.post('/goals', validate(createGoalSchema), goals.create);
router.get('/goals/:goalId', goals.get);
router.patch('/goals/:goalId', validate(updateGoalSchema), goals.update);
router.delete('/goals/:goalId', goals.remove);
router.get('/goals/:goalId/chart', goals.chart);
router.get('/goals/:goalId/periods', goals.periods);
router.get('/goals/:goalId/members', goals.members);
router.delete('/goals/:goalId/members/:userId', goals.removeMember);
router.get('/goals/:goalId/invites', goals.invites);
router.post('/goals/:goalId/invites', goals.createInvite);
router.delete('/goals/:goalId/invites/:inviteId', goals.revokeInvite);
router.get('/goals/:goalId/time-entries', goals.timeEntries);
router.get('/goals/:goalId/progress-entries', goals.progressEntries);
router.post(
  '/goals/:goalId/progress-entries',
  validate(createProgressEntrySchema),
  goals.createProgressEntry
);

// Tokens are guessable only by brute force, which the rate limit makes pointless.
router.get('/invites/:token', authRateLimiter, account.previewInvite);
router.post('/invites/:token/accept', authRateLimiter, account.acceptInvite);

router.get('/timer', entries.runningTimer);
router.post('/timer/start', validate(startTimerSchema), entries.startTimer);
router.post('/timer/stop', entries.stopTimer);

router.get('/time-entries', entries.listTimeEntries);
router.post('/time-entries', validate(createTimeEntrySchema), entries.createTimeEntry);
router.patch('/time-entries/:entryId', validate(updateTimeEntrySchema), entries.updateTimeEntry);
router.delete('/time-entries/:entryId', entries.deleteTimeEntry);

router.patch(
  '/progress-entries/:entryId',
  validate(updateProgressEntrySchema),
  entries.updateProgressEntry
);
router.delete('/progress-entries/:entryId', entries.deleteProgressEntry);

router.get('/stats/heatmap', account.heatmap);
router.get('/stats/trend', account.trend);
router.get('/stats/breakdown', account.breakdown);

export default router;
