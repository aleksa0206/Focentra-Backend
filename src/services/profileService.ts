import * as userRepository from '../repositories/userRepository';
import * as goalRepository from '../repositories/goalRepository';
import * as timeEntryRepository from '../repositories/timeEntryRepository';
import * as progressEntryRepository from '../repositories/progressEntryRepository';
import { verifyPassword } from './authService';
import { toGoalDto } from './goalService';
import { toTimeEntryDto } from './timeEntryService';
import { toProgressEntryDto } from './progressEntryService';
import { UnauthorizedError } from '../errors/UnauthorizedError';
import { logger } from '../config/logger';

export async function updateProfile(userId: number, input: { name?: string; timezone?: string }) {
  return await userRepository.updateProfile(userId, input);
}

/**
 * Deletes the account and everything it owns. Goals the user owns go too, also for their
 * members; on other people's goals the user's entries simply disappear.
 */
export async function deleteAccount(userId: number, password: string) {
  await verifyPassword(userId, password);
  await userRepository.remove(userId);
  logger.info({ userId }, 'Account deleted');
}

export async function exportData(userId: number) {
  const user = await userRepository.findSafeById(userId);
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }
  const [active, archived, timeEntries, progressEntries] = await Promise.all([
    goalRepository.findGoalsForUser(userId, false),
    goalRepository.findGoalsForUser(userId, true),
    timeEntryRepository.findAllForUser(userId),
    progressEntryRepository.findAllForUser(userId),
  ]);
  return {
    exportedAt: new Date(),
    user,
    goals: [...active, ...archived].map(({ goal, role }) => toGoalDto(goal, role)),
    timeEntries: timeEntries.map((e) => toTimeEntryDto(e)),
    progressEntries: progressEntries.map(toProgressEntryDto),
  };
}
