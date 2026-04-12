import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { Play, Lightbulb, Clock, CheckCircle, Code, Terminal, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { apiService } from '../services/api';
import { useInterviewStore } from '../stores/interviewStore';
import toast from 'react-hot-toast';

const CODE_TEMPLATES: Record<string, string> = {
  javascript: `function solution(input) {
  // Write your solution here
  
  return result;
}`,
  python: `def solution(input):
    # Write your solution here
    
    return result`,
  java: `class Solution {
    public Object solution(Object input) {
        // Write your solution here
        
        return result;
    }
}`,
  cpp: `class Solution {
public:
    auto solution(auto input) {
        // Write your solution here
        
        return result;
    }
};`,
  typescript: `function solution(input: any): any {
  // Write your solution here
  
  return result;
}`,
  c: `#include <stdio.h>

int solution(int input) {
    // Write your solution here
    
    return result;
}`,
  csharp: `using System;

class Solution {
    public object Solution(object input) {
        // Write your solution here
        
        return result;
    }
}`,
};

export function CodingInterviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const interviewId = searchParams.get('id');
  
  const { currentInterview, currentQuestion, getNextQuestion, submitResponse, endInterview } = useInterviewStore();
  
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState(CODE_TEMPLATES.javascript);
  const [output, setOutput] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [testsPassed, setTestsPassed] = useState(0);
  const [totalTests, setTotalTests] = useState(0);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [questionIndex, setQuestionIndex] = useState(0);

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeElapsed(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Load interview and first question
  useEffect(() => {
    if (!interviewId) {
      toast.error('No interview ID provided');
      navigate('/interview-setup');
      return;
    }

    loadQuestion();
  }, [interviewId]);

  const loadQuestion = async () => {
    setLoading(true);
    try {
      await getNextQuestion();
      setLoading(false);
    } catch (error) {
      console.error('Failed to load question:', error);
      toast.error('Failed to load question');
      setLoading(false);
    }
  };

  const handleLanguageChange = (newLanguage: string) => {
    setLanguage(newLanguage);
    setCode(CODE_TEMPLATES[newLanguage as keyof typeof CODE_TEMPLATES] || CODE_TEMPLATES.javascript);
  };

  const handleRunCode = async () => {
    if (!currentQuestion) {
      toast.error('No question loaded');
      return;
    }

    setOutput('Running tests...\n');
    setIsExecuting(true);
    setExecutionTime(null);

    try {
      // Parse test cases from question
      const testCases = (currentQuestion as any).testCases || [
        { input: 'test input', expectedOutput: 'test output' }
      ];

      const response = await apiService.post('/code/execute-tests', {
        language,
        code,
        testCases,
      });
      console.log("language: ", language);
      console.log("code: ", code);
      console.log("testcaase: ", testCases);
      console.log("Response:", response)

      if (response.success && response.data) {
        const data = response.data as any;
        const { testResults, executionTime: execTime } = data;
        
        setExecutionTime(execTime);
        setTotalTests(testResults.length);
        
        let outputText = '';
        let passed = 0;

        testResults.forEach((result: any, index: number) => {
          const status = result.passed ? '✓' : '✗';
          const statusText = result.passed ? 'Passed' : 'Failed';
          
          outputText += `Test Case ${index + 1}: ${status} ${statusText}\n`;
          outputText += `Input: ${result.input}\n`;
          outputText += `Expected: ${result.expectedOutput}\n`;
          outputText += `Got: ${result.actualOutput}\n`;
          
          if (result.executionTime) {
            outputText += `Time: ${result.executionTime}ms\n`;
          }
          
          outputText += '\n';
          
          if (result.passed) passed++;
        });

        setTestsPassed(passed);
        outputText += `${passed}/${testResults.length} tests passed\n`;
        
        if (passed === testResults.length) {
          outputText += '\n✓ All tests passed! Great work!';
          toast.success('All tests passed!');
        } else {
          outputText += '\n⚠ Some tests failed. Keep trying!';
          toast.error('Some tests failed');
        }

        setOutput(outputText);
      } else {
        setOutput(`Error: ${response.error || 'Code execution failed'}`);
        toast.error('Code execution failed');
      }
    } catch (error: any) {
      console.error('Code execution error:', error);
      setOutput(`Error: ${error.message || 'Failed to execute code'}`);
      toast.error('Failed to execute code');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleSubmit = async () => {
    if (!currentQuestion || !interviewId) {
      toast.error('Cannot submit: No question or interview ID');
      return;
    }

    try {
      // Submit the code solution
      await submitResponse({
        questionId: currentQuestion.id,
        answer: code,
        codeSubmission: {
          language,
          code,
          testResults: [],
        },
        duration: timeElapsed,
      });

      toast.success('Solution submitted!');

      // Check if there are more questions
      const interview = currentInterview || await apiService.get(`/interview/${interviewId}`).then(r => r.data);
      const interviewData = interview as any;
      const totalQuestions = interviewData?.questions?.length || 0;
      const answeredQuestions = interviewData?.responses?.length || 0;

      if (answeredQuestions + 1 < totalQuestions) {
        // Load next question
        setQuestionIndex(prev => prev + 1);
        setCode(CODE_TEMPLATES[language]);
        setOutput('');
        setTestsPassed(0);
        setTotalTests(0);
        await loadQuestion();
      } else {
        // End interview and go to feedback
        await endInterview();
        const interviewData = interview as any;
        const finalInterviewId = interviewData?._id || interviewData?.id || interviewId;
        navigate(`/feedback/${finalInterviewId}`);
      }
    } catch (error: any) {
      console.error('Submit error:', error);
      toast.error('Failed to submit solution');
    }
  };

  if (loading || !currentQuestion) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading coding challenge...</p>
        </div>
      </div>
    );
  }

  // Parse question data
  const problem = {
    title: currentQuestion.text || 'Coding Challenge',
    difficulty: currentQuestion.difficulty || 'Medium',
    description: (currentQuestion as any).description || currentQuestion.text,
    examples: (currentQuestion as any).examples || [],
    constraints: (currentQuestion as any).constraints || [],
    hints: currentQuestion.followUpQuestions || [],
    testCases: (currentQuestion as any).testCases || [],
  };

  return (
    <div className="min-h-screen py-20 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Top Bar - Mobile Responsive */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <div className="px-3 sm:px-4 py-2 bg-secondary rounded-lg flex items-center gap-2">
              <Clock className="w-4 sm:w-5 h-4 sm:h-5 text-primary" />
              <span className="text-sm sm:text-base">{formatTime(timeElapsed)}</span>
            </div>
            {totalTests > 0 && (
              <div className={`px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 ${
                testsPassed === totalTests 
                  ? 'bg-green-500/20 border-2 border-green-500' 
                  : 'bg-yellow-500/20 border-2 border-yellow-500'
              }`}>
                <CheckCircle className={`w-4 sm:w-5 h-4 sm:h-5 ${testsPassed === totalTests ? 'text-green-400' : 'text-yellow-400'}`} />
                <span className={`text-sm sm:text-base ${testsPassed === totalTests ? 'text-green-400' : 'text-yellow-400'}`}>
                  {testsPassed}/{totalTests} Tests
                </span>
              </div>
            )}
            <div className="px-3 sm:px-4 py-2 bg-secondary rounded-lg">
              <span className="text-sm sm:text-base text-muted-foreground">Q {questionIndex + 1}</span>
            </div>
          </div>
          <Button variant="default" onClick={handleSubmit} className="w-full sm:w-auto bg-gradient-to-r from-primary to-purple-600 hover:opacity-90">
            Submit & Next
            <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          {/* Left Panel - Problem Description - Mobile Responsive */}
          <div className="space-y-4 lg:space-y-6">
            <Card className="p-4 sm:p-6 bg-card border border-border rounded-lg shadow-lg">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0 mb-4">
                <h1 className="text-xl sm:text-2xl gradient-text">{problem.title}</h1>
                <span className={`px-3 py-1 rounded-full text-sm ${
                  problem.difficulty === 'easy' || problem.difficulty === 'Easy' ? 'bg-green-500/20 text-green-400' :
                  problem.difficulty === 'medium' || problem.difficulty === 'Medium' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                  {problem.difficulty}
                </span>
              </div>

              <div className="space-y-3 sm:space-y-4">
                <div>
                  <h3 className="text-base sm:text-lg mb-2">Description</h3>
                  <p className="text-sm sm:text-base text-muted-foreground whitespace-pre-wrap">{problem.description}</p>
                </div>

                {problem.examples && problem.examples.length > 0 && (
                  <div>
                    <h3 className="text-base sm:text-lg mb-2">Examples</h3>
                    <div className="space-y-2 sm:space-y-3">
                      {problem.examples.map((example: any, index: number) => (
                        <div key={index} className="bg-secondary rounded-lg p-4">
                          <p className="text-sm mb-1">
                            <span className="text-muted-foreground">Input:</span> {example.input}
                          </p>
                          <p className="text-sm mb-1">
                            <span className="text-muted-foreground">Output:</span> {example.output}
                          </p>
                          {example.explanation && (
                            <p className="text-sm text-muted-foreground mt-2">
                              Explanation: {example.explanation}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {problem.constraints && problem.constraints.length > 0 && (
                  <div>
                    <h3 className="text-base sm:text-lg mb-2">Constraints</h3>
                    <ul className="space-y-1">
                      {problem.constraints.map((constraint: string, index: number) => (
                        <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                          <div className="w-1.5 h-1.5 bg-primary rounded-full mt-1.5 shrink-0"></div>
                          {constraint}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>

            {/* AI Hints */}
            {problem.hints && problem.hints.length > 0 && (
              <Card className='p-6'>
                <button
                  onClick={() => setShowHint(!showHint)}
                  className="flex items-center justify-between w-full"
                >
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 sm:w-5 h-4 sm:h-5 text-yellow-400" />
                    <h3 className="text-base sm:text-lg">AI Hints</h3>
                  </div>
                  <span className="text-xs sm:text-sm text-muted-foreground">
                    {showHint ? 'Hide' : 'Show'} hints
                  </span>
                </button>
                
                {showHint && (
                  <div className="mt-4 space-y-2">
                    {problem.hints.map((hint: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <div className="w-6 h-6 bg-yellow-500/20 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-yellow-400 text-xs">{index + 1}</span>
                        </div>
                        <p>{hint}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>

          {/* Right Panel - Code Editor - Mobile Responsive */}
          <div className="space-y-4 lg:space-y-6">
            <Card className="p-4 sm:p-6 bg-card border border-border rounded-lg shadow-lg">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-4">
                <div className="flex items-center gap-2">
                  <Code className="w-4 sm:w-5 h-4 sm:h-5 text-primary" />
                  <h3 className="text-base sm:text-lg">Code Editor</h3>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <select 
                    className="px-3 py-1.5 bg-secondary border border-border rounded-lg text-sm w-full sm:w-auto"
                    value={language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                  >
                    <option value="javascript">JavaScript</option>
                    <option value="typescript">TypeScript</option>
                    <option value="python">Python</option>
                    <option value="java">Java</option>
                    <option value="cpp">C++</option>
                    <option value="c">C</option>
                    <option value="csharp">C#</option>
                  </select>
                </div>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <Editor
                  height="300px"
                  language={language}
                  value={code}
                  onChange={(value) => setCode(value || '')}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    automaticLayout: true,
                  }}
                  className="sm:h-[400px]"
                />
              </div>

              <Button variant="default" onClick={handleRunCode} className="w-full mt-4 bg-gradient-to-r from-primary to-purple-600 hover:opacity-90" disabled={isExecuting}>
                {isExecuting ? (
                  <>
                    <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                    Executing...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 w-4 h-4" />
                    Run Code
                  </>
                )}
              </Button>
              
              {executionTime !== null && (
                <div className="mt-2 text-xs text-center text-muted-foreground">
                  Execution time: {executionTime}ms
                </div>
              )}
            </Card>

            {/* Output Console - Mobile Responsive */}
            <Card className='p-6'>
              <div className="flex items-center gap-2 mb-4">
                <Terminal className="w-4 sm:w-5 h-4 sm:h-5 text-primary" />
                <h3 className="text-base sm:text-lg">Output</h3>
              </div>
              <div className="bg-[#1e1e1e] rounded-lg p-3 sm:p-4 h-48 sm:h-64 overflow-y-auto font-mono text-xs sm:text-sm">
                {output || (
                  <p className="text-gray-500">Click "Run Code" to see output...</p>
                )}
                <pre className="text-gray-300 whitespace-pre-wrap">{output}</pre>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
