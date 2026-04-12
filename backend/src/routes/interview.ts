import express from 'express';
import mongoose from 'mongoose';
import { body, validationResult } from 'express-validator';
import Interview from '../models/Interview';
import Resume from '../models/Resume';
import { asyncHandler } from '../middleware/errorHandler';
import geminiService from '../services/gemini';
import logger from '../utils/logger';

const router = express.Router();

// Create new interview
router.post('/create', [
  body('type')
  .isIn(['behavioral', 'technical', 'coding', 'system-design', 'skill-based'])
  .withMessage(
    'Interview type must be one of: behavioral, technical, coding, system-design, skill-based'
  ),
  body('settings.role')
    .notEmpty()
    .withMessage('Target role is required')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Role must be between 2 and 100 characters'),
  body('settings.difficulty')
    .isIn(['easy', 'medium', 'hard'])
    .withMessage('Difficulty must be one of: easy, medium, hard'),
  body('settings.duration')
    .isInt({ min: 15, max: 120 })
    .withMessage('Duration must be between 15 and 120 minutes'),
], asyncHandler(async (req, res) => {
  console.log('=== POST /api/interview/create ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('User:', req.user);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('Request headers:', {
    'content-type': req.headers['content-type'],
    'authorization': req.headers.authorization ? 'Bearer ***' : 'none',
  });
  
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.error('=== VALIDATION FAILED ===');
    console.error('Validation errors:', JSON.stringify(errors.array(), null, 2));
    
    // Format errors for better readability
    const formattedErrors = errors.array().map((err: any) => ({
      field: err.param || err.path || 'unknown',
      message: err.msg || err.message || 'Validation error',
      value: err.value,
      location: err.location || 'body',
    }));
    
    console.error('Formatted errors:', formattedErrors);
    
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      message: 'Please check your interview settings and try again',
      details: formattedErrors,
      hint: 'Check that type is one of: behavioral, technical, coding, system-design',
    });
  }

  if (!req.user || !req.user.userId) {
    console.error('No user ID in request');
    return res.status(401).json({
      success: false,
      error: 'User not authenticated',
      message: 'Please log in to create an interview',
    });
  }

  const { type, settings, resumeId } = req.body;
  
  console.log('Validated data:');
  console.log('  Type:', type);
  console.log('  Settings:', settings);
  console.log('  Resume ID:', resumeId || 'none');

  try {
    console.log(`Creating ${type} interview for user ${req.user.userId}`);
    
    // Get user's resume if resumeId provided
    let resumeData = null;
    if (resumeId) {
      console.log(`Looking for resume: ${resumeId}`);
      const resume = await Resume.findOne({
        _id: resumeId,
        userId: req.user.userId,
      });
      if (resume) {
        resumeData = resume;
        console.log('Resume found and will be used for question generation');
      } else {
        console.log('Resume not found with provided ID');
      }
    } else {
      // Get latest resume
      console.log('No resumeId provided, looking for latest resume');
      const latestResume = await Resume.findOne({
        userId: req.user.userId,
      }).sort({ uploadDate: -1 });
      
      if (latestResume) {
        resumeData = latestResume;
        console.log('Latest resume found and will be used');
      } else {
        console.log('No resume found for user');
      }
    }

    // Prepare question generation parameters
    // const questionParams: any = {
    //   role: settings.role,
    //   experienceLevel: 'mid', // TODO: Get from user profile
    //   interviewType: type,
    //   difficulty: settings.difficulty,
    //   count: Math.min(5, Math.floor(settings.duration / 5)), // Max 5 questions for faster generation
    // };

    

    const questionParams: any = {
      role: settings.role,
      experienceLevel: 'mid',
      interviewType: type,
      difficulty: settings.difficulty,
      count: Math.min(5, Math.floor(settings.duration / 5)),
      domain: settings.domain, // NEW
    };

    // Add resume context if available
    if (resumeData && resumeData.parsedData) {
      questionParams.resumeContext = {
        skills: resumeData.extractedSkills || [],
        experience: resumeData.parsedData.experience || [],
        projects: resumeData.parsedData.projects || [],
        summary: resumeData.parsedData.summary || '',
      };
      console.log('Resume context added to question generation');
    }

    logger.info(`Generating ${questionParams.count} questions for ${settings.role} with resume context: ${!!resumeData}`);
    console.log('Question generation params:', JSON.stringify(questionParams, null, 2));

    // Generate questions using Gemini AI with timeout
    console.log('Starting question generation with 30s timeout...');
    const questionGenerationPromise = geminiService.generateInterviewQuestions(questionParams);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Question generation timeout')), 30000)
    );
    
    let questions;
    try {
      questions = await Promise.race([questionGenerationPromise, timeoutPromise]) as any[];
      console.log(`Generated ${questions.length} questions successfully`);
    } catch (timeoutError: any) {
      console.warn('Question generation timed out, using fallback questions');
      logger.warn('Question generation timeout, using fallback');
      // Use fallback - will be handled by gemini service
      questions = await geminiService.generateInterviewQuestions(questionParams);
    }

    // Create interview in database
    const interview = new Interview({
      userId: req.user.userId,
      resumeId: resumeData?._id || null,
      type,
      status: 'scheduled',
      settings: {
        role: settings.role,
        difficulty: settings.difficulty,
        duration: settings.duration,
        includeVideo: settings.includeVideo !== false,
        includeAudio: settings.includeAudio !== false,
        includeCoding: settings.includeCoding || false,
      },
      questions: questions.map((q: any) => ({
  id:
    q.id ||
    `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,

  // ⭐ SAFE TEXT (fixes your error)
  text:
    q.text ||
    q.question ||
    q.title ||
    q.description ||
    `Explain ${settings.domain || settings.role}`,

  description: q.description || null,

  type:
    q.type ||
    (type === 'skill-based' ? 'technical' : type),

  difficulty: q.difficulty || settings.difficulty,

  expectedDuration: q.expectedDuration || 5,

  followUpQuestions: q.followUpQuestions || [],

  category: q.category || settings.domain || 'general',

  examples: q.examples || [],
  constraints: q.constraints || [],
  testCases: q.testCases || [],
})),
      responses: [],
      session: {
        startTime: null,
        endTime: null,
        actualDuration: null,
      },
    });

    await interview.save();

    logger.info(`Interview created: ${interview._id} for user ${req.user.userId} with ${questions.length} questions`);
    console.log(`=== Interview created successfully ===`);
    console.log(`Interview ID: ${interview._id}`);
    console.log(`Questions: ${questions.length}`);
    console.log(`Type: ${type}`);
    console.log(`Role: ${settings.role}`);

    // Return interview with both _id and id for compatibility
    const interviewData = interview.toObject();
    const responseData = {
      ...interviewData,
      id: interview._id.toString(), // Ensure id is always present
    };

    res.status(201).json({
      success: true,
      data: responseData,
      message: 'Interview created successfully',
    });
  } catch (error: any) {
    logger.error('Interview creation error:', error);
    console.error('=== INTERVIEW CREATION ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Interview creation failed',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}));

// Start interview session
router.post('/:id/start', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    if (interview.status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        error: 'Interview already started or completed',
      });
    }

    // Update interview status and start time
    interview.status = 'in-progress';
    interview.session.startTime = new Date();
    interview.session.metadata = {
      browserInfo: req.headers['user-agent'] || 'Unknown',
      deviceInfo: req.body.deviceInfo || 'Unknown',
      networkQuality: req.body.networkQuality || 'Unknown',
    };

    await interview.save();

    logger.info(`Interview started: ${id} by user ${req.user!.userId}`);

    const session = {
      id: interview._id,
      interviewId: interview._id,
      status: 'active',
      startTime: interview.session.startTime,
      isRecording: false,
      currentQuestionIndex: 0,
      totalQuestions: interview.questions.length,
    };

    res.json({
      success: true,
      data: session,
      message: 'Interview session started',
    });
  } catch (error: any) {
    logger.error('Interview start error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start interview',
      message: error.message,
    });
  }
}));

// End interview session
router.post('/:id/end', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    // Update interview status and end time
    interview.status = 'completed';
    interview.session.endTime = new Date();
    
    if (interview.session.startTime) {
      const duration = (interview.session.endTime.getTime() - interview.session.startTime.getTime()) / 1000 / 60;
      interview.session.actualDuration = Math.round(duration);
    }

    await interview.save();

    logger.info(`Interview ended: ${id} by user ${req.user!.userId}, duration: ${interview.session.actualDuration}min`);

    res.json({
      success: true,
      data: interview,
      message: 'Interview session ended',
    });
  } catch (error: any) {
    logger.error('Interview end error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to end interview',
      message: error.message,
    });
  }
}));

// Get next question
router.get('/:id/next-question', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    // Get next unanswered question
    const answeredQuestionIds = interview.responses.map((r: any) => r.questionId);
    const nextQuestion = interview.questions.find((q: any) => 
      !answeredQuestionIds.includes(q.id)
    );

    if (!nextQuestion) {
      return res.status(404).json({
        success: false,
        error: 'No more questions available',
        message: 'All questions have been answered',
      });
    }

    res.json({
      success: true,
      data: nextQuestion,
    });
  } catch (error: any) {
    logger.error('Get next question error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get next question',
      message: error.message,
    });
  }
}));

// Submit response
router.post('/:id/response', [
  body('questionId').notEmpty(),
  body('answer').notEmpty().trim(),
  body('duration').isNumeric(),
], asyncHandler(async (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
    });
  }

  const { id } = req.params;
  const { questionId, answer, duration, audioUrl, videoUrl, codeSubmission } = req.body;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    const question = interview.questions.find((q: any) => q.id === questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found',
      });
    }

    // ⭐ STEP 1 — SAVE RESPONSE FIRST (FAST)
    const responseData = {
      questionId,
      answer,
      audioUrl: audioUrl || null,
      videoUrl: videoUrl || null,
      codeSubmission: codeSubmission || null,
      duration,
      timestamp: new Date(),
    };

    await Interview.findByIdAndUpdate(id, {
      $push: { responses: responseData }
    });

    // ⭐ STEP 2 — RETURN RESPONSE IMMEDIATELY (NO WAIT)
    res.json({
      success: true,
      message: 'Response submitted instantly',
    });

    // ⭐ STEP 3 — RUN AI ANALYSIS IN BACKGROUND (NO BLOCKING)
    (async () => {
      try {
        logger.info(`Background AI analysis for question ${questionId}`);

        const analysis = await geminiService.analyzeResponse({
          question: question.text,
          answer,
          role: interview.settings.role,
        });

        if (!analysis) return;

        await Interview.findByIdAndUpdate(id, {
          $set: {
            "analysis.contentMetrics.relevanceScore":
              analysis?.scores?.relevance || 0,

            "analysis.contentMetrics.technicalAccuracy":
              analysis?.scores?.technicalAccuracy || 0,

            "analysis.contentMetrics.communicationClarity":
              analysis?.scores?.clarity || 0,

            "analysis.contentMetrics.structureScore":
              analysis?.scores?.structure || 0,

            "analysis.contentMetrics.keywordMatches":
              analysis?.keywordMatches || [],

            "analysis.overallScore":
              analysis?.overallScore || 0,
          }
        });

        logger.info("✅ Background AI analysis completed");

      } catch (err) {
        logger.error("Background AI analysis failed:", err);
      }
    })();

  } catch (error: any) {
    logger.error('Submit response error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to submit response',
      message: error.message,
    });
  }
}));

// Process video frame for real-time analysis
router.post('/:id/process-video', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { frameData, timestamp } = req.body;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    // Send to Python AI server for emotion detection
    const aiServerUrl = process.env.AI_SERVER_URL || 'http://localhost:8000';
    const response = await fetch(`${aiServerUrl}/api/analyze/emotion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_data: frameData, timestamp }),
    });

    if (!response.ok) {
      throw new Error('AI server emotion analysis failed');
    }

    const emotionData = await response.json() as any;

    // Store emotion data in interview
    if (!interview.analysis) {
      interview.analysis = {
        videoMetrics: { emotionAnalysis: [] },
      } as any;
    }

    if (!interview.analysis.videoMetrics) {
      interview.analysis.videoMetrics = { emotionAnalysis: [] } as any;
    }

    interview.analysis.videoMetrics.emotionAnalysis.push({
      timestamp,
      emotions: emotionData.emotions || {},
    } as any);

    await interview.save();

    res.json({
      success: true,
      data: { analysis: emotionData },
    });
  } catch (error: any) {
    logger.error('Video processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process video',
      message: error.message,
    });
  }
}));

// Process audio chunk for real-time analysis
router.post('/:id/process-audio', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    // TODO: Process audio with Python AI server
    // For now, return success
    res.json({
      success: true,
      data: { 
        transcript: '',
        analysis: {},
      },
    });
  } catch (error: any) {
    logger.error('Audio processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process audio',
      message: error.message,
    });
  }
}));

// Get interview history
router.get('/history', asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const status = req.query.status as string;

  try {
    const query: any = { userId: req.user!.userId };
    if (status) {
      query.status = status;
    }

    const interviews = await Interview.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .select('type status settings analysis createdAt updatedAt session');

    const total = await Interview.countDocuments(query);

    res.json({
      success: true,
      data: interviews,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    logger.error('Get interview history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get interview history',
      message: error.message,
    });
  }
}));

// Get specific interview
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    res.json({
      success: true,
      data: interview,
    });
  } catch (error: any) {
    logger.error('Get interview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get interview',
      message: error.message,
    });
  }
}));

// Get interview analysis
router.get('/:id/analysis', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    res.json({
      success: true,
      data: interview.analysis || {},
    });
  } catch (error: any) {
    logger.error('Get analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analysis',
      message: error.message,
    });
  }
}));

// Generate feedback
router.post('/:id/feedback', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    // Generate feedback using Gemini AI
    const feedback = await geminiService.generateFeedback({
      interviewData: {
        type: interview.type,
        role: interview.settings.role,
        duration: interview.session.actualDuration,
        questionsAnswered: interview.responses.length,
        totalQuestions: interview.questions.length,
      },
      analysisResults: interview.analysis || {},
      userProfile: {},
    });

    // Save feedback to interview
    interview.feedback = {
      overallRating: feedback.overallRating || 75,
      strengths: feedback.strengths || [],
      improvements: feedback.improvements || [],
      recommendations: feedback.recommendations || [],
      detailedFeedback: feedback.detailedFeedback || '',
      skillAssessment: [],
      nextSteps: feedback.nextSteps || [],
    } as any;

    await interview.save();

    logger.info(`Feedback generated for interview ${id}`);

    res.json({
      success: true,
      data: interview.feedback,
    });
  } catch (error: any) {
    logger.error('Generate feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate feedback',
      message: error.message,
    });
  }
}));

// Get feedback
router.get('/:id/feedback', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    // Check if feedback exists and has content
    if (!interview.feedback || !interview.feedback.overallRating) {
      return res.status(404).json({
        success: false,
        error: 'Feedback not generated yet',
      });
    }

    res.json({
      success: true,
      data: interview.feedback,
    });
  } catch (error: any) {
    logger.error('Get feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get feedback',
      message: error.message,
    });
  }
}));

// Generate PDF report
router.post('/:id/report', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const interview = await Interview.findOne({
      _id: id,
      userId: req.user!.userId,
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found',
      });
    }

    // Check if feedback exists
    if (!interview.feedback || !interview.feedback.overallRating) {
      return res.status(400).json({
        success: false,
        error: 'Feedback not generated yet',
        message: 'Please generate feedback before downloading the report',
      });
    }

    // For now, return a placeholder URL
    // TODO: Implement actual PDF generation using a library like puppeteer or pdfkit
    const reportUrl = `${process.env.FRONTEND_URL}/feedback/${id}`;

    logger.info(`Report generated for interview ${id}`);

    res.json({
      success: true,
      data: {
        reportUrl,
        message: 'Report generated successfully. You can print this page as PDF.',
      },
    });
  } catch (error: any) {
    logger.error('Generate report error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate report',
      message: error.message,
    });
  }
}));

// Real-time video analysis
router.post('/:interviewId/analyze/video', asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const { frameData, timestamp } = req.body;

  try {
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

    // Call Python AI server for video analysis
    const pythonServerUrl = process.env.PYTHON_API_URL || 'http://localhost:8000';
    const apiKey = process.env.PYTHON_AI_SERVER_API_KEY || 'smart-interview-ai-python-server-key-2024';

    const axios = require('axios');
    const analysisResponse = await axios.post(
      `${pythonServerUrl}/api/video/analyze-frame`,
      { frame_data: frameData, timestamp },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (analysisResponse.data && analysisResponse.data.success) {
      const videoAnalysis = analysisResponse.data.data;

      // Update interview analysis
      if (!interview.analysis) {
        interview.analysis = {
          videoMetrics: {
            eyeContactPercentage: 0,
            emotionAnalysis: [],
            postureScore: 0,
            gestureAnalysis: [],
            confidenceLevel: 0,
          },
          audioMetrics: {
            speechRate: 0,
            pauseAnalysis: [],
            fillerWords: [],
            toneAnalysis: [],
            clarityScore: 0,
          },
          contentMetrics: {
            relevanceScore: 0,
            technicalAccuracy: 0,
            communicationClarity: 0,
            structureScore: 0,
            keywordMatches: [],
          },
          overallScore: 0,
        };
      }

      // Add emotion data
      if (videoAnalysis.emotions) {
        interview.analysis.videoMetrics.emotionAnalysis.push({
          timestamp,
          emotions: videoAnalysis.emotions,
        });
      }

      // Update eye contact
      if (videoAnalysis.eyeContact !== undefined) {
        const currentCount = interview.analysis.videoMetrics.emotionAnalysis.length;
        const currentTotal = interview.analysis.videoMetrics.eyeContactPercentage * (currentCount - 1);
        interview.analysis.videoMetrics.eyeContactPercentage = 
          (currentTotal + videoAnalysis.eyeContact) / currentCount;
      }

      await interview.save();

      res.json({
        success: true,
        data: videoAnalysis,
        message: 'Video frame analyzed',
      });
    } else {
      throw new Error('Video analysis failed');
    }
  } catch (error: any) {
    logger.error('Real-time video analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Video analysis failed',
      message: error.message,
    });
  }
}));

// Real-time audio analysis
router.post('/:interviewId/analyze/audio', asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const { audioData, transcript, timestamp } = req.body;

  try {
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

    // Call Python AI server for audio analysis
    const pythonServerUrl = process.env.PYTHON_API_URL || 'http://localhost:8000';
    const apiKey = process.env.PYTHON_AI_SERVER_API_KEY || 'smart-interview-ai-python-server-key-2024';

    const axios = require('axios');
    const analysisResponse = await axios.post(
      `${pythonServerUrl}/api/audio/analyze`,
      { 
        audio_data: audioData,
        transcript,
        timestamp,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (analysisResponse.data && analysisResponse.data.success) {
      const audioAnalysis = analysisResponse.data.data;

      // Update interview analysis
      if (!interview.analysis) {
        interview.analysis = {
          videoMetrics: {
            eyeContactPercentage: 0,
            emotionAnalysis: [],
            postureScore: 0,
            gestureAnalysis: [],
            confidenceLevel: 0,
          },
          audioMetrics: {
            speechRate: 0,
            pauseAnalysis: [],
            fillerWords: [],
            toneAnalysis: [],
            clarityScore: 0,
          },
          contentMetrics: {
            relevanceScore: 0,
            technicalAccuracy: 0,
            communicationClarity: 0,
            structureScore: 0,
            keywordMatches: [],
          },
          overallScore: 0,
        };
      }

      // Update speech rate
      if (audioAnalysis.speechRate) {
        interview.analysis.audioMetrics.speechRate = audioAnalysis.speechRate;
      }

      // Add filler words
      if (audioAnalysis.fillerWords) {
        audioAnalysis.fillerWords.forEach((fw: any) => {
          const existing = interview.analysis!.audioMetrics.fillerWords.find(
            (f: any) => f.word === fw.word
          );
          if (existing) {
            existing.count += fw.count;
            existing.timestamps.push(...fw.timestamps);
          } else {
            interview.analysis!.audioMetrics.fillerWords.push(fw);
          }
        });
      }

      // Update clarity score
      if (audioAnalysis.clarityScore !== undefined) {
        interview.analysis.audioMetrics.clarityScore = audioAnalysis.clarityScore;
      }

      await interview.save();

      res.json({
        success: true,
        data: audioAnalysis,
        message: 'Audio analyzed',
      });
    } else {
      throw new Error('Audio analysis failed');
    }
  } catch (error: any) {
    logger.error('Real-time audio analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Audio analysis failed',
      message: error.message,
    });
  }
}));

// Get real-time analysis summary
router.get('/:interviewId/analyze/summary', asyncHandler(async (req, res) => {
  const { interviewId } = req.params;

  try {
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

    const analysis = interview.analysis || {
      videoMetrics: {
        eyeContactPercentage: 0,
        emotionAnalysis: [],
        postureScore: 0,
        gestureAnalysis: [],
        confidenceLevel: 0,
      },
      audioMetrics: {
        speechRate: 0,
        pauseAnalysis: [],
        fillerWords: [],
        toneAnalysis: [],
        clarityScore: 0,
      },
      contentMetrics: {
        relevanceScore: 0,
        technicalAccuracy: 0,
        communicationClarity: 0,
        structureScore: 0,
        keywordMatches: [],
      },
      overallScore: 0,
    };

    // Calculate live metrics
    const liveMetrics = {
      eyeContact: Math.round(analysis.videoMetrics.eyeContactPercentage),
      speechRate: analysis.audioMetrics.speechRate,
      fillerWordCount: analysis.audioMetrics.fillerWords.reduce((sum: number, fw: any) => sum + fw.count, 0),
      clarityScore: Math.round(analysis.audioMetrics.clarityScore),
      emotionSummary: calculateEmotionSummary(analysis.videoMetrics.emotionAnalysis),
    };

    res.json({
      success: true,
      data: liveMetrics,
    });
  } catch (error: any) {
    logger.error('Get analysis summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analysis summary',
      message: error.message,
    });
  }
}));

// Helper function to calculate emotion summary
function calculateEmotionSummary(emotionAnalysis: any[]): any {
  if (!emotionAnalysis || emotionAnalysis.length === 0) {
    return {
      dominant: 'neutral',
      confidence: 0,
      distribution: {},
    };
  }

  const emotionCounts: any = {};
  let totalFrames = emotionAnalysis.length;

  emotionAnalysis.forEach((frame: any) => {
    const emotions = frame.emotions || {};
    Object.keys(emotions).forEach((emotion) => {
      emotionCounts[emotion] = (emotionCounts[emotion] || 0) + emotions[emotion];
    });
  });

  // Find dominant emotion
  let dominantEmotion = 'neutral';
  let maxScore = 0;
  Object.keys(emotionCounts).forEach((emotion) => {
    const avgScore = emotionCounts[emotion] / totalFrames;
    if (avgScore > maxScore) {
      maxScore = avgScore;
      dominantEmotion = emotion;
    }
  });

  // Calculate distribution
  const distribution: any = {};
  Object.keys(emotionCounts).forEach((emotion) => {
    distribution[emotion] = Math.round((emotionCounts[emotion] / totalFrames) * 100);
  });

  return {
    dominant: dominantEmotion,
    confidence: Math.round(maxScore * 100),
    distribution,
  };
}

export default router;