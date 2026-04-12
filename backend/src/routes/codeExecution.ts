import express from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticateToken } from '../middleware/auth';
import codeExecutionService from '../services/codeExecution';
import Interview from '../models/Interview';
import logger from '../utils/logger';

const router = express.Router();

// Execute code
router.post(
  '/execute',
  authenticateToken,
  [
    body('language').isString().notEmpty(),
    body('code').isString().notEmpty(),
    body('stdin').optional().isString(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { language, code, stdin } = req.body;

    try {
      const result = await codeExecutionService.execute({
        language,
        code,
        stdin,
      });

      logger.info(`Code executed for user ${req.user!.userId}: ${language}`);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      logger.error('Code execution error:', error);
      res.status(500).json({
        success: false,
        error: 'Code execution failed',
        message: error.message,
      });
    }
  })
);

// Execute code with test cases
router.post(
  '/execute-tests',
  authenticateToken,
  [
    body('language').isString().notEmpty(),
    body('code').isString().notEmpty(),
    body('testCases').isArray(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { language, code, testCases } = req.body;

    try {
      const result = await codeExecutionService.executeWithTestCases({
        language,
        code,
        testCases,
      });

      logger.info(`Code executed with ${testCases.length} test cases for user ${req.user!.userId}`);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      logger.error('Code execution with tests error:', error);
      res.status(500).json({
        success: false,
        error: 'Code execution failed',
        message: error.message,
      });
    }
  })
);

// Submit code for interview
router.post(
  '/interview/:interviewId/submit',
  authenticateToken,
  [
    body('questionId').isString().notEmpty(),
    body('language').isString().notEmpty(),
    body('code').isString().notEmpty(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { interviewId } = req.params;
    const { questionId, language, code } = req.body;

    try {
      // Get interview
      const interview = await Interview.findOne({
        _id: interviewId,
        userId: req.user!.userId,
      });

      if (!interview) {
        return res.status(404).json({
          success: false,
          error: 'Interview not found',
        });
      }

      // Find question
      const question = interview.questions.find((q: any) => q.id === questionId);
      if (!question) {
        return res.status(404).json({
          success: false,
          error: 'Question not found',
        });
      }

      // Execute code with test cases (if available)
      const testCases = (question as any).testCases || [];
      const result = await codeExecutionService.executeWithTestCases({
        language,
        code,
        testCases,
      });

      // Save submission
      const response = {
        questionId,
        answer: code,
        codeSubmission: {
          language,
          code,
          testResults: result.testResults || [],
        },
        duration: 0, // Will be updated by frontend
        timestamp: new Date(),
      };

      interview.responses.push(response as any);
      await interview.save();

      logger.info(`Code submitted for interview ${interviewId}, question ${questionId}`);

      res.json({
        success: true,
        data: {
          result,
          testsPassed: result.testResults?.filter((t) => t.passed).length || 0,
          totalTests: result.testResults?.length || 0,
        },
      });
    } catch (error: any) {
      logger.error('Code submission error:', error);
      res.status(500).json({
        success: false,
        error: 'Code submission failed',
        message: error.message,
      });
    }
  })
);

// Get supported languages
router.get(
  '/languages',
  asyncHandler(async (req, res) => {
    const languages = await codeExecutionService.getSupportedLanguages();

    res.json({
      success: true,
      data: languages,
    });
  })
);

// Health check
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const isHealthy = await codeExecutionService.testConnection();

    res.json({
      success: isHealthy,
      service: 'code-execution',
      status: isHealthy ? 'healthy' : 'unhealthy',
    });
  })
);

export default router;
