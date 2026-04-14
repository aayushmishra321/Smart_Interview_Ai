import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';

class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.model = this.genAI.getGenerativeModel({ model: modelName });
    console.log('✅ Gemini service initialized with model:', modelName);
  }

  // ── Question generation ───────────────────────────────────────────────────
  async generateInterviewQuestions(params: {
    role: string;
    experienceLevel: string;
    interviewType: string;
    resumeContext?: any;
    domain?: string;
    difficulty: string;
    count: number;
  }): Promise<any[]> {
    console.log('=== GENERATING INTERVIEW QUESTIONS ===');
    try {
      const prompt = this.buildQuestionGenerationPrompt(params);
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      let questions;
      try {
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        questions = JSON.parse(clean);
      } catch {
        return this.generateFallbackQuestions(params);
      }
      if (!Array.isArray(questions)) {
        questions = questions.questions && Array.isArray(questions.questions)
          ? questions.questions
          : this.generateFallbackQuestions(params);
      }
      logger.info(`Generated ${questions.length} questions for ${params.role}`);
      return questions;
    } catch (error: any) {
      logger.error('Error generating interview questions:', error);
      return this.generateFallbackQuestions(params);
    }
  }

  // ── Minimal fallback (only when Gemini is down) ───────────────────────────
  private generateFallbackQuestions(params: {
    role: string; interviewType: string; difficulty: string; count: number;
  }): any[] {
    logger.warn(`Gemini unavailable — minimal fallback for ${params.role} (${params.interviewType})`);
    if (params.interviewType === 'coding') {
      return [{
        id: `fallback_coding_${Date.now()}`,
        text: 'Two Sum',
        description: 'Given an array of integers nums and an integer target, return indices of the two numbers that add up to target.',
        type: 'coding', difficulty: params.difficulty, expectedDuration: 15, category: 'arrays',
        examples: [{ input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'nums[0] + nums[1] = 9' }],
        constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9'],
        testCases: [
          { input: '[2,7,11,15]\n9', expectedOutput: '[0,1]' },
          { input: '[3,2,4]\n6', expectedOutput: '[1,2]' },
        ],
        followUpQuestions: ['Can you solve it in O(n) time?'],
      }].slice(0, params.count);
    }
    return Array.from({ length: Math.min(params.count, 3) }, (_, i) => ({
      id: `fallback_${Date.now()}_${i}`,
      text: i === 0 ? `Tell me about your experience as a ${params.role}.`
        : i === 1 ? 'Describe a challenging project you worked on.'
        : 'Where do you see yourself in 3-5 years?',
      type: 'behavioral', difficulty: params.difficulty, expectedDuration: 5,
      category: 'general', followUpQuestions: [],
    }));
  }

  // ── Response analysis ─────────────────────────────────────────────────────
  async analyzeResponse(params: {
    question: string; answer: string; role: string;
    expectedKeywords?: string[]; context?: any;
  }): Promise<any> {
    try {
      const prompt = this.buildResponseAnalysisPrompt(params);
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      try {
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(clean);
      } catch {
        return this.generateFallbackAnalysis(params);
      }
    } catch (error: any) {
      logger.error('Error analyzing response:', error);
      return this.generateFallbackAnalysis(params);
    }
  }

  private generateFallbackAnalysis(params: { question: string; answer: string; role: string }): any {
    const wordCount = params.answer.split(/\s+/).length;
    const hasExamples = /example|instance|case|situation|time when/i.test(params.answer);
    const hasTech = /\b(code|system|design|implement|develop|build|test|deploy)\b/i.test(params.answer);
    const lengthScore = Math.min(100, (params.answer.length / 500) * 100);
    const wScore = Math.min(100, (wordCount / 100) * 100);
    const overall = Math.round((lengthScore + wScore + (hasExamples ? 85 : 60) + (hasTech ? 85 : 70)) / 4);
    return {
      scores: { relevance: Math.min(100, overall + 5), technicalAccuracy: hasTech ? 85 : 70,
        clarity: Math.min(100, wScore), structure: Math.min(100, lengthScore),
        depth: hasExamples ? 85 : 60, examples: hasExamples ? 85 : 60 },
      overallScore: overall,
      strengths: [hasExamples ? 'Provided concrete examples' : 'Clear communication',
        hasTech ? 'Demonstrated technical knowledge' : 'Good articulation'],
      improvements: [!hasExamples ? 'Include more specific examples' : 'Add more context',
        !hasTech ? 'Include more technical details' : 'Continue demonstrating expertise'],
      missingElements: [], keywordMatches: [],
      feedback: `Response shows ${overall >= 75 ? 'strong' : 'developing'} understanding.`,
    };
  }

  // ── Feedback generation ───────────────────────────────────────────────────
  async generateFeedback(params: {
    interviewData: any; analysisResults: any; userProfile: any;
  }): Promise<any> {
    try {
      const prompt = this.buildFeedbackPrompt(params);
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      try {
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(clean);
      } catch {
        return this.generateFallbackFeedback(params);
      }
    } catch (error: any) {
      logger.error('Error generating feedback:', error);
      return this.generateFallbackFeedback(params);
    }
  }

  private generateFallbackFeedback(params: { interviewData: any; analysisResults: any; userProfile: any }): any {
    const rate = (params.interviewData.questionsAnswered / params.interviewData.totalQuestions) * 100;
    const score = params.analysisResults?.overallScore || 75;
    return {
      overallRating: score,
      strengths: ['Completed the interview with good engagement', 'Demonstrated clear communication skills'],
      improvements: ['Practice providing more specific examples', 'Work on structuring responses using STAR method'],
      recommendations: ['Review common interview questions', 'Practice mock interviews to build confidence'],
      skillAssessment: [], nextSteps: ['Take more practice interviews', 'Focus on identified improvement areas'],
      detailedFeedback: `Completed ${rate.toFixed(0)}% of questions. Performance shows ${score >= 80 ? 'strong' : score >= 60 ? 'good' : 'developing'} interview skills.`,
    };
  }

  // ── Follow-up questions ───────────────────────────────────────────────────
  async generateFollowUpQuestions(params: {
    originalQuestion: string; userAnswer: string; role: string; context?: any;
  }): Promise<string[]> {
    try {
      const prompt = this.buildFollowUpPrompt(params);
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean);
      return parsed.questions || [];
    } catch (error) {
      logger.error('Error generating follow-up questions:', error);
      return [];
    }
  }

  // ── Resume analysis ───────────────────────────────────────────────────────
  async analyzeResume(params: { resumeText: string; targetRole?: string }): Promise<any> {
    try {
      const prompt = this.buildResumeAnalysisPrompt(params);
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(clean);
    } catch (error) {
      logger.error('Error analyzing resume:', error);
      throw new Error('Failed to analyze resume');
    }
  }

  // ── Recommendations ───────────────────────────────────────────────────────
  async generateRecommendations(params: {
    userProfile: any; interviewHistory: any[]; currentPerformance: any;
  }): Promise<any> {
    try {
      const prompt = this.buildRecommendationsPrompt(params);
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(clean);
    } catch (error) {
      logger.error('Error generating recommendations:', error);
      throw new Error('Failed to generate recommendations');
    }
  }

  // ── Transcript analysis ───────────────────────────────────────────────────
  async analyzeInterviewTranscript(params: { transcript: string; role: string }): Promise<any> {
    try {
      const prompt = `You are an AI interview analysis expert.\nAnalyze this interview transcript for role: ${params.role}\n\nTRANSCRIPT:\n${params.transcript}\n\nReturn ONLY valid JSON:\n{"emotionAnalysis":[{"name":"Confident","value":0}],"fillerWords":[{"word":"um","count":0}],"speakingConfidence":0,"answerQuality":0,"timeline":[]}`;
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(clean);
    } catch (error) {
      logger.error('Transcript analysis failed:', error);
      return null;
    }
  }

  // ── Prompts ───────────────────────────────────────────────────────────────
  private buildQuestionGenerationPrompt(params: any): string {
    const resumeSkills = params.resumeContext?.skills?.length > 0 ? params.resumeContext.skills.join(', ') : '';
    const resumeProjects = params.resumeContext?.projects?.length > 0
      ? params.resumeContext.projects.map((p: any) => `${p.name || 'Project'}: ${p.description || ''} Technologies: ${(p.technologies || []).join(', ')}`).join('\n')
      : '';
    const domainInstruction = params.domain ? `CRITICAL: Generate ONLY questions related to ${params.domain}.` : '';
    const resumeInstruction = resumeSkills || resumeProjects ? `\nCandidate Resume Context:\nSkills: ${resumeSkills}\nProjects:\n${resumeProjects}\nGenerate questions based on these skills and projects.\n` : '';

    if (params.interviewType === 'coding') {
      return `You are an expert coding interviewer. Generate ${params.count} algorithmic coding problems.\nRole: ${params.role}\nDifficulty: ${params.difficulty}\n\nSTRICT RULES:\n- Real LeetCode-style problems only\n- Every problem MUST include testCases, examples, and constraints\n- testCases must have at least 2 entries\n\nReturn ONLY a valid JSON array (no markdown):\n[\n  {\n    "id": "q1",\n    "text": "Problem title",\n    "type": "coding",\n    "difficulty": "${params.difficulty}",\n    "expectedDuration": 15,\n    "category": "Arrays",\n    "description": "Full problem statement",\n    "examples": [{"input": "...", "output": "...", "explanation": "..."}],\n    "constraints": ["constraint1"],\n    "testCases": [{"input": "...", "expectedOutput": "..."}, {"input": "...", "expectedOutput": "..."}],\n    "followUpQuestions": ["..."]\n  }\n]`;
    }

    if (params.interviewType === 'technical') {
      return `You are a senior FAANG technical interviewer.\nGenerate ${params.count} HIGH QUALITY technical interview questions.\nRole: ${params.role}\nExperience Level: ${params.experienceLevel}\nDifficulty: ${params.difficulty}\n${domainInstruction}\n${resumeInstruction}\nSTRICT RULES: ONLY technical questions, NO behavioral questions.\nReturn JSON array:\n[{"id":"q1","text":"question","type":"technical","difficulty":"${params.difficulty}","expectedDuration":5,"category":"topic","followUpQuestions":[]}]`;
    }

    if (params.interviewType === 'skill-based') {
      return `You are a senior technical interviewer.\nGenerate ${params.count} DEEP SKILL-BASED questions.\nRole: ${params.role}\nDomain: ${params.domain || 'candidate skills'}\nDifficulty: ${params.difficulty}\n${domainInstruction}\nSTRICT RULES: ONLY technical questions, NO behavioral questions.\nReturn JSON array:\n[{"id":"q1","text":"question","type":"skill-based","difficulty":"${params.difficulty}","expectedDuration":5,"category":"${params.domain || 'technical'}","followUpQuestions":[]}]`;
    }

    if (params.interviewType === 'system-design') {
      return `You are a senior system design interviewer.\nGenerate ${params.count} system design problems.\nRole: ${params.role}\nDifficulty: ${params.difficulty}\nFocus on scalability, architecture, database design, caching, distributed systems.\nReturn JSON array only:\n[{"id":"q1","text":"question","type":"system-design","difficulty":"${params.difficulty}","expectedDuration":20,"category":"system-design","followUpQuestions":[]}]`;
    }

    return `Generate ${params.count} behavioral interview questions for ${params.role}.\nDifficulty: ${params.difficulty}\n${resumeInstruction}\nReturn JSON array:\n[{"id":"q1","text":"question","type":"behavioral","difficulty":"${params.difficulty}","expectedDuration":5,"category":"behavioral","followUpQuestions":[]}]`;
  }

  private buildResponseAnalysisPrompt(params: any): string {
    return `You are a senior FAANG technical interviewer.\nEvaluate this interview response.\n\nQUESTION: "${params.question}"\nANSWER: "${params.answer}"\nROLE: ${params.role}\n${params.expectedKeywords ? `Expected Keywords: ${params.expectedKeywords.join(', ')}` : ''}\n\nScore each dimension 0-100. Return ONLY valid JSON:\n{"scores":{"relevance":0,"technicalAccuracy":0,"clarity":0,"structure":0,"depth":0,"examples":0},"overallScore":0,"strengths":[],"improvements":[],"missingElements":[],"keywordMatches":[],"feedback":""}`;
  }

  private buildFeedbackPrompt(params: any): string {
    return `You are a senior FAANG interview coach.\nGenerate professional feedback.\n\nINTERVIEW DATA: ${JSON.stringify(params.interviewData)}\nANALYSIS: ${JSON.stringify(params.analysisResults)}\nPROFILE: ${JSON.stringify(params.userProfile)}\n\nReturn ONLY valid JSON:\n{"overallRating":0,"strengths":[],"improvements":[],"recommendations":[],"skillAssessment":[{"skill":"","currentLevel":0,"targetLevel":0,"feedback":""}],"nextSteps":[],"detailedFeedback":""}`;
  }

  private buildFollowUpPrompt(params: any): string {
    return `You are a senior technical interviewer.\nGenerate 2-3 follow-up questions.\n\nORIGINAL QUESTION: "${params.originalQuestion}"\nCANDIDATE ANSWER: "${params.userAnswer}"\nROLE: ${params.role}\n\nReturn ONLY valid JSON:\n{"questions":["follow-up 1","follow-up 2"]}`;
  }

  private buildResumeAnalysisPrompt(params: any): string {
    return `You are an expert technical recruiter.\nAnalyze this resume.\n\nRESUME: "${params.resumeText}"\n${params.targetRole ? `TARGET ROLE: ${params.targetRole}` : ''}\n\nReturn ONLY valid JSON:\n{"skills":[],"programmingLanguages":[],"frameworks":[],"tools":[],"projects":[{"name":"","description":"","technologies":[]}],"experience":0,"education":[{"degree":"","institution":"","year":"","gpa":""}],"certifications":[],"achievements":[],"industries":[],"leadership":[],"summary":"","matchScore":0,"recommendations":[]}`;
  }

  private buildRecommendationsPrompt(params: any): string {
    return `You are a senior career coach.\nGenerate personalized recommendations.\n\nPROFILE: ${JSON.stringify(params.userProfile)}\nHISTORY: ${JSON.stringify(params.interviewHistory)}\nPERFORMANCE: ${JSON.stringify(params.currentPerformance)}\n\nReturn ONLY valid JSON:\n{"recommendations":[{"category":"","title":"","description":"","priority":"high","timeframe":"","resources":[]}],"learningPath":[{"step":1,"title":"","description":"","duration":""}],"practiceAreas":[]}`;
  }
}

export default new GeminiService();
