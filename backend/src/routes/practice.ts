import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import geminiService from '../services/gemini';
import logger from '../utils/logger';

const router = express.Router();

// Practice session storage (in-memory for now, could be moved to Redis)
const practiceSessions = new Map<string, any>();

// Get practice questions
router.post('/questions', [
  body('type')
    .isIn(['behavioral', 'technical', 'coding', 'system-design'])
    .withMessage('Type must be one of: behavioral, technical, coding, system-design'),
  body('difficulty')
    .isIn(['easy', 'medium', 'hard'])
    .withMessage('Difficulty must be one of: easy, medium, hard'),
  body('count')
    .isInt({ min: 1, max: 10 })
    .withMessage('Count must be between 1 and 10'),
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

  const { type, difficulty, count, role } = req.body;

  try {
    logger.info(`Generating ${count} practice questions: ${type} - ${difficulty}`);

    // Generate questions using Gemini AI
    const questions = await geminiService.generateInterviewQuestions({
      role: role || 'Software Engineer',
      experienceLevel: 'mid',
      interviewType: type,
      difficulty,
      count,
    });

    // Create practice session
    const sessionId = `practice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    practiceSessions.set(sessionId, {
      userId: req.user!.userId,
      type,
      difficulty,
      questions,
      responses: [],
      startTime: new Date(),
      status: 'active',
    });

    logger.info(`Practice session created: ${sessionId}`);

    res.json({
      success: true,
      data: {
        sessionId,
        questions,
      },
      message: 'Practice questions generated',
    });
  } catch (error: any) {
    logger.error('Generate practice questions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate practice questions',
      message: error.message,
    });
  }
}));

// Submit practice response
router.post('/response', [
  body('sessionId').notEmpty(),
  body('questionId').notEmpty(),
  body('answer').notEmpty().trim(),
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

  const { sessionId, questionId, answer } = req.body;

  try {
    const session = practiceSessions.get(sessionId);

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Practice session not found',
      });
      return;
    }

    if (session.userId !== req.user!.userId) {
      res.status(403).json({
        success: false,
        error: 'Unauthorized access to practice session',
      });
      return;
    }

    // Find the question
    const question = session.questions.find((q: any) => q.id === questionId);
    if (!question) {
      res.status(404).json({
        success: false,
        error: 'Question not found',
      });
      return;
    }

    // Analyze response with Gemini AI
    logger.info(`Analyzing practice response for question ${questionId}`);
    const analysis = await geminiService.analyzeResponse({
      question: question.text,
      answer,
      role: 'Software Engineer',
    });

    // Store response
    session.responses.push({
      questionId,
      answer,
      analysis,
      timestamp: new Date(),
    });

    // Update session
    practiceSessions.set(sessionId, session);

    logger.info(`Practice response submitted for session ${sessionId}`);

    res.json({
      success: true,
      data: {
        analysis,
        questionsRemaining: session.questions.length - session.responses.length,
      },
      message: 'Response analyzed successfully',
    });
  } catch (error: any) {
    logger.error('Submit practice response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit practice response',
      message: error.message,
    });
  }
}));

// Get practice session
router.get('/session/:sessionId', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.params;

  try {
    const session = practiceSessions.get(sessionId);

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Practice session not found',
      });
      return;
    }

    if (session.userId !== req.user!.userId) {
      res.status(403).json({
        success: false,
        error: 'Unauthorized access to practice session',
      });
      return;
    }

    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    logger.error('Get practice session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get practice session',
      message: error.message,
    });
  }
}));

// End practice session
router.post('/session/:sessionId/end', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.params;

  try {
    const session = practiceSessions.get(sessionId);

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Practice session not found',
      });
      return;
    }

    if (session.userId !== req.user!.userId) {
      res.status(403).json({
        success: false,
        error: 'Unauthorized access to practice session',
      });
      return;
    }

    // Update session status
    session.status = 'completed';
    session.endTime = new Date();
    practiceSessions.set(sessionId, session);

    // Calculate summary
    const totalQuestions = session.questions.length;
    const answeredQuestions = session.responses.length;
    const avgScore = session.responses.reduce((sum: number, r: any) => {
      const scores = Object.values(r.analysis?.scores || {}) as number[];
      const questionScore = scores.reduce((s, score) => s + score, 0) / scores.length;
      return sum + questionScore;
    }, 0) / answeredQuestions;

    const summary = {
      totalQuestions,
      answeredQuestions,
      averageScore: Math.round(avgScore),
      duration: Math.round((session.endTime - session.startTime) / 1000 / 60),
      type: session.type,
      difficulty: session.difficulty,
    };

    logger.info(`Practice session ended: ${sessionId}`);

    res.json({
      success: true,
      data: {
        session,
        summary,
      },
      message: 'Practice session ended',
    });
  } catch (error: any) {
    logger.error('End practice session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to end practice session',
      message: error.message,
    });
  }
}));

// Get practice history
router.get('/history', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const userSessions = Array.from(practiceSessions.values())
      .filter((session: any) => session.userId === req.user!.userId)
      .sort((a: any, b: any) => b.startTime - a.startTime)
      .slice(0, 20); // Last 20 sessions

    res.json({
      success: true,
      data: userSessions,
    });
  } catch (error: any) {
    logger.error('Get practice history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get practice history',
      message: error.message,
    });
  }
}));

export default router;
