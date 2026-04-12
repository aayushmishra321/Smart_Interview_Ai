import axios from 'axios';
import logger from '../utils/logger';

interface CodeExecutionRequest {
  language: string;
  code: string;
  stdin?: string;
  testCases?: Array<{
    input: string;
    expectedOutput: string;
  }>;
}

interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime?: number;
  memory?: number;
  testResults?: Array<{
    input: string;
    expectedOutput: string;
    actualOutput: string;
    passed: boolean;
    executionTime?: number;
  }>;
}

// Language ID mapping for Piston API
const LANGUAGE_MAP: { [key: string]: string } = {
  javascript: 'javascript',
  python: 'python',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  csharp: 'csharp',
  go: 'go',
  rust: 'rust',
  typescript: 'typescript',
  ruby: 'ruby',
  php: 'php',
  swift: 'swift',
  kotlin: 'kotlin',
};

class CodeExecutionService {
  private pistonUrl: string;
  private judge0Url: string;
  private useJudge0: boolean;

  constructor() {
    this.pistonUrl = process.env.PISTON_URL || 'https://emkc.org/api/v2/piston';
    this.judge0Url = process.env.JUDGE0_URL || 'https://judge0-ce.p.rapidapi.com';
    this.useJudge0 = process.env.CODE_EXECUTION_SERVICE === 'judge0';
  }

  /**
   * Execute code using Piston API (free, no API key required)
   */
  async executeWithPiston(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    try {
      const startTime = Date.now();

      const response = await axios.post(
        `${this.pistonUrl}/execute`,
        {
          language: LANGUAGE_MAP[request.language] || request.language,
          version: '*', // Use latest version
          files: [
            {
              name: this.getFileName(request.language),
              content: request.code,
            },
          ],
          stdin: request.stdin || '',
          args: [],
          compile_timeout: 10000,
          run_timeout: 3000,
          compile_memory_limit: -1,
          run_memory_limit: -1,
        },
        {
          timeout: 15000,
        }
      );

      const executionTime = Date.now() - startTime;

      if (response.data.run) {
        const output = response.data.run.stdout || '';
        const error = response.data.run.stderr || '';

        return {
          success: !error && response.data.run.code === 0,
          output: output.trim(),
          error: error.trim() || undefined,
          executionTime,
        };
      }

      return {
        success: false,
        error: 'Execution failed',
      };
    } catch (error: any) {
      logger.error('Piston execution error:', error);
      return {
        success: false,
        error: error.message || 'Code execution failed',
      };
    }
  }

  /**
   * Execute code using Judge0 API (requires API key)
   */
  async executeWithJudge0(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    try {
      const apiKey = process.env.JUDGE0_API_KEY;
      if (!apiKey) {
        throw new Error('Judge0 API key not configured');
      }

      // Submit code for execution
      const submitResponse = await axios.post(
        `${this.judge0Url}/submissions`,
        {
          source_code: Buffer.from(request.code).toString('base64'),
          language_id: this.getJudge0LanguageId(request.language),
          stdin: request.stdin ? Buffer.from(request.stdin).toString('base64') : undefined,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-RapidAPI-Key': apiKey,
            'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
          },
        }
      );

      const token = submitResponse.data.token;

      // Poll for result
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const resultResponse = await axios.get(
          `${this.judge0Url}/submissions/${token}`,
          {
            headers: {
              'X-RapidAPI-Key': apiKey,
              'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
            },
          }
        );

        const result = resultResponse.data;

        if (result.status.id > 2) {
          // Execution completed
          return {
            success: result.status.id === 3, // 3 = Accepted
            output: result.stdout ? Buffer.from(result.stdout, 'base64').toString() : '',
            error: result.stderr ? Buffer.from(result.stderr, 'base64').toString() : undefined,
            executionTime: parseFloat(result.time) * 1000,
            memory: parseFloat(result.memory),
          };
        }

        attempts++;
      }

      return {
        success: false,
        error: 'Execution timeout',
      };
    } catch (error: any) {
      logger.error('Judge0 execution error:', error);
      return {
        success: false,
        error: error.message || 'Code execution failed',
      };
    }
  }

  /**
   * Execute code with test cases
   */
  async executeWithTestCases(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    if (!request.testCases || request.testCases.length === 0) {
      return this.execute(request);
    }

    const testResults = [];

    for (const testCase of request.testCases) {
      // Wrap user code to call the solution function with test input
      const wrappedCode = this.wrapCodeWithTestCase(
        request.language,
        request.code,
        testCase.input
      );

      const result = await this.execute({
        ...request,
        code: wrappedCode,
        stdin: '', // No stdin needed, we're calling the function directly
      });

      const actualOutput = (result.output || '').trim();
      const expectedOutput = testCase.expectedOutput.trim();

      testResults.push({
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        actualOutput: actualOutput,
        passed: actualOutput === expectedOutput,
        executionTime: result.executionTime,
      });
    }

    const allPassed = testResults.every((r) => r.passed);

    return {
      success: allPassed,
      testResults,
      output: testResults.map((r) => r.actualOutput).join('\n'),
    };
  }

  /**
   * Wrap user code to call solution function with test input
   */
  private wrapCodeWithTestCase(language: string, userCode: string, testInput: string): string {
    switch (language) {
      case 'python':
        // Parse JSON string and convert to Python literal
        try {
          const parsedInput = JSON.parse(testInput);
          const pythonInput = JSON.stringify(parsedInput);
          return `import json

${userCode}

# Test execution
test_input = json.loads('${pythonInput.replace(/'/g, "\\'")}')
result = solution(test_input)
print(result)`;
        } catch (e) {
          // If not valid JSON, treat as Python literal
          return `${userCode}

# Test execution
test_input = ${testInput}
result = solution(test_input)
print(result)`;
        }

      case 'javascript':
      case 'typescript':
        try {
          const parsedInput = JSON.parse(testInput);
          const jsInput = JSON.stringify(parsedInput);
          return `${userCode}

// Test execution
const testInput = ${jsInput};
const result = solution(testInput);
console.log(result);`;
        } catch (e) {
          return `${userCode}

// Test execution
const testInput = ${testInput};
const result = solution(testInput);
console.log(result);`;
        }

      case 'java':
        return `import com.google.gson.Gson;

${userCode}

public class Main {
    public static void main(String[] args) {
        Gson gson = new Gson();
        Object testInput = gson.fromJson("${testInput.replace(/"/g, '\\"')}", Object.class);
        Solution solution = new Solution();
        Object result = solution.solution(testInput);
        System.out.println(result);
    }
}`;

      case 'cpp':
        return `#include <iostream>
#include <string>
using namespace std;

${userCode}

int main() {
    // Note: C++ test case parsing is simplified
    Solution solution;
    auto result = solution.solution(${testInput});
    cout << result << endl;
    return 0;
}`;

      default:
        // For other languages, return code as-is and hope it works
        return `${userCode}

print(solution(${testInput}))`;
    }
  }

  /**
   * Execute code (uses configured service)
   */
  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    // Validate language
    if (!this.isLanguageSupported(request.language)) {
      return {
        success: false,
        error: `Language '${request.language}' is not supported`,
      };
    }

    // Validate code length
    if (request.code.length > 50000) {
      return {
        success: false,
        error: 'Code is too long (max 50KB)',
      };
    }

    try {
      if (this.useJudge0) {
        return await this.executeWithJudge0(request);
      } else {
        return await this.executeWithPiston(request);
      }
    } catch (error: any) {
      logger.error('Code execution error:', error);
      return {
        success: false,
        error: error.message || 'Code execution failed',
      };
    }
  }

  /**
   * Get supported languages
   */
  async getSupportedLanguages(): Promise<string[]> {
    return Object.keys(LANGUAGE_MAP);
  }

  /**
   * Check if language is supported
   */
  isLanguageSupported(language: string): boolean {
    return language in LANGUAGE_MAP;
  }

  /**
   * Get file name for language
   */
  private getFileName(language: string): string {
    const extensions: { [key: string]: string } = {
      javascript: 'main.js',
      python: 'main.py',
      java: 'Main.java',
      cpp: 'main.cpp',
      c: 'main.c',
      csharp: 'Main.cs',
      go: 'main.go',
      rust: 'main.rs',
      typescript: 'main.ts',
      ruby: 'main.rb',
      php: 'main.php',
      swift: 'main.swift',
      kotlin: 'Main.kt',
    };

    return extensions[language] || 'main.txt';
  }

  /**
   * Get Judge0 language ID
   */
  private getJudge0LanguageId(language: string): number {
    const languageIds: { [key: string]: number } = {
      javascript: 63, // Node.js
      python: 71, // Python 3
      java: 62, // Java
      cpp: 54, // C++ (GCC 9.2.0)
      c: 50, // C (GCC 9.2.0)
      csharp: 51, // C# (Mono 6.6.0.161)
      go: 60, // Go (1.13.5)
      rust: 73, // Rust (1.40.0)
      typescript: 74, // TypeScript (3.7.4)
      ruby: 72, // Ruby (2.7.0)
      php: 68, // PHP (7.4.1)
      swift: 83, // Swift (5.2.3)
      kotlin: 78, // Kotlin (1.3.70)
    };

    return languageIds[language] || 63;
  }

  /**
   * Test connection to code execution service
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.execute({
        language: 'python',
        code: 'print("Hello, World!")',
      });

      return result.success && result.output === 'Hello, World!';
    } catch (error) {
      logger.error('Code execution service test failed:', error);
      return false;
    }
  }
}

export const codeExecutionService = new CodeExecutionService();
export default codeExecutionService;
