import { asyncRouter } from '../lib/async-router.ts';
import { requireAuth } from './auth.ts';
import { getIntake, saveIntake } from '../db/intake.ts';
import { getUserSummary } from '../db/users.ts';
import { IntakeValidationError, validateIntakeDraft } from '../../shared/intake.ts';

export const intakeRouter = asyncRouter();
intakeRouter.use(requireAuth);
intakeRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
intakeRouter.get('/', async (req, res) => {
  res.json({ intake: await getIntake(req.userId!) });
});
intakeRouter.get('/export', async (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="ese-consultation-intake.json"');
  res.json({ intake: await getIntake(req.userId!) });
});
intakeRouter.put('/', async (req, res) => {
  let draft;
  try { draft = validateIntakeDraft(req.body); }
  catch (error) {
    if (error instanceof IntakeValidationError) { res.status(400).json({ error: error.message }); return; }
    throw error;
  }
  if (!draft.storageConsent) { res.status(400).json({ error: 'Choose to save these answers before sending them.' }); return; }
  const intake = await saveIntake(req.userId!, draft);
  res.json({ intake, user: await getUserSummary(req.userId!) });
});
