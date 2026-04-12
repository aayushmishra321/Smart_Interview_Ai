import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User';
import { extractTokenFromRequest, verifyToken, TokenPayload } from '../utils/auth';
import logger from '../utils/logger';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email?: string;
        role?: string;
      };
    }
  }
}

// Main authentication middleware
export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractTokenFromRequest(req);
    
    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Access token is required',
      });
      return;
    }

    let decoded: TokenPayload;
    let isAuth0Token = false;

    // Try to verify as regular JWT first
    try {
      decoded = verifyToken(token, process.env.JWT_ACCESS_SECRET!);
    } catch (jwtError) {
      // If regular JWT fails, try Auth0 token verification
      try {
        // For Auth0 tokens, we need to verify differently
        // This is a simplified version - in production, you'd verify with Auth0's public key
        const auth0Decoded = jwt.decode(token) as any;
        
        if (auth0Decoded && auth0Decoded.sub) {
          // Auth0 token format
          decoded = {
            userId: auth0Decoded.sub,
            email: auth0Decoded.email,
          };
          isAuth0Token = true;
        } else {
          throw new Error('Invalid token format');
        }
      } catch (auth0Error) {
        res.status(401).json({
          success: false,
          error: 'Invalid or expired token',
        });
        return;
      }
    }

    // Check if MongoDB is connected
    const isMongoConnected = mongoose.connection.readyState === 1;
    
    if (!isMongoConnected) {
      // If no database connection, create a mock user for development
      logger.warn('No database connection - using mock user for development');
      req.user = {
        userId: decoded.userId,
        email: decoded.email || 'dev@example.com',
        role: 'free',
      };
      next();
      return;
    }

    // For Auth0 tokens, we might need to find user by email instead of ID
    let user;
    if (isAuth0Token) {
      // Try to find user by Auth0 sub first, then by email
      user = await User.findOne({
        $or: [
          { _id: decoded.userId },
          { email: decoded.email }
        ]
      });
      
      // If user doesn't exist, create a basic profile for Auth0 users
      if (!user && decoded.email) {
        try {
          user = new User({
            email: decoded.email,
            password: 'auth0-managed', // Placeholder for Auth0 users
            profile: {
              firstName: decoded.email.split('@')[0] || 'User',
              lastName: '',
            },
            preferences: {
              role: '',
              experienceLevel: 'entry',
              industries: [],
              interviewTypes: [],
            },
            auth: {
              isVerified: true, // Auth0 users are pre-verified
              lastLogin: new Date(),
            },
          });
          await user.save();
          logger.info(`Auto-created user profile for Auth0 user: ${decoded.email}`);
        } catch (createError) {
          logger.error('Failed to create Auth0 user profile:', createError);
          res.status(500).json({
            success: false,
            error: 'Failed to create user profile',
          });
          return;
        }
      }
    } else {
      // Regular JWT token - find by ID
      user = await User.findById(decoded.userId);
    }

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'User not found',
      });
      return;
    }

    // Check if account is locked (skip for Auth0 users)
    if (!isAuth0Token && user.isAccountLocked()) {
      res.status(423).json({
        success: false,
        error: 'Account is locked',
      });
      return;
    }

    // Attach user info to request
    req.user = {
      userId: user._id.toString(),
      email: user.email,
      role: user.subscription.plan,
    };

    next();
  } catch (error: any) {
    logger.error('Authentication error:', error);
    res.status(401).json({
      success: false,
      error: 'Authentication failed',
    });
  }
}

// Optional authentication (doesn't fail if no token)
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractTokenFromRequest(req);
    
    if (token) {
      try {
        const decoded = verifyToken(token, process.env.JWT_ACCESS_SECRET!);
        const user = await User.findById(decoded.userId);
        
        if (user && !user.isAccountLocked()) {
          req.user = {
            userId: user._id.toString(),
            email: user.email,
            role: user.subscription.plan,
          };
        }
      } catch (error) {
        // Ignore token errors in optional auth
        logger.debug('Optional auth token error:', error);
      }
    }
    
    next();
  } catch (error: any) {
    logger.error('Optional auth error:', error);
    next(); // Continue even if there's an error
  }
}

// Role-based authorization middleware
export function requireRole(roles: string | string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const userRole = req.user.role || 'free';
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
}

// Admin only middleware
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
    return;
  }

  try {
    // Get user from database to check admin role
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
      });
      return;
    }

    // Check if user has admin role
    if (user.auth.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: 'Admin access required',
        message: 'You do not have permission to access this resource',
      });
      return;
    }

    next();
  } catch (error: any) {
    logger.error('Admin authorization error:', error);
    res.status(500).json({
      success: false,
      error: 'Authorization failed',
      message: error.message,
    });
  }
}

// Rate limiting by user
export function rateLimitByUser(maxRequests: number = 100, windowMs: number = 15 * 60 * 1000) {
  const userRequests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.user?.userId || req.ip;
    const now = Date.now();
    
    if (!userId) {
      next();
      return;
    }
    
    const userLimit = userRequests.get(userId);
    
    if (!userLimit || now > userLimit.resetTime) {
      userRequests.set(userId, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }
    
    if (userLimit.count >= maxRequests) {
      res.status(429).json({
        success: false,
        error: 'Too many requests, please try again later',
      });
      return;
    }
    
    userLimit.count++;
    next();
  };
}