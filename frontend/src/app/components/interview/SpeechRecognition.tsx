import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../Card';
import { useSocket } from '../../hooks/useSocket';

interface SpeechRecognitionProps {
  isListening: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onAnalysis?: (analysis: any) => void;
  interviewId?: string;
  enableRealTimeAnalysis?: boolean;
  className?: string;
}

export function SpeechRecognition({
  isListening,
  onStartListening,
  onStopListening,
  onTranscript,
  onSpeechStart,
  onSpeechEnd,
  onAnalysis,
  interviewId,
  enableRealTimeAnalysis = false,
  className,
}: SpeechRecognitionProps) {
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationRef = useRef<number | null>(null);

  // Socket for real-time analysis
  const { sendAudioChunk, on, off } = useSocket({ autoConnect: enableRealTimeAnalysis });

  // Listen for audio analysis results
  useEffect(() => {
    if (!enableRealTimeAnalysis) return;

    const handleAnalysis = (data: any) => {
      onAnalysis?.(data);
    };

    on('audio-analysis', handleAnalysis);

    return () => {
      off('audio-analysis', handleAnalysis);
    };
  }, [enableRealTimeAnalysis, on, off, onAnalysis]);

  useEffect(() => {
    // Check if speech recognition is supported
    const SpeechRecognition = 
      (window as any).SpeechRecognition || 
      (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      setIsSupported(true);
      initializeSpeechRecognition(SpeechRecognition);
    } else {
      // Continue without speech recognition
      setIsSupported(false);
    }

    return () => {
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (isListening) {
      startListening();
    } else {
      stopListening();
    }
  }, [isListening]);

  const initializeSpeechRecognition = (SpeechRecognition: any) => {
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setError(null);
      onSpeechStart?.();
      initializeAudioAnalyzer();
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        setTranscript(prev => prev + finalTranscript);
        onTranscript(finalTranscript, true);
        
        // Send for real-time analysis
        if (enableRealTimeAnalysis && interviewId) {
          sendAudioChunk({
            interviewId,
            audioData: new ArrayBuffer(0), // Placeholder
            timestamp: Date.now(),
          });
        }
      }

      setInterimTranscript(interimTranscript);
      if (interimTranscript) {
        onTranscript(interimTranscript, false);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setError(`Speech recognition error: ${event.error}`);
      onStopListening();
    };

    recognition.onend = () => {
      onSpeechEnd?.();
      cleanup();
    };

    recognitionRef.current = recognition;
  };

  const initializeAudioAnalyzer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      microphoneRef.current = audioContextRef.current.createMediaStreamSource(stream);
      
      microphoneRef.current.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;
      
      updateVolume();
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const updateVolume = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    analyserRef.current.getByteFrequencyData(dataArray);
    
    const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
    setVolume(average / 255);
    
    animationRef.current = requestAnimationFrame(updateVolume);
  };

  const startListening = () => {
    if (recognitionRef.current && isSupported) {
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error('Error starting speech recognition:', err);
      }
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    cleanup();
  };

  const cleanup = () => {
    console.log('=== CLEANING UP SPEECH RECOGNITION ===');
    
    try {
      // Cancel animation frame
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      
      // Disconnect microphone source
      if (microphoneRef.current) {
        try {
          microphoneRef.current.disconnect();
          microphoneRef.current = null;
        } catch (err) {
          console.error('Error disconnecting microphone:', err);
        }
      }
      
      // Close AudioContext with safeguard
      if (audioContextRef.current) {
        const state = audioContextRef.current.state;
        console.log('AudioContext state:', state);
        
        if (state !== 'closed') {
          console.log('Closing AudioContext...');
          audioContextRef.current.close()
            .then(() => {
              console.log('✅ AudioContext closed successfully');
              audioContextRef.current = null;
            })
            .catch((err) => {
              console.error('Error closing AudioContext:', err);
              audioContextRef.current = null;
            });
        } else {
          console.log('AudioContext already closed');
          audioContextRef.current = null;
        }
      }
      
      console.log('✅ Speech recognition cleanup complete');
    } catch (err) {
      console.error('Error during speech recognition cleanup:', err);
    }
  };

  const clearTranscript = () => {
    setTranscript('');
    setInterimTranscript('');
  };

  if (!isSupported) {
    return (
      <Card className={`p-4 ${className}`}>
        <div className="p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Speech Recognition</h3>
        </div>
        <div className="p-4 text-center text-yellow-600">
          Speech recognition not available. You can type your answer below.
        </div>
      </Card>
    );
  }

  return (
    <div className={className}>
      <Card>
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Speech Recognition</h3>
            <div className="flex items-center gap-2">
              {/* Volume indicator */}
              <div className="flex items-center gap-1">
                {volume > 0.1 ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-green-500 transition-all duration-100"
                    style={{ width: `${volume * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Transcript display */}
        <div className="p-4 min-h-[200px] max-h-[400px] overflow-y-auto">
          {error ? (
            <div className="text-red-500 text-center">{error}</div>
          ) : (
            <div className="space-y-2">
              {transcript && (
                <div className="text-gray-900">
                  {transcript}
                </div>
              )}
              {interimTranscript && (
                <div className="text-gray-500 italic">
                  {interimTranscript}
                </div>
              )}
              {!transcript && !interimTranscript && !isListening && (
                <div className="text-gray-400 text-center">
                  Click the microphone to start speaking
                </div>
              )}
              {isListening && !transcript && !interimTranscript && (
                <div className="text-gray-400 text-center">
                  Listening... Start speaking
                </div>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="p-4 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              onClick={isListening ? onStopListening : onStartListening}
              variant={isListening ? "destructive" : "primary"}
              size="sm"
            >
              {isListening ? (
                <>
                  <MicOff className="w-4 h-4 mr-2" />
                  Stop
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 mr-2" />
                  Start
                </>
              )}
            </Button>

            {/* Status indicator */}
            {isListening && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Listening...
              </div>
            )}
          </div>

          <Button
            onClick={clearTranscript}
            variant="outline"
            size="sm"
            disabled={!transcript}
          >
            Clear
          </Button>
        </div>
      </Card>

      {/* Real-time feedback */}
      {isListening && (
        <div className="mt-2 text-xs text-gray-500 text-center">
          Volume: {Math.round(volume * 100)}% | 
          Words: {transcript.split(' ').filter(word => word.length > 0).length}
        </div>
      )}
    </div>
  );
}