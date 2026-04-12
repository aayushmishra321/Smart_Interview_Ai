import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import Interview from '../models/Interview';
import { asyncHandler } from '../middleware/errorHandler';
import emailService from '../services/email';
import logger from '../utils/logger';

const router = express.Router();

// Schedule interview
router.post('/schedule', [
  body('type')
    .isIn(['behavioral', 'technical', 'coding', 'system-design'])
    .withMessage('Type must be one of: behavioral, technical, coding, system-design'),
  body('scheduledTime')
    .isISO8601()
    .withMessage('Scheduled time must be a valid ISO 8601 date'),
  body('settings.role')
    .notEmpty()
    .withMessage('Target role is required'),
  body('settings.difficulty')
    .isIn(['easy', 'medium', 'hard'])
    .withMessage('Difficulty must be one of: easy, medium, hard'),
  body('settings.duration')
    .isInt({ min: 15, max: 120 })
    .withMessage('Duration must be between 15 and 120 minutes'),
], asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
    });
    return;
  }

  const { type, scheduledTime, settings, reminderEnabled } = req.body;

  try {
    // Validate scheduled time is in the future
    const scheduledDate = new Date(scheduledTime);
    if (scheduledDate <= new Date()) {
      res.status(400).json({
        success: false,
        error: 'Scheduled time must be in the future',
      });
      return;
    }

    // Create scheduled interview
    const interview = new Interview({
      userId: req.user!.userId,
      type,
      status: 'scheduled',
      scheduledTime: scheduledDate,
      settings: {
        role: settings.role,
        difficulty: settings.difficulty,
        duration: settings.duration,
        includeVideo: settings.includeVideo !== false,
        includeAudio: settings.includeAudio !== false,
        includeCoding: settings.includeCoding || false,
      },
      questions: [], // Questions will be generated when interview starts
      responses: [],
      session: {
        startTime: null,
        endTime: null,
        actualDuration: null,
        metadata: {
          reminderEnabled: reminderEnabled !== false,
          reminderSent: false,
        },
      },
    });

    await interview.save();

    logger.info(`Interview scheduled: ${interview._id} for ${scheduledDate.toISOString()}`);

    // Send confirmation email
    try {
      // TODO: Implement scheduling confirmation email
      logger.info(`Scheduling confirmation email would be sent to user ${req.user!.userId}`);
    } catch (emailError) {
      logger.error('Failed to send scheduling confirmation email:', emailError);
    }

    res.status(201).json({
      success: true,
      data: {
        ...interview.toObject(),
        id: interview._id.toString(),
      },
      message: 'Interview scheduled successfully',
    });
  } catch (error: any) {
    logger.error('Schedule interview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to schedule interview',
      message: error.message,
    });
  }
}));

// Get scheduled interviews
router.get('/scheduled', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const interviews = await Interview.find({
      userId: req.user!.userId,
      status: 'scheduled',
      scheduledTime: { $gte: new Date() },
    })
      .sort({ scheduledTime: 1 })
      .select('type scheduledTime settings createdAt');

    res.json({
      success: true,
      data: interviews,
    });
  } catch (error: any) {
    logger.error('Get scheduled interviews error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get scheduled interviews',
      message: error.message,
    });
  }
}));

// Reschedule interview
router.put('/:id/reschedule', [
  body('scheduledTime')
    .isISO8601()
    .withMessage('Scheduled time must be a valid ISO 8601 date'),
], asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
    });
    return;
  }

  const { id } = req.params;
  const { scheduledTime } = req.body;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
      status: 'scheduled',
    });

    if (!interview) {
      res.status(404).json({
        success: false,
        error: 'Scheduled interview not found',
      });
      return;
    }

    // Validate new scheduled time is in the future
    const newScheduledDate = new Date(scheduledTime);
    if (newScheduledDate <= new Date()) {
      res.status(400).json({
        success: false,
        error: 'New scheduled time must be in the future',
      });
      return;
    }

    // Update scheduled time
    interview.scheduledTime = newScheduledDate;
    if (interview.session.metadata) {
      interview.session.metadata.reminderSent = false; // Reset reminder flag
    }

    await interview.save();

    logger.info(`Interview rescheduled: ${id} to ${newScheduledDate.toISOString()}`);

    // Send rescheduling confirmation email
    try {
      // TODO: Implement rescheduling confirmation email
      logger.info(`Rescheduling confirmation email would be sent to user ${req.user!.userId}`);
    } catch (emailError) {
      logger.error('Failed to send rescheduling confirmation email:', emailError);
    }

    res.json({
      success: true,
      data: interview,
      message: 'Interview rescheduled successfully',
    });
  } catch (error: any) {
    logger.error('Reschedule interview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reschedule interview',
      message: error.message,
    });
  }
}));

// Cancel scheduled interview
router.delete('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
      status: 'scheduled',
    });

    if (!interview) {
      res.status(404).json({
        success: false,
        error: 'Scheduled interview not found',
      });
      return;
    }

    // Update status to cancelled
    interview.status = 'cancelled';
    await interview.save();

    logger.info(`Interview cancelled: ${id}`);

    // Send cancellation confirmation email
    try {
      // TODO: Implement cancellation confirmation email
      logger.info(`Cancellation confirmation email would be sent to user ${req.user!.userId}`);
    } catch (emailError) {
      logger.error('Failed to send cancellation confirmation email:', emailError);
    }

    res.json({
      success: true,
      message: 'Interview cancelled successfully',
    });
  } catch (error: any) {
    logger.error('Cancel interview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel interview',
      message: error.message,
    });
  }
}));

// Get upcoming interviews (next 7 days)
router.get('/upcoming', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const interviews = await Interview.find({
      userId: req.user!.userId,
      status: 'scheduled',
      scheduledTime: {
        $gte: now,
        $lte: nextWeek,
      },
    })
      .sort({ scheduledTime: 1 })
      .select('type scheduledTime settings createdAt');

    res.json({
      success: true,
      data: interviews,
    });
  } catch (error: any) {
    logger.error('Get upcoming interviews error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get upcoming interviews',
      message: error.message,
    });
  }
}));

// Send reminder for upcoming interview (cron job endpoint)
router.post('/:id/send-reminder', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      status: 'scheduled',
    }).populate('userId', 'email profile.firstName');

    if (!interview) {
      res.status(404).json({
        success: false,
        error: 'Scheduled interview not found',
      });
      return;
    }

    // Check if reminder already sent
    if (interview.session.metadata?.reminderSent) {
      res.status(400).json({
        success: false,
        error: 'Reminder already sent',
      });
      return;
    }

    // Send reminder email
    try {
      const user = interview.userId as any;
      // TODO: Implement reminder email template
      logger.info(`Reminder email would be sent to ${user.email} for interview ${id}`);
      
      // Update reminder flag
      if (!interview.session.metadata) {
        interview.session.metadata = {};
      }
      interview.session.metadata.reminderSent = true;
      await interview.save();

      res.json({
        success: true,
        message: 'Reminder sent successfully',
      });
    } catch (emailError) {
      logger.error('Failed to send reminder email:', emailError);
      res.status(500).json({
        success: false,
        error: 'Failed to send reminder email',
      });
    }
  } catch (error: any) {
    logger.error('Send reminder error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send reminder',
      message: error.message,
    });
  }
}));

export default router;
