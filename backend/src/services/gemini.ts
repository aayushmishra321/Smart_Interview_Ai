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
    // Use gemini-2.5-flash model (latest available)
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.model = this.genAI.getGenerativeModel({ 
      model: modelName
    });
    console.log('✅ Gemini service initialized with model:', modelName);
  }

  // Generate interview questions based on role and resume
  async generateInterviewQuestions(params: {
  role: string;
  experienceLevel: string;
  interviewType: string;
  resumeContext?: any;
  domain?: string; // ⭐ ADD THIS
  difficulty: string;
  count: number;
}): Promise<any[]> {
    console.log('=== GENERATING INTERVIEW QUESTIONS ===');
    console.log('Params:', JSON.stringify(params, null, 2));
    
    try {
      const prompt = this.buildQuestionGenerationPrompt(params);
      console.log('Prompt length:', prompt.length);
      
      console.log('Calling Gemini API...');
      const result = await this.model.generateContent(prompt);
      console.log('Gemini API responded');
      
      const response = await result.response;
      const text = response.text();
      console.log('Response text length:', text.length);
      console.log('Response text preview:', text.substring(0, 200));

      // Try to parse the JSON response
      let questions;
      try {
        // Remove markdown code blocks if present
        const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        questions = JSON.parse(cleanText);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.error('Raw text:', text);
        
        // Fallback: Generate default questions
        console.log('Using fallback questions due to parse error...');
        return this.generateFallbackQuestions(params);
      }
      
      // Ensure questions is an array
      if (!Array.isArray(questions)) {
        if (questions.questions && Array.isArray(questions.questions)) {
          questions = questions.questions;
        } else {
          console.error('Questions is not an array:', questions);
          return this.generateFallbackQuestions(params);
        }
      }
      
      logger.info(`Generated ${questions.length} questions for ${params.role} role`);
      console.log(`✅ Successfully generated ${questions.length} questions`);
      return questions;

    } catch (error: any) {
      console.error('=== ERROR GENERATING QUESTIONS ===');
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
      logger.error('Error generating interview questions:', error);
      
      // Return fallback questions instead of throwing
      console.log('⚠️ Returning fallback questions due to error...');
      return this.generateFallbackQuestions(params);
    }
  }

  // Generate fallback questions when AI fails
  private generateFallbackQuestions(params: {
    role: string;
    interviewType: string;
    difficulty: string;
    count: number;
  }): any[] {
    console.log('Generating fallback questions for:', params.role, params.interviewType);
    
    // Special fallback for coding interviews
    if (params.interviewType === 'coding') {
      const codingQuestions = [
        // Easy - Arrays
        {
          id: `q_${Date.now()}_1`,
          text: "Two Sum",
          description: "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\n\nYou may assume that each input would have exactly one solution, and you may not use the same element twice.\n\nYou can return the answer in any order.",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 15,
          category: 'arrays',
          examples: [
            {
              input: "nums = [2,7,11,15], target = 9",
              output: "[0,1]",
              explanation: "Because nums[0] + nums[1] == 9, we return [0, 1]."
            },
            {
              input: "nums = [3,2,4], target = 6",
              output: "[1,2]",
              explanation: "Because nums[1] + nums[2] == 6, we return [1, 2]."
            }
          ],
          constraints: [
            "2 <= nums.length <= 10^4",
            "-10^9 <= nums[i] <= 10^9",
            "-10^9 <= target <= 10^9",
            "Only one valid answer exists."
          ],
          testCases: [
            { input: "[2,7,11,15]\n9", expectedOutput: "[0,1]" },
            { input: "[3,2,4]\n6", expectedOutput: "[1,2]" },
            { input: "[3,3]\n6", expectedOutput: "[0,1]" }
          ],
          followUpQuestions: [
            "What is the time complexity of your solution?",
            "Can you optimize the space complexity?",
            "How would you handle duplicate numbers?"
          ]
        },
        // Easy - Strings
        {
          id: `q_${Date.now()}_2`,
          text: "Valid Anagram",
          description: "Given two strings s and t, return true if t is an anagram of s, and false otherwise.\n\nAn Anagram is a word or phrase formed by rearranging the letters of a different word or phrase, typically using all the original letters exactly once.",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 10,
          category: 'strings',
          examples: [
            {
              input: 's = "anagram", t = "nagaram"',
              output: 'true',
              explanation: "Both strings contain the same characters with the same frequencies."
            },
            {
              input: 's = "rat", t = "car"',
              output: 'false',
              explanation: "The strings contain different characters."
            }
          ],
          constraints: [
            "1 <= s.length, t.length <= 5 * 10^4",
            "s and t consist of lowercase English letters."
          ],
          testCases: [
            { input: '"anagram"\n"nagaram"', expectedOutput: 'true' },
            { input: '"rat"\n"car"', expectedOutput: 'false' },
            { input: '"a"\n"ab"', expectedOutput: 'false' }
          ],
          followUpQuestions: [
            "What if the inputs contain Unicode characters?",
            "Can you solve it in O(n) time?",
            "What data structure would you use?"
          ]
        },
        // Medium - Stack
        {
          id: `q_${Date.now()}_3`,
          text: "Valid Parentheses",
          description: "Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.\n\nAn input string is valid if:\n1. Open brackets must be closed by the same type of brackets.\n2. Open brackets must be closed in the correct order.\n3. Every close bracket has a corresponding open bracket of the same type.",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 15,
          category: 'stack',
          examples: [
            {
              input: 's = "()"',
              output: 'true',
              explanation: "The string has valid parentheses."
            },
            {
              input: 's = "()[]{}"',
              output: 'true',
              explanation: "All brackets are properly closed."
            },
            {
              input: 's = "(]"',
              output: 'false',
              explanation: "Brackets are not properly matched."
            }
          ],
          constraints: [
            "1 <= s.length <= 10^4",
            "s consists of parentheses only '()[]{}'."
          ],
          testCases: [
            { input: '"()"', expectedOutput: 'true' },
            { input: '"()[]{}"', expectedOutput: 'true' },
            { input: '"(]"', expectedOutput: 'false' },
            { input: '"([)]"', expectedOutput: 'false' },
            { input: '"{[]}"', expectedOutput: 'true' }
          ],
          followUpQuestions: [
            "What data structure did you use?",
            "What is the space complexity?",
            "How would you handle nested brackets?"
          ]
        },
        // Medium - Arrays
        {
          id: `q_${Date.now()}_4`,
          text: "Product of Array Except Self",
          description: "Given an integer array nums, return an array answer such that answer[i] is equal to the product of all the elements of nums except nums[i].\n\nThe product of any prefix or suffix of nums is guaranteed to fit in a 32-bit integer.\n\nYou must write an algorithm that runs in O(n) time and without using the division operation.",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 20,
          category: 'arrays',
          examples: [
            {
              input: 'nums = [1,2,3,4]',
              output: '[24,12,8,6]',
              explanation: "answer[0] = 2*3*4 = 24, answer[1] = 1*3*4 = 12, answer[2] = 1*2*4 = 8, answer[3] = 1*2*3 = 6"
            },
            {
              input: 'nums = [-1,1,0,-3,3]',
              output: '[0,0,9,0,0]',
              explanation: "The product of all elements except the zero is 0."
            }
          ],
          constraints: [
            "2 <= nums.length <= 10^5",
            "-30 <= nums[i] <= 30",
            "The product of any prefix or suffix of nums is guaranteed to fit in a 32-bit integer."
          ],
          testCases: [
            { input: '[1,2,3,4]', expectedOutput: '[24,12,8,6]' },
            { input: '[-1,1,0,-3,3]', expectedOutput: '[0,0,9,0,0]' },
            { input: '[1,2]', expectedOutput: '[2,1]' }
          ],
          followUpQuestions: [
            "Can you solve it without using division?",
            "What is the space complexity?",
            "Can you do it in O(1) extra space?"
          ]
        },
        // Medium - Dynamic Programming
        {
          id: `q_${Date.now()}_5`,
          text: "Maximum Subarray (Kadane's Algorithm)",
          description: "Given an integer array nums, find the subarray with the largest sum, and return its sum.\n\nA subarray is a contiguous non-empty sequence of elements within an array.",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 20,
          category: 'dynamic-programming',
          examples: [
            {
              input: 'nums = [-2,1,-3,4,-1,2,1,-5,4]',
              output: '6',
              explanation: "The subarray [4,-1,2,1] has the largest sum 6."
            },
            {
              input: 'nums = [1]',
              output: '1',
              explanation: "The subarray [1] has the largest sum 1."
            },
            {
              input: 'nums = [5,4,-1,7,8]',
              output: '23',
              explanation: "The subarray [5,4,-1,7,8] has the largest sum 23."
            }
          ],
          constraints: [
            "1 <= nums.length <= 10^5",
            "-10^4 <= nums[i] <= 10^4"
          ],
          testCases: [
            { input: '[-2,1,-3,4,-1,2,1,-5,4]', expectedOutput: '6' },
            { input: '[1]', expectedOutput: '1' },
            { input: '[5,4,-1,7,8]', expectedOutput: '23' }
          ],
          followUpQuestions: [
            "Can you solve it using Kadane's algorithm?",
            "What is the time complexity?",
            "How would you find the actual subarray, not just the sum?"
          ]
        },
        // Medium - Linked Lists
        {
          id: `q_${Date.now()}_6`,
          text: "Reverse Linked List",
          description: "Given the head of a singly linked list, reverse the list, and return the reversed list.\n\nA linked list can be reversed either iteratively or recursively. Could you implement both?",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 15,
          category: 'linked-lists',
          examples: [
            {
              input: 'head = [1,2,3,4,5]',
              output: '[5,4,3,2,1]',
              explanation: "The linked list is reversed."
            },
            {
              input: 'head = [1,2]',
              output: '[2,1]',
              explanation: "The linked list is reversed."
            },
            {
              input: 'head = []',
              output: '[]',
              explanation: "Empty list remains empty."
            }
          ],
          constraints: [
            "The number of nodes in the list is the range [0, 5000].",
            "-5000 <= Node.val <= 5000"
          ],
          testCases: [
            { input: '[1,2,3,4,5]', expectedOutput: '[5,4,3,2,1]' },
            { input: '[1,2]', expectedOutput: '[2,1]' },
            { input: '[]', expectedOutput: '[]' }
          ],
          followUpQuestions: [
            "Can you do it recursively?",
            "What is the space complexity of each approach?",
            "How would you reverse only part of the list?"
          ]
        },
        // Medium - Binary Search
        {
          id: `q_${Date.now()}_7`,
          text: "Search in Rotated Sorted Array",
          description: "There is an integer array nums sorted in ascending order (with distinct values).\n\nPrior to being passed to your function, nums is possibly rotated at an unknown pivot index k (1 <= k < nums.length) such that the resulting array is [nums[k], nums[k+1], ..., nums[n-1], nums[0], nums[1], ..., nums[k-1]] (0-indexed).\n\nGiven the array nums after the possible rotation and an integer target, return the index of target if it is in nums, or -1 if it is not in nums.\n\nYou must write an algorithm with O(log n) runtime complexity.",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 25,
          category: 'binary-search',
          examples: [
            {
              input: 'nums = [4,5,6,7,0,1,2], target = 0',
              output: '4',
              explanation: "The target 0 is at index 4."
            },
            {
              input: 'nums = [4,5,6,7,0,1,2], target = 3',
              output: '-1',
              explanation: "The target 3 is not in the array."
            },
            {
              input: 'nums = [1], target = 0',
              output: '-1',
              explanation: "The target 0 is not in the array."
            }
          ],
          constraints: [
            "1 <= nums.length <= 5000",
            "-10^4 <= nums[i] <= 10^4",
            "All values of nums are unique.",
            "nums is an ascending array that is possibly rotated.",
            "-10^4 <= target <= 10^4"
          ],
          testCases: [
            { input: '[4,5,6,7,0,1,2]\n0', expectedOutput: '4' },
            { input: '[4,5,6,7,0,1,2]\n3', expectedOutput: '-1' },
            { input: '[1]\n0', expectedOutput: '-1' }
          ],
          followUpQuestions: [
            "How do you determine which half is sorted?",
            "What is the time complexity?",
            "Can you handle duplicates?"
          ]
        },
        // Hard - Trees
        {
          id: `q_${Date.now()}_8`,
          text: "Binary Tree Maximum Path Sum",
          description: "A path in a binary tree is a sequence of nodes where each pair of adjacent nodes in the sequence has an edge connecting them. A node can only appear in the sequence at most once. Note that the path does not need to pass through the root.\n\nThe path sum of a path is the sum of the node's values in the path.\n\nGiven the root of a binary tree, return the maximum path sum of any non-empty path.",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 30,
          category: 'trees',
          examples: [
            {
              input: 'root = [1,2,3]',
              output: '6',
              explanation: "The optimal path is 2 -> 1 -> 3 with a path sum of 2 + 1 + 3 = 6."
            },
            {
              input: 'root = [-10,9,20,null,null,15,7]',
              output: '42',
              explanation: "The optimal path is 15 -> 20 -> 7 with a path sum of 15 + 20 + 7 = 42."
            }
          ],
          constraints: [
            "The number of nodes in the tree is in the range [1, 3 * 10^4].",
            "-1000 <= Node.val <= 1000"
          ],
          testCases: [
            { input: '[1,2,3]', expectedOutput: '6' },
            { input: '[-10,9,20,null,null,15,7]', expectedOutput: '42' },
            { input: '[1]', expectedOutput: '1' }
          ],
          followUpQuestions: [
            "How do you handle negative values?",
            "What is the time complexity?",
            "Can you explain your recursive approach?"
          ]
        },
        // Hard - Dynamic Programming
        {
          id: `q_${Date.now()}_9`,
          text: "Longest Increasing Subsequence",
          description: "Given an integer array nums, return the length of the longest strictly increasing subsequence.\n\nA subsequence is an array that can be derived from another array by deleting some or no elements without changing the order of the remaining elements.",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 25,
          category: 'dynamic-programming',
          examples: [
            {
              input: 'nums = [10,9,2,5,3,7,101,18]',
              output: '4',
              explanation: "The longest increasing subsequence is [2,3,7,101], therefore the length is 4."
            },
            {
              input: 'nums = [0,1,0,3,2,3]',
              output: '4',
              explanation: "The longest increasing subsequence is [0,1,2,3]."
            },
            {
              input: 'nums = [7,7,7,7,7,7,7]',
              output: '1',
              explanation: "All elements are the same, so the longest increasing subsequence is just one element."
            }
          ],
          constraints: [
            "1 <= nums.length <= 2500",
            "-10^4 <= nums[i] <= 10^4"
          ],
          testCases: [
            { input: '[10,9,2,5,3,7,101,18]', expectedOutput: '4' },
            { input: '[0,1,0,3,2,3]', expectedOutput: '4' },
            { input: '[7,7,7,7,7,7,7]', expectedOutput: '1' }
          ],
          followUpQuestions: [
            "Can you solve it in O(n log n) time?",
            "What is the space complexity?",
            "How would you find the actual subsequence?"
          ]
        },
        // Medium - Two Pointers
        {
          id: `q_${Date.now()}_10`,
          text: "Container With Most Water",
          description: "You are given an integer array height of length n. There are n vertical lines drawn such that the two endpoints of the ith line are (i, 0) and (i, height[i]).\n\nFind two lines that together with the x-axis form a container, such that the container contains the most water.\n\nReturn the maximum amount of water a container can store.\n\nNotice that you may not slant the container.",
          type: 'coding',
          difficulty: params.difficulty,
          expectedDuration: 20,
          category: 'two-pointers',
          examples: [
            {
              input: 'height = [1,8,6,2,5,4,8,3,7]',
              output: '49',
              explanation: "The vertical lines are at indices 1 and 8. The area is min(8,7) * (8-1) = 7 * 7 = 49."
            },
            {
              input: 'height = [1,1]',
              output: '1',
              explanation: "The area is min(1,1) * (1-0) = 1."
            }
          ],
          constraints: [
            "n == height.length",
            "2 <= n <= 10^5",
            "0 <= height[i] <= 10^4"
          ],
          testCases: [
            { input: '[1,8,6,2,5,4,8,3,7]', expectedOutput: '49' },
            { input: '[1,1]', expectedOutput: '1' },
            { input: '[4,3,2,1,4]', expectedOutput: '16' }
          ],
          followUpQuestions: [
            "Why does the two-pointer approach work?",
            "What is the time complexity?",
            "Can you prove the correctness of your algorithm?"
          ]
        }
      ];
      
      // Return appropriate number based on difficulty and count
      return codingQuestions.slice(0, Math.min(params.count, codingQuestions.length));
    }
    
    // Regular behavioral/technical questions
    if (params.interviewType === 'technical') {
  return [
      {
        id: `q_${Date.now()}_1`,
        text: `Tell me about your experience as a ${params.role}. What are your key responsibilities?`,
        type: 'behavioral',
        difficulty: params.difficulty,
        expectedDuration: 5,
        category: 'experience',
        followUpQuestions: [
          'What was your biggest achievement in this role?',
          'What challenges did you face?'
        ]
      },
      {
        id: `q_${Date.now()}_2`,
        text: `Describe a challenging project you worked on. How did you approach it?`,
        type: 'behavioral',
        difficulty: params.difficulty,
        expectedDuration: 5,
        category: 'problem-solving',
        followUpQuestions: [
          'What would you do differently?',
          'What did you learn from this experience?'
        ]
      },
      {
        id: `q_${Date.now()}_3`,
        text: `What technical skills are most important for a ${params.role}? How have you developed these skills?`,
        type: 'technical',
        difficulty: params.difficulty,
        expectedDuration: 5,
        category: 'technical-skills',
        followUpQuestions: [
          'Can you give an example of using these skills?',
          'How do you stay updated with new technologies?'
        ]
      },
      {
        id: `q_${Date.now()}_4`,
        text: `How do you handle tight deadlines and pressure in your work?`,
        type: 'behavioral',
        difficulty: params.difficulty,
        expectedDuration: 5,
        category: 'work-style',
        followUpQuestions: [
          'Can you give a specific example?',
          'What strategies do you use to manage stress?'
        ]
      },
      {
        id: `q_${Date.now()}_5`,
        text: `Where do you see yourself in the next 3-5 years in your career as a ${params.role}?`,
        type: 'behavioral',
        difficulty: params.difficulty,
        expectedDuration: 5,
        category: 'career-goals',
        followUpQuestions: [
          'What steps are you taking to achieve these goals?',
          'How does this position fit into your career plan?'
        ]
      },
      {
        id: `q_${Date.now()}_6`,
        text: `Describe your approach to learning new technologies or skills required for a ${params.role}.`,
        type: 'behavioral',
        difficulty: params.difficulty,
        expectedDuration: 5,
        category: 'learning',
        followUpQuestions: [
          'What was the last new skill you learned?',
          'How long did it take you to become proficient?'
        ]
      },
      {
        id: `q_${Date.now()}_7`,
        text: `Tell me about a time when you had to work with a difficult team member. How did you handle it?`,
        type: 'behavioral',
        difficulty: params.difficulty,
        expectedDuration: 5,
        category: 'teamwork',
        followUpQuestions: [
          'What was the outcome?',
          'What would you do differently?'
        ]
      },
      {
        id: `q_${Date.now()}_8`,
        text: `What do you consider your greatest strength as a ${params.role}? Can you provide an example?`,
        type: 'behavioral',
        difficulty: params.difficulty,
        expectedDuration: 5,
        category: 'strengths',
        followUpQuestions: [
          'How has this strength helped you in your career?',
          'How do you continue to develop this strength?'
        ]
      },
      {
        id: `q_${Date.now()}_9`,
        text: `Describe a situation where you had to make a difficult decision. What was your thought process?`,
        type: 'behavioral',
        difficulty: params.difficulty,
        expectedDuration: 5,
        category: 'decision-making',
        followUpQuestions: [
          'What was the outcome of your decision?',
          'Would you make the same decision again?'
        ]
      }
    ]};

    return [
  {
    id: `q_${Date.now()}_default`,
    text: `Tell me about your background as a ${params.role}.`,
    type: 'behavioral',
    difficulty: params.difficulty,
    expectedDuration: 5,
    category: 'general',
    followUpQuestions: []
  }
];
    
    
  }

  // Analyze interview response
  async analyzeResponse(params: {
    question: string;
    answer: string;
    role: string;
    expectedKeywords?: string[];
    context?: any;
  }): Promise<any> {
    console.log('=== ANALYZING RESPONSE ===');
    console.log('Question:', params.question.substring(0, 50) + '...');
    console.log('Answer length:', params.answer.length);
    
    try {
      const prompt = this.buildResponseAnalysisPrompt(params);
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Try to parse the JSON response
      let analysis;
      try {
        const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        analysis = JSON.parse(cleanText);
      } catch (parseError) {
        console.error('JSON parse error in analysis:', parseError);
        // Return fallback analysis
        return this.generateFallbackAnalysis(params);
      }
      
      logger.info(`Analyzed response for question: ${params.question.substring(0, 50)}...`);
      console.log('✅ Response analyzed successfully');
      return analysis;

    } catch (error: any) {
      console.error('=== ERROR ANALYZING RESPONSE ===');
      console.error('Error:', error.message);
      logger.error('Error analyzing response:', error);
      
      // Return fallback analysis instead of throwing
      console.log('⚠️ Returning fallback analysis...');
      return this.generateFallbackAnalysis(params);
    }
  }

  // Generate fallback analysis when AI fails
  private generateFallbackAnalysis(params: {
    question: string;
    answer: string;
    role: string;
  }): any {
    console.log('Generating fallback analysis...');
    
    // Simple heuristic-based analysis
    const answerLength = params.answer.length;
    const wordCount = params.answer.split(/\s+/).length;
    const hasExamples = /example|instance|case|situation|time when/i.test(params.answer);
    const hasTechnicalTerms = /\b(code|system|design|implement|develop|build|test|deploy)\b/i.test(params.answer);
    
    // Calculate basic scores
    const lengthScore = Math.min(100, (answerLength / 500) * 100);
    const wordCountScore = Math.min(100, (wordCount / 100) * 100);
    const exampleScore = hasExamples ? 85 : 60;
    const technicalScore = hasTechnicalTerms ? 85 : 70;
    
    const overallScore = Math.round((lengthScore + wordCountScore + exampleScore + technicalScore) / 4);
    
    return {
      scores: {
        relevance: Math.min(100, overallScore + 5),
        technicalAccuracy: technicalScore,
        clarity: Math.min(100, wordCountScore),
        structure: Math.min(100, lengthScore),
        depth: exampleScore,
        examples: hasExamples ? 85 : 60
      },
      overallScore,
      strengths: [
        hasExamples ? 'Provided concrete examples' : 'Clear communication',
        hasTechnicalTerms ? 'Demonstrated technical knowledge' : 'Good articulation',
        wordCount > 50 ? 'Comprehensive answer' : 'Concise response'
      ],
      improvements: [
        !hasExamples ? 'Include more specific examples' : 'Consider adding more context',
        wordCount < 50 ? 'Provide more detailed explanations' : 'Maintain clarity',
        !hasTechnicalTerms ? 'Include more technical details' : 'Continue demonstrating expertise'
      ],
      missingElements: [],
      keywordMatches: [],
      feedback: `Your response demonstrates ${overallScore >= 75 ? 'strong' : 'good'} understanding. ${hasExamples ? 'The examples you provided add credibility.' : 'Consider adding specific examples to strengthen your answer.'} ${hasTechnicalTerms ? 'Your technical knowledge is evident.' : 'Try to incorporate more technical details where relevant.'}`
    };
  }

  // Generate comprehensive feedback
  async generateFeedback(params: {
    interviewData: any;
    analysisResults: any;
    userProfile: any;
  }): Promise<any> {
    console.log('=== GENERATING FEEDBACK ===');
    console.log('Interview type:', params.interviewData.type);
    
    try {
      const prompt = this.buildFeedbackPrompt(params);
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Try to parse the JSON response
      let feedback;
      try {
        const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        feedback = JSON.parse(cleanText);
      } catch (parseError) {
        console.error('JSON parse error in feedback:', parseError);
        // Return fallback feedback
        return this.generateFallbackFeedback(params);
      }
      
      logger.info(`Generated comprehensive feedback for interview ${params.interviewData.id}`);
      console.log('✅ Feedback generated successfully');
      return feedback;

    } catch (error: any) {
      console.error('=== ERROR GENERATING FEEDBACK ===');
      console.error('Error:', error.message);
      logger.error('Error generating feedback:', error);
      
      // Return fallback feedback instead of throwing
      console.log('⚠️ Returning fallback feedback...');
      return this.generateFallbackFeedback(params);
    }
  }

  // Generate fallback feedback when AI fails
  private generateFallbackFeedback(params: {
    interviewData: any;
    analysisResults: any;
    userProfile: any;
  }): any {
    console.log('Generating fallback feedback...');
    
    const { interviewData, analysisResults } = params;
    const completionRate = (interviewData.questionsAnswered / interviewData.totalQuestions) * 100;
    const overallScore = analysisResults?.overallScore || 75;
    
    return {
      overallRating: overallScore,
      strengths: [
        'Completed the interview with good engagement',
        'Demonstrated clear communication skills',
        'Showed understanding of the role requirements'
      ],
      improvements: [
        'Practice providing more specific examples',
        'Work on structuring responses using the STAR method',
        'Continue developing technical knowledge'
      ],
      recommendations: [
        'Review common interview questions for your role',
        'Practice mock interviews to build confidence',
        'Research the company and role thoroughly before interviews'
      ],
      skillAssessment: [],
      nextSteps: [
        'Take more practice interviews to improve',
        'Focus on areas identified for improvement',
        'Review your responses and refine your answers'
      ],
      detailedFeedback: `You completed ${completionRate.toFixed(0)}% of the interview questions. Your overall performance shows ${overallScore >= 80 ? 'strong' : overallScore >= 60 ? 'good' : 'developing'} interview skills. Continue practicing to improve your confidence and response quality. Focus on providing specific examples and demonstrating your expertise clearly.`
    };
  }

  // Generate follow-up questions
  async generateFollowUpQuestions(params: {
    originalQuestion: string;
    userAnswer: string;
    role: string;
    context?: any;
  }): Promise<string[]> {
    try {
      const prompt = this.buildFollowUpPrompt(params);
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const followUps = JSON.parse(text);
      
      return followUps.questions || [];

    } catch (error) {
      logger.error('Error generating follow-up questions:', error);
      return [];
    }
  }

  // Analyze resume content
  async analyzeResume(params: {
    resumeText: string;
    targetRole?: string;
  }): Promise<any> {
    try {
      const prompt = this.buildResumeAnalysisPrompt(params);
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const analysis = JSON.parse(text);
      
      logger.info('Analyzed resume content');
      return analysis;

    } catch (error) {
      logger.error('Error analyzing resume:', error);
      throw new Error('Failed to analyze resume');
    }
  }

  // Generate improvement recommendations
  async generateRecommendations(params: {
    userProfile: any;
    interviewHistory: any[];
    currentPerformance: any;
  }): Promise<any> {
    try {
      const prompt = this.buildRecommendationsPrompt(params);
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const recommendations = JSON.parse(text);
      
      return recommendations;

    } catch (error) {
      logger.error('Error generating recommendations:', error);
      throw new Error('Failed to generate recommendations');
    }
  }

  // Private helper methods for building prompts

  private buildQuestionGenerationPrompt(params: any): string {
  const resumeSkills =
  params.resumeContext?.skills?.length > 0
    ? params.resumeContext.skills.join(', ')
    : '';

  const resumeProjects =
    params.resumeContext?.projects?.length > 0
      ? params.resumeContext.projects
          .map((p: any) =>
            `${p.name || 'Project'}: ${p.description || ''} Technologies: ${(p.technologies || []).join(', ')}`
          )
          .join('\n')
      : '';

  const domainInstruction = params.domain
    ? `CRITICAL: Generate ONLY questions related to ${params.domain}. Do NOT ask anything outside this domain.`
    : '';


    const resumeInstruction =
  resumeSkills || resumeProjects
    ? `
Candidate Resume Context:

Skills:
${resumeSkills}

Projects:
${resumeProjects}

CRITICAL RULES:
- Generate at least ONE question per project.
- Generate questions based on the technologies used in the projects.
- Generate questions based on the candidate skills.
- Ask implementation-level questions.
- Ask debugging scenarios from the projects.
- Ask architecture questions about the system design of the projects.
`
    : '';

  // ================= CODING =================
  if (params.interviewType === 'coding') {
    return `
You are an expert coding interviewer.

Generate ${params.count} algorithmic coding problems.

Role: ${params.role}
Difficulty: ${params.difficulty}

Requirements:
- Real LeetCode style problems
- Input/output examples
- Constraints
- Test cases
- Algorithm hints
- NO behavioral questions
- NO theory questions

Return JSON array only.
`;
  }

  // ================= TECHNICAL =================
  if (params.interviewType === 'technical') {
    return `
You are a senior FAANG technical interviewer.

Generate ${params.count} HIGH QUALITY technical interview questions.

Role: ${params.role}
Experience Level: ${params.experienceLevel}
Difficulty: ${params.difficulty}

${domainInstruction}
${resumeInstruction}

STRICT RULES:
- ONLY technical questions
- NO behavioral questions
- NO generic HR questions
- Ask deep implementation questions
- Ask system-level understanding
- Ask real interview questions
- Focus on how things work internally
- Ask scenario-based problems

Examples of good questions:
- Java memory management
- DBMS indexing
- OS process scheduling
- React rendering lifecycle
- Network TCP handshake

Return JSON array format:
[
  {
    "id": "unique_id",
    "text": "question",
    "type": "technical",
    "difficulty": "${params.difficulty}",
    "expectedDuration": 5,
    "category": "topic",
    "followUpQuestions": []
  }
]
`;
  }

  // ================= SYSTEM DESIGN =================
  // ================= SKILL BASED =================
if (params.interviewType === 'skill-based') {
  return `
You are a senior technical interviewer.

Generate ${params.count} DEEP SKILL-BASED interview questions.

Role: ${params.role}
Primary Skill / Domain: ${params.domain || 'candidate skills'}
Difficulty: ${params.difficulty}

STRICT RULES:
- ONLY technical questions
- NO behavioral questions
- NO "describe a time" questions
- NO HR questions
- Ask implementation-level questions
- Ask "how it works internally"
- Ask debugging scenarios
- Ask real interview questions

Focus on:
- core concepts
- internal working
- architecture
- optimization
- real coding scenarios

If domain is React ask about:
- hooks
- lifecycle
- reconciliation
- state management
- performance optimization

Return JSON format:
[
  {
    "id": "q1",
    "text": "question",
    "type": "skill-based",
    "difficulty": "${params.difficulty}",
    "expectedDuration": 5,
    "category": "${params.domain || 'technical'}",
    "followUpQuestions": []
  }
]
`;
}
  if (params.interviewType === 'system-design') {
    return `
You are a senior system design interviewer.

Generate ${params.count} system design problems.

Focus on:
- scalability
- architecture
- database design
- load balancing
- caching
- distributed systems

Return JSON array only.
`;
  }

  // ================= BEHAVIORAL =================
  return `
Generate ${params.count} behavioral interview questions for ${params.role}.

Return JSON array only.
`;
}

  private buildResponseAnalysisPrompt(params: any): string {
  return `
You are a senior FAANG technical interviewer and interview evaluation expert.

Evaluate the candidate's interview response.

INTERVIEW QUESTION:
"${params.question}"

CANDIDATE ANSWER:
"${params.answer}"

ROLE:
${params.role}

${params.expectedKeywords ? `Expected Technical Keywords: ${params.expectedKeywords.join(', ')}` : ''}

Evaluate the answer carefully across the following dimensions:

1. Relevance – Does the answer directly address the question?
2. Technical Accuracy – Are the technical concepts correct?
3. Communication Clarity – Is the explanation clear and understandable?
4. Structure – Is the answer logically structured and organized?
5. Depth of Knowledge – Does the answer show strong understanding?
6. Practical Experience – Does the candidate reference real-world experience?
7. Use of Examples – Are examples or scenarios provided?

SCORING RULES:
- Score each dimension from 0–100
- Scores must be realistic (avoid always giving high scores)
- Penalize vague or generic answers
- Reward answers with clear technical reasoning

Also determine:

Strengths:
- What the candidate did well

Improvements:
- What the candidate should improve

Missing Elements:
- Important concepts or explanations that were missing

Keyword Matches:
- Which relevant technical keywords appeared in the answer

OVERALL EVALUATION:
- Provide a clear summary explaining the candidate's performance.

IMPORTANT:
Return ONLY valid JSON.
Do NOT include markdown.
Do NOT include explanations outside JSON.

JSON FORMAT:

{
  "scores": {
    "relevance": 0,
    "technicalAccuracy": 0,
    "clarity": 0,
    "structure": 0,
    "depth": 0,
    "examples": 0,
    "practicalExperience": 0
  },
  "overallScore": 0,
  "strengths": [],
  "improvements": [],
  "missingElements": [],
  "keywordMatches": [],
  "feedback": ""
}
`;
}

  private buildFeedbackPrompt(params: any): string {
  return `
You are a senior FAANG interview coach and technical hiring expert.

Generate professional interview feedback based on the candidate's interview performance.

INTERVIEW DATA:
${JSON.stringify(params.interviewData, null, 2)}

AI ANALYSIS RESULTS:
${JSON.stringify(params.analysisResults, null, 2)}

USER PROFILE:
${JSON.stringify(params.userProfile, null, 2)}

Evaluate the candidate across the following areas:

1. Technical Knowledge
2. Problem Solving Ability
3. Communication Clarity
4. Answer Structure
5. Practical Experience
6. Confidence and Professionalism

Use the analysis results to determine the candidate's strengths and weaknesses.

Generate the following:

OVERALL RATING
- Score from 0 to 100
- Reflect the candidate's real interview performance

STRENGTHS
- List 3–5 strong areas demonstrated during the interview

AREAS FOR IMPROVEMENT
- Identify 3–5 weaknesses or missing elements

RECOMMENDATIONS
- Provide 3–5 actionable steps to improve interview performance

SKILL ASSESSMENT
Evaluate important interview skills with levels:
- Communication
- Technical Knowledge
- Problem Solving
- System Thinking (if relevant)
- Confidence

Each skill should contain:
- skill name
- currentLevel (1–10)
- targetLevel (1–10)
- short explanation

NEXT STEPS
Suggest practical next steps the candidate should take to improve interview readiness.

DETAILED FEEDBACK
Write a professional paragraph summarizing the candidate's interview performance, highlighting strengths and improvement areas.

IMPORTANT RULES:
- Be realistic and constructive.
- Avoid generic feedback.
- Use insights from the analysis results.
- Return ONLY valid JSON.
- Do NOT include markdown or explanations outside JSON.

JSON FORMAT:

{
  "overallRating": 0,
  "strengths": [],
  "improvements": [],
  "recommendations": [],
  "skillAssessment": [
    {
      "skill": "",
      "currentLevel": 0,
      "targetLevel": 0,
      "feedback": ""
    }
  ],
  "nextSteps": [],
  "detailedFeedback": ""
}
`;
}

  private buildFollowUpPrompt(params: any): string {
  return `
You are a senior technical interviewer conducting a live interview.

The candidate has answered a question. Your job is to ask deeper follow-up questions to evaluate their understanding.

ORIGINAL QUESTION:
"${params.originalQuestion}"

CANDIDATE ANSWER:
"${params.userAnswer}"

ROLE:
${params.role}

Generate 2–3 intelligent follow-up questions.

The follow-up questions should:
- Dig deeper into the candidate's reasoning
- Ask for clarification if the answer is vague
- Explore edge cases or trade-offs
- Ask how the solution would work at scale
- Test real-world practical knowledge

Follow-up questions should feel like a real interviewer continuing the conversation.

Avoid:
- repeating the same question
- generic HR questions
- simple yes/no questions

IMPORTANT:
Return ONLY valid JSON.
Do NOT include markdown.
Do NOT include explanations.

JSON FORMAT:
{
  "questions": [
    "follow-up question 1",
    "follow-up question 2",
    "follow-up question 3"
  ]
}
`;
}

  private buildResumeAnalysisPrompt(params: any): string {
  return `
You are an expert technical recruiter and resume analyzer.

Analyze the following resume and extract structured information.

RESUME CONTENT:
"${params.resumeText}"

${params.targetRole ? `TARGET ROLE: ${params.targetRole}` : ''}

Carefully analyze the resume and extract the following information.

1. SKILLS
List all technical and soft skills mentioned.

2. PROGRAMMING LANGUAGES
Identify programming languages (Java, Python, C++, etc.).

3. FRAMEWORKS & LIBRARIES
Examples: React, Spring Boot, Django, TensorFlow, etc.

4. TOOLS & TECHNOLOGIES
Examples: Docker, Kubernetes, Git, AWS, MongoDB, MySQL, etc.

5. PROJECTS
Extract important projects including:
- project name
- short description
- technologies used

6. EXPERIENCE
Estimate total years of experience.

7. EDUCATION
Extract degree, institution, year, and GPA if available.

8. CERTIFICATIONS
List any certifications.

9. KEY ACHIEVEMENTS
Important accomplishments or recognitions.

10. INDUSTRY EXPERIENCE
Industries the candidate has worked in.

11. LEADERSHIP EXPERIENCE
Team leadership or management roles.

12. PROFESSIONAL SUMMARY
Generate a short professional summary of the candidate.

${params.targetRole ? `
13. MATCH SCORE
Evaluate how well this resume matches the target role (0–100).

14. IMPROVEMENT RECOMMENDATIONS
Suggest improvements to strengthen the resume for the target role.
` : ''}

IMPORTANT RULES:
- Extract only information present in the resume.
- Do not invent details.
- If a field is missing, return an empty array or null.
- Return ONLY valid JSON.
- Do NOT include markdown or explanations.

JSON FORMAT:

{
  "skills": [],
  "programmingLanguages": [],
  "frameworks": [],
  "tools": [],
  "projects": [
    {
      "name": "",
      "description": "",
      "technologies": []
    }
  ],
  "experience": 0,
  "education": [
    {
      "degree": "",
      "institution": "",
      "year": "",
      "gpa": ""
    }
  ],
  "certifications": [],
  "achievements": [],
  "industries": [],
  "leadership": [],
  "summary": "",
  "matchScore": 0,
  "recommendations": []
}
`;
}

  private buildRecommendationsPrompt(params: any): string {
  return `
You are a senior career coach, technical interviewer, and software engineering mentor.

Generate personalized improvement recommendations based on the candidate's profile and interview performance.

USER PROFILE:
${JSON.stringify(params.userProfile, null, 2)}

INTERVIEW HISTORY:
${JSON.stringify(params.interviewHistory, null, 2)}

CURRENT PERFORMANCE:
${JSON.stringify(params.currentPerformance, null, 2)}

Analyze the data carefully and identify:

1. Skill gaps in technical knowledge
2. Weaknesses in interview performance
3. Areas where communication can improve
4. Topics that need deeper understanding
5. Career growth opportunities

Generate recommendations in these categories:

1. Technical Skills
2. Interview Preparation
3. Communication Skills
4. System Design / Architecture (if relevant)
5. Industry Knowledge

For each recommendation include:

- category
- clear title
- detailed description
- priority (high | medium | low)
- suggested timeframe
- learning resources (courses, documentation, practice platforms)

Also generate a **structured learning path** that gradually improves the candidate's skills.

IMPORTANT RULES:
- Recommendations must be specific and actionable.
- Avoid generic advice.
- Use insights from the interview performance.
- Focus on realistic improvement steps.
- Return ONLY valid JSON.
- Do NOT include markdown or explanations.

JSON FORMAT:

{
  "recommendations": [
    {
      "category": "",
      "title": "",
      "description": "",
      "priority": "high|medium|low",
      "timeframe": "",
      "resources": []
    }
  ],
  "learningPath": [
    {
      "step": 1,
      "title": "",
      "description": "",
      "duration": ""
    }
  ],
  "practiceAreas": []
}
`;
}

// Analyze full interview transcript
async analyzeInterviewTranscript(params: {
  transcript: string;
  role: string;
}): Promise<any> {

  console.log('=== ANALYZING INTERVIEW TRANSCRIPT ===');

  try {

    const prompt = `
You are an AI interview analysis expert.

Analyze the following interview transcript and extract insights.

ROLE:
${params.role}

INTERVIEW TRANSCRIPT:
${params.transcript}

Analyze and determine:

1. Emotion distribution during the interview
2. Filler words used by the candidate
3. Speaking confidence level (0–100)
4. Answer quality score (0–100)
5. Interview timeline analysis

IMPORTANT:
Return ONLY valid JSON.

JSON FORMAT:

{
 "emotionAnalysis":[
  {"name":"Confident","value":40},
  {"name":"Neutral","value":30},
  {"name":"Nervous","value":20},
  {"name":"Happy","value":10}
 ],

 "fillerWords":[
  {"word":"um","count":5},
  {"word":"uh","count":3},
  {"word":"like","count":2}
 ],

 "speakingConfidence":0,
 "answerQuality":0,

 "timeline":[
  {"time":"0-5min","emotion":"Nervous","confidence":60},
  {"time":"5-10min","emotion":"Neutral","confidence":70},
  {"time":"10-15min","emotion":"Confident","confidence":85}
 ]
}
`;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    let analysis;

    try {
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleanText);
    } catch (error) {
      console.error('Transcript analysis parse error', error);
      return null;
    }

    console.log("✅ Transcript AI analysis complete");

    return analysis;

  } catch (error) {

    logger.error("Transcript analysis failed", error);

    return null;
  }
}
}

export default new GeminiService();