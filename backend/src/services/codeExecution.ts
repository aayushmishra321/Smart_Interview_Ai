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
   * Execute code with test cases — runs each test case independently
   */
  async executeWithTestCases(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    if (!request.testCases || request.testCases.length === 0) {
      return this.execute(request);
    }

    const testResults = [];

    for (const testCase of request.testCases) {
      const wrappedCode = this.wrapCodeWithTestCase(
        request.language,
        request.code,
        testCase.input
      );

      logger.info(`Executing test case — language: ${request.language}, input: ${testCase.input.substring(0, 80)}`);

      const result = await this.execute({
        ...request,
        code: wrappedCode,
        stdin: '',
      });

      const rawOutput = (result.output || '').trim();
      const rawExpected = testCase.expectedOutput.trim();

      // Normalize both sides for comparison (handles [0,1] vs [0, 1] etc.)
      const normalizedActual   = this.normalizeOutput(rawOutput);
      const normalizedExpected = this.normalizeOutput(rawExpected);
      const passed = normalizedActual === normalizedExpected;

      logger.info(`Test result — actual: "${rawOutput}", expected: "${rawExpected}", passed: ${passed}`);

      testResults.push({
        input: testCase.input,
        expectedOutput: rawExpected,
        actualOutput: rawOutput,
        passed,
        executionTime: result.executionTime,
        error: result.error,
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
   * Normalize output for comparison — handles JSON arrays/objects with different spacing
   */
  private normalizeOutput(value: string): string {
    const trimmed = value.trim();
    try {
      // Parse and re-stringify to normalize spacing/ordering
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      // Not JSON — return trimmed lowercase string
      return trimmed.toLowerCase();
    }
  }

  /**
   * Build a self-contained executable file that:
   * 1. Includes the user's code
   * 2. Parses the test input correctly (handles multi-line inputs like "[1,2]\n9")
   * 3. Detects the function signature and calls it with the right arguments
   * 4. Prints the result as JSON
   */
  private wrapCodeWithTestCase(language: string, userCode: string, testInput: string): string {
    // Split multi-line input into individual argument lines
    const inputLines = testInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    switch (language) {

      // ── Python ──────────────────────────────────────────────────────────────
      case 'python': {
        const inputLinesJson = JSON.stringify(inputLines);
        return `import json, ast, sys

${userCode}

# ── Test harness ──────────────────────────────────────────────────────────────
def _parse(s):
    s = s.strip()
    try:
        return json.loads(s)
    except Exception:
        try:
            return ast.literal_eval(s)
        except Exception:
            return s

_input_lines = ${inputLinesJson}
_args = [_parse(line) for line in _input_lines]

# Detect the user-defined function (first def in their code)
import inspect, types
_user_funcs = [
    name for name, obj in list(globals().items())
    if callable(obj) and isinstance(obj, types.FunctionType)
    and not name.startswith('_')
]

if not _user_funcs:
    print("ERROR: No function found in submitted code", file=sys.stderr)
    sys.exit(1)

_fn = globals()[_user_funcs[0]]
_result = _fn(*_args)
print(json.dumps(_result))
`;
      }

      // ── JavaScript / TypeScript ──────────────────────────────────────────────
      case 'javascript':
      case 'typescript': {
        const inputLinesJson = JSON.stringify(inputLines);
        return `${userCode}

// ── Test harness ──────────────────────────────────────────────────────────────
const _inputLines = ${inputLinesJson};
function _parse(s) {
  try { return JSON.parse(s); } catch(e) { return s; }
}
const _args = _inputLines.map(_parse);

// Find the user-defined function
const _userFuncs = Object.keys(globalThis).filter(k => typeof globalThis[k] === 'function' && !k.startsWith('_'));
// Also check local scope via eval trick — use the last defined function name from code
const _fnMatch = \`${userCode.replace(/`/g, '\\`')}\`.match(/function\\s+(\\w+)\\s*\\(/g);
let _result;
if (_fnMatch) {
  const _fnName = _fnMatch[_fnMatch.length - 1].replace('function ', '').replace(/\\s*\\(.*/, '');
  try {
    _result = eval(_fnName + '(..._args)');
  } catch(e) {
    _result = 'ERROR: ' + e.message;
  }
} else {
  _result = 'ERROR: No function found';
}
console.log(JSON.stringify(_result));
`;
      }

      // ── Java ─────────────────────────────────────────────────────────────────
      case 'java': {
        // Build argument parsing for each input line
        const argParsers = inputLines.map((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('[')) {
            return `        // arg${i}: array from "${trimmed}"
        int[] arg${i} = parseIntArray("${trimmed.replace(/"/g, '\\"')}");`;
          }
          return `        int arg${i} = Integer.parseInt("${trimmed}");`;
        }).join('\n');

        const argList = inputLines.map((_, i) => `arg${i}`).join(', ');

        return `import java.util.*;

${userCode}

public class Main {
    static int[] parseIntArray(String s) {
        s = s.trim().replaceAll("[\\\\[\\\\]]", "");
        if (s.isEmpty()) return new int[0];
        String[] parts = s.split(",");
        int[] arr = new int[parts.length];
        for (int i = 0; i < parts.length; i++) arr[i] = Integer.parseInt(parts[i].trim());
        return arr;
    }

    public static void main(String[] args) {
        Solution sol = new Solution();
${argParsers}
        Object result = sol.twoSum(${argList});
        System.out.println(Arrays.toString((int[]) result).replace(", ", ",").replace(" ", ""));
    }
}`;
      }

      // ── C++ ──────────────────────────────────────────────────────────────────
      case 'cpp': {
        const argParsers = inputLines.map((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('[')) {
            return `    // parse array arg${i}
    vector<int> arg${i};
    {
        string s = "${trimmed.replace(/"/g, '\\"')}";
        s.erase(remove(s.begin(), s.end(), '['), s.end());
        s.erase(remove(s.begin(), s.end(), ']'), s.end());
        stringstream ss(s);
        string token;
        while(getline(ss, token, ',')) arg${i}.push_back(stoi(token));
    }`;
          }
          return `    int arg${i} = ${trimmed};`;
        }).join('\n');

        const argList = inputLines.map((_, i) => `arg${i}`).join(', ');

        return `#include <bits/stdc++.h>
using namespace std;

${userCode}

int main() {
    Solution sol;
${argParsers}
    auto result = sol.twoSum(${argList});
    cout << "[";
    for (int i = 0; i < (int)result.size(); i++) {
        if (i) cout << ",";
        cout << result[i];
    }
    cout << "]" << endl;
    return 0;
}`;
      }

      // ── C# ───────────────────────────────────────────────────────────────────
      case 'csharp': {
        const argParsers = inputLines.map((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('[')) {
            return `        int[] arg${i} = "${trimmed.replace(/"/g, '\\"')}".Trim('[',']').Split(',').Select(int.Parse).ToArray();`;
          }
          return `        int arg${i} = int.Parse("${trimmed}");`;
        }).join('\n');

        const argList = inputLines.map((_, i) => `arg${i}`).join(', ');

        return `using System;
using System.Linq;

${userCode}

class Program {
    static void Main() {
${argParsers}
        var sol = new Solution();
        var result = sol.TwoSum(${argList});
        Console.WriteLine("[" + string.Join(",", result) + "]");
    }
}`;
      }

      // ── Go ───────────────────────────────────────────────────────────────────
      case 'go': {
        return `package main

import (
    "encoding/json"
    "fmt"
    "strconv"
    "strings"
)

${userCode}

func parseIntSlice(s string) []int {
    s = strings.Trim(s, "[] ")
    parts := strings.Split(s, ",")
    result := make([]int, 0, len(parts))
    for _, p := range parts {
        n, _ := strconv.Atoi(strings.TrimSpace(p))
        result = append(result, n)
    }
    return result
}

func main() {
    inputLines := ${JSON.stringify(inputLines)}
    _ = inputLines
    nums := parseIntSlice(inputLines[0])
    target, _ := strconv.Atoi(strings.TrimSpace(inputLines[1]))
    result := twoSum(nums, target)
    out, _ := json.Marshal(result)
    fmt.Println(string(out))
}`;
      }

      // ── Ruby ─────────────────────────────────────────────────────────────────
      case 'ruby': {
        const inputLinesJson = JSON.stringify(inputLines);
        return `require 'json'

${userCode}

_lines = ${inputLinesJson}
_args = _lines.map { |l| begin; JSON.parse(l); rescue; l; end }
_result = method(:solution).call(*_args)
puts JSON.generate(_result)
`;
      }

      // ── Rust ─────────────────────────────────────────────────────────────────
      case 'rust': {
        return `use std::str::FromStr;

${userCode}

fn parse_int_vec(s: &str) -> Vec<i32> {
    let s = s.trim().trim_matches(|c| c == '[' || c == ']');
    s.split(',').filter_map(|x| i32::from_str(x.trim()).ok()).collect()
}

fn main() {
    let lines: Vec<&str> = vec![${inputLines.map(l => `"${l.replace(/"/g, '\\"')}"`).join(', ')}];
    let nums = parse_int_vec(lines[0]);
    let target: i32 = lines[1].trim().parse().unwrap();
    let result = two_sum(nums, target);
    let out: Vec<String> = result.iter().map(|x| x.to_string()).collect();
    println!("[{}]", out.join(","));
}`;
      }

      default:
        // Fallback — just append a generic call
        return `${userCode}\n\nprint(solution(${inputLines.join(', ')}))`;
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
