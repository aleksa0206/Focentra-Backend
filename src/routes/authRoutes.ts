import { Router } from 'express';
import * as auth from '../controllers/authController';
import { authRateLimiter } from '../middleware/dbRateLimiter';
import { authMiddleware } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import {
  emailSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
  twoFactorCodeSchema,
  verifyTwoFactorLoginSchema,
} from '../validation/authSchemas';

const router = Router();

router.post('/auth/register', authRateLimiter, validate(registerSchema), auth.register);
router.post('/auth/verify-email', authRateLimiter, validate(tokenSchema), auth.verifyEmail);
router.post(
  '/auth/resend-verification',
  authRateLimiter,
  validate(emailSchema),
  auth.resendVerification
);
router.post('/auth/login', authRateLimiter, validate(loginSchema), auth.login);
router.post(
  '/auth/2fa/verify-login',
  authRateLimiter,
  validate(verifyTwoFactorLoginSchema),
  auth.verifyTwoFactorLogin
);
router.post('/auth/refresh', auth.refresh);
router.post('/auth/logout', auth.logout);
router.post('/auth/forgot-password', authRateLimiter, validate(emailSchema), auth.forgotPassword);
router.post(
  '/auth/reset-password',
  authRateLimiter,
  validate(resetPasswordSchema),
  auth.resetPassword
);

router.get('/auth/me', authMiddleware, auth.me);
router.post('/auth/2fa/setup', authMiddleware, auth.setupTwoFactor);
router.post(
  '/auth/2fa/confirm',
  authMiddleware,
  validate(twoFactorCodeSchema),
  auth.confirmTwoFactor
);
router.delete('/auth/2fa', authMiddleware, validate(twoFactorCodeSchema), auth.disableTwoFactor);

export default router;
