import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import webrtcService from './webrtc';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  interviewId?: string;
}

export function setupSocketHandlers(io: Server) {
  // Authentication middleware
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication error'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as any;
      socket.userId = decoded.userId;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  // Setup WebRTC handlers
  webrtcService.setupWebRTCHandlers(io);

  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`Socket connected: ${socket.id}, User: ${socket.userId}`);

    // Join interview room
    socket.on('join-interview', (interviewId: string) => {
      socket.interviewId = interviewId;
      socket.join(`interview-${interviewId}`);
      logger.info(`User ${socket.userId} joined interview ${interviewId}`);
      
      // Notify others in the room
      socket.to(`interview-${interviewId}`).emit('user-joined', {
        userId: socket.userId,
        timestamp: new Date(),
      });
    });

    // Leave interview room
    socket.on('leave-interview', (interviewId: string) => {
      socket.leave(`interview-${interviewId}`);
      logger.info(`User ${socket.userId} left interview ${interviewId}`);
      
      socket.to(`interview-${interviewId}`).emit('user-left', {
        userId: socket.userId,
        timestamp: new Date(),
      });
    });

    // Real-time interview updates
    socket.on('interview-update', (data: any) => {
      const { interviewId, type, payload } = data;
      
      // Broadcast to all users in the interview room
      io.to(`interview-${interviewId}`).emit('interview-update', {
        type,
        payload,
        timestamp: new Date(),
      });
      
      logger.info(`Interview update: ${type} for interview ${interviewId}`);
    });

    // Real-time analysis updates
    socket.on('analysis-update', (data: any) => {
      const { interviewId, analysisType, metrics } = data;
      
      // Send analysis update to the specific user
      socket.emit('analysis-result', {
        analysisType,
        metrics,
        timestamp: new Date(),
      });
      
      logger.info(`Analysis update: ${analysisType} for user ${socket.userId}`);
    });

    // Video frame analysis
    socket.on('video-frame', async (data: any) => {
      const { interviewId, frameData, timestamp } = data;
      
      try {
        // Process video frame (call Python AI server)
        // This is a placeholder - actual implementation would call the AI server
        socket.emit('video-analysis', {
          emotions: {
            happy: 0.7,
            confident: 0.8,
            nervous: 0.2,
          },
          eyeContact: 0.85,
          timestamp,
        });
      } catch (error) {
        logger.error('Video frame analysis error:', error);
      }
    });

    // Audio chunk analysis
    socket.on('audio-chunk', async (data: any) => {
      const { interviewId, audioData, transcript } = data;
      
      try {
        // Process audio chunk (call Python AI server)
        socket.emit('audio-analysis', {
          speechRate: 150,
          fillerWords: ['um', 'uh'],
          clarityScore: 0.85,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error('Audio chunk analysis error:', error);
      }
    });

    // Code execution updates
    socket.on('code-execution', (data: any) => {
      const { interviewId, language, status } = data;
      
      socket.to(`interview-${interviewId}`).emit('code-execution-update', {
        language,
        status,
        timestamp: new Date(),
      });
    });

    // Typing indicator
    socket.on('typing', (data: any) => {
      const { interviewId, isTyping } = data;
      
      socket.to(`interview-${interviewId}`).emit('user-typing', {
        userId: socket.userId,
        isTyping,
      });
    });

    // Question navigation
    socket.on('question-change', (data: any) => {
      const { interviewId, questionIndex } = data;
      
      socket.to(`interview-${interviewId}`).emit('question-changed', {
        userId: socket.userId,
        questionIndex,
        timestamp: new Date(),
      });
    });

    // Interview status updates
    socket.on('interview-status', (data: any) => {
      const { interviewId, status } = data;
      
      io.to(`interview-${interviewId}`).emit('status-update', {
        status,
        timestamp: new Date(),
      });
      
      logger.info(`Interview ${interviewId} status: ${status}`);
    });

    // Error handling
    socket.on('error', (error) => {
      logger.error(`Socket error for user ${socket.userId}:`, error);
    });

    // Disconnect
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}, User: ${socket.userId}`);
      
      if (socket.interviewId) {
        socket.to(`interview-${socket.interviewId}`).emit('user-left', {
          userId: socket.userId,
          timestamp: new Date(),
        });
      }
    });
  });

  logger.info('Socket.IO handlers initialized');
}
