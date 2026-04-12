import { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, CameraOff, Mic, MicOff, Settings, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../Card';
import { useSocket } from '../../hooks/useSocket';

interface VideoRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onVideoData?: (data: Blob) => void;
  onAudioData?: (data: Blob) => void;
  onAnalysis?: (analysis: any) => void;
  interviewId?: string;
  enableRealTimeAnalysis?: boolean;
  className?: string;
}

export function VideoRecorder({
  isRecording,
  onStartRecording,
  onStopRecording,
  onVideoData,
  onAudioData,
  onAnalysis,
  interviewId,
  enableRealTimeAnalysis = false,
  className,
}: VideoRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cleanupCalledRef = useRef(false);
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const [hasVideo, setHasVideo] = useState(true);
  const [hasAudio, setHasAudio] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // Socket for real-time analysis
  const { sendVideoFrame, on, off } = useSocket({ autoConnect: enableRealTimeAnalysis });

  // Listen for video analysis results
  useEffect(() => {
    if (!enableRealTimeAnalysis) return;

    const handleAnalysis = (data: any) => {
      onAnalysis?.(data);
    };

    on('video-analysis', handleAnalysis);

    return () => {
      off('video-analysis', handleAnalysis);
    };
  }, [enableRealTimeAnalysis, on, off, onAnalysis]);

  // Send video frames for analysis
  useEffect(() => {
    if (!enableRealTimeAnalysis || !isRecording || !interviewId || !videoRef.current) {
      return;
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    const sendFrame = () => {
      if (!videoRef.current || !context) return;

      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      // Convert to base64
      const frameData = canvas.toDataURL('image/jpeg', 0.8);

      // Send to server via socket
      sendVideoFrame({
        interviewId,
        frameData,
        timestamp: Date.now(),
      });
    };

    // Send frame every 2 seconds
    analysisIntervalRef.current = setInterval(sendFrame, 2000);

    return () => {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = null;
      }
    };
  }, [enableRealTimeAnalysis, isRecording, interviewId, sendVideoFrame]);

  // Cleanup function with safeguards
  const cleanup = useCallback(() => {
    if (cleanupCalledRef.current) {
      console.log('Cleanup already called, skipping...');
      return;
    }
    
    cleanupCalledRef.current = true;
    console.log('=== CLEANING UP MEDIA RESOURCES ===');
    
    try {
      // Stop media recorder first
      if (mediaRecorderRef.current) {
        const state = mediaRecorderRef.current.state;
        console.log('MediaRecorder state:', state);
        
        if (state === 'recording' || state === 'paused') {
          console.log('Stopping media recorder...');
          mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
      }
      
      // Stop all media tracks
      if (streamRef.current) {
        console.log('Stopping media stream tracks...');
        const tracks = streamRef.current.getTracks();
        tracks.forEach((track, index) => {
          console.log(`Stopping track ${index}: ${track.kind} (${track.label})`);
          try {
            track.stop();
          } catch (err) {
            console.error(`Error stopping track ${index}:`, err);
          }
        });
        streamRef.current = null;
      }
      
      // Clear video element
      if (videoRef.current) {
        console.log('Clearing video element...');
        videoRef.current.srcObject = null;
        videoRef.current.load(); // Reset video element
      }
      
      console.log('✅ Media cleanup complete');
    } catch (err) {
      console.error('Error during cleanup:', err);
    } finally {
      // Reset cleanup flag after a delay to allow re-initialization
      setTimeout(() => {
        cleanupCalledRef.current = false;
      }, 100);
    }
  }, []);

  useEffect(() => {
    initializeMedia();
    
    return () => {
      console.log('Component unmounting, cleaning up...');
      cleanup();
    };
  }, [cleanup]);

  const initializeMedia = async () => {
    try {
      setError(null);
      setIsRetrying(false);
      
      console.log('=== INITIALIZING MEDIA DEVICES ===');
      
      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('UNSUPPORTED_BROWSER');
      }

      // Check for existing permissions
      try {
        const permissions = await navigator.permissions.query({ name: 'camera' as PermissionName });
        console.log('Camera permission status:', permissions.state);
        
        if (permissions.state === 'denied') {
          throw new Error('PERMISSION_DENIED');
        }
      } catch (permError) {
        console.log('Permission API not available, proceeding...');
      }

      // Check if camera is already in use by checking existing tracks
      const existingTracks = streamRef.current?.getTracks() || [];
      if (existingTracks.length > 0) {
        console.log('Existing tracks found, cleaning up first...');
        cleanup();
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for cleanup
      }

      console.log('Requesting camera and microphone access...');
      
      // Try with high-quality settings first
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 60 },
            facingMode: 'user'
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (highQualityError: any) {
        console.warn('High-quality settings failed, trying basic settings...', highQualityError.name);
        
        // Fallback to basic settings
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      }

      console.log('✅ Media stream obtained successfully');
      console.log('Video tracks:', stream.getVideoTracks().length);
      console.log('Audio tracks:', stream.getAudioTracks().length);
      
      streamRef.current = stream;
      
      // Set up video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Wait for video to be ready
        await new Promise((resolve, reject) => {
          if (!videoRef.current) {
            reject(new Error('Video element not found'));
            return;
          }
          
          videoRef.current.onloadedmetadata = () => {
            console.log('Video metadata loaded');
            resolve(true);
          };
          
          videoRef.current.onerror = (err) => {
            console.error('Video element error:', err);
            reject(err);
          };
          
          // Timeout after 5 seconds
          setTimeout(() => reject(new Error('Video load timeout')), 5000);
        });
        
        // Play video
        try {
          await videoRef.current.play();
          console.log('✅ Video playback started');
        } catch (playErr) {
          console.warn('Video autoplay failed (may need user interaction):', playErr);
        }
      }

      setIsInitialized(true);
      setError(null);
      console.log('✅ Camera initialized successfully');
      
    } catch (err: any) {
      console.error('=== MEDIA INITIALIZATION ERROR ===');
      console.error('Error name:', err.name);
      console.error('Error message:', err.message);
      console.error('Error stack:', err.stack);
      
      // Clean up any partial initialization
      cleanup();
      
      // Set user-friendly error message
      let errorMessage = 'Camera not available';
      let errorCode = err.name || err.message;
      
      if (errorCode === 'UNSUPPORTED_BROWSER') {
        errorMessage = 'Camera not available in this browser. Please use Chrome, Firefox, or Edge.';
      } else if (errorCode === 'PERMISSION_DENIED' || err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Camera permission denied. Please click "Allow" when prompted, or enable camera in browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'No camera found. Please connect a camera and click "Retry".';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage = 'Camera is already in use by another application. Please close other apps (Zoom, Teams, Skype, etc.) and click "Retry".';
      } else if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
        errorMessage = 'Camera does not support the requested settings. Click "Retry" to use basic settings.';
      } else if (err.name === 'AbortError') {
        errorMessage = 'Camera access was aborted. Please click "Retry".';
      } else if (err.name === 'SecurityError') {
        errorMessage = 'Camera access blocked by security policy. Please use HTTPS or localhost.';
      } else if (err.message === 'Video load timeout') {
        errorMessage = 'Camera took too long to initialize. Please click "Retry".';
      }
      
      setIsInitialized(true);
      setError(errorMessage);
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    setError(null);
    setIsInitialized(false);
    
    // Clean up first
    cleanup();
    
    // Wait a bit before retrying
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Retry initialization
    await initializeMedia();
    setIsRetrying(false);
  };

  const startRecording = () => {
    if (!streamRef.current) {
      console.error('No stream available for recording');
      setError('Cannot start recording: No camera stream');
      return;
    }

    try {
      console.log('Starting recording...');
      
      // Check supported MIME types
      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4'
      ];
      
      let selectedMimeType = '';
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          console.log('Using MIME type:', mimeType);
          break;
        }
      }
      
      if (!selectedMimeType) {
        throw new Error('No supported MIME type found');
      }

      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: selectedMimeType,
      });

      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
          console.log(`Recorded chunk: ${event.data.size} bytes`);
        }
      };

      mediaRecorder.onstop = () => {
        console.log('Recording stopped, creating blob...');
        const blob = new Blob(chunks, { type: selectedMimeType });
        console.log(`Final recording size: ${blob.size} bytes`);
        onVideoData?.(blob);
      };

      mediaRecorder.onerror = (event: any) => {
        console.error('MediaRecorder error:', event.error);
        setError('Recording error: ' + event.error?.message);
      };

      mediaRecorder.start(1000); // Collect data every second
      mediaRecorderRef.current = mediaRecorder;
      onStartRecording();
      
      console.log('✅ Recording started');
    } catch (err: any) {
      console.error('Error starting recording:', err);
      setError('Failed to start recording: ' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      const state = mediaRecorderRef.current.state;
      console.log('Stopping recording, current state:', state);
      
      if (state === 'recording' || state === 'paused') {
        mediaRecorderRef.current.stop();
        console.log('✅ Recording stopped');
      }
    }
    onStopRecording();
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setHasVideo(videoTrack.enabled);
        console.log('Video track enabled:', videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setHasAudio(audioTrack.enabled);
        console.log('Audio track enabled:', audioTrack.enabled);
      }
    }
  };

  if (error) {
    return (
      <Card className={`p-6 ${className}`}>
        <div className="text-center mb-4">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 rounded-full mb-3">
            <AlertTriangle className="w-8 h-8 text-yellow-600" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Camera Unavailable</h3>
          <p className="text-sm text-muted-foreground mb-4 whitespace-pre-line">{error}</p>
          <Button 
            onClick={handleRetry} 
            variant="outline"
            size="sm"
            disabled={isRetrying}
          >
            {isRetrying ? 'Retrying...' : 'Retry Camera Access'}
          </Button>
        </div>
        <div className="aspect-video bg-gray-200 rounded-lg flex items-center justify-center">
          <div className="text-center text-gray-500">
            <CameraOff className="w-16 h-16 mx-auto mb-2 text-gray-400" />
            <p className="text-sm">Interview will continue without video</p>
            <p className="text-xs text-gray-400 mt-2">Your responses will still be recorded</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <Card className="overflow-hidden">
        <div className="relative aspect-video bg-gray-900">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          
          {/* Recording indicator */}
          {isRecording && (
            <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1 bg-red-500 text-white rounded-full text-sm font-medium shadow-lg">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              REC
            </div>
          )}

          {/* Status indicators */}
          <div className="absolute top-4 right-4 flex gap-2">
            {!hasVideo && (
              <div className="p-2 bg-red-500 text-white rounded-full shadow-lg">
                <CameraOff className="w-4 h-4" />
              </div>
            )}
            {!hasAudio && (
              <div className="p-2 bg-red-500 text-white rounded-full shadow-lg">
                <MicOff className="w-4 h-4" />
              </div>
            )}
          </div>

          {/* Controls overlay */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-3">
            <Button
              variant={hasVideo ? "outline" : "destructive"}
              size="sm"
              onClick={toggleVideo}
              className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
              disabled={!isInitialized}
            >
              {hasVideo ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
            </Button>

            <Button
              variant={hasAudio ? "outline" : "destructive"}
              size="sm"
              onClick={toggleAudio}
              className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
              disabled={!isInitialized}
            >
              {hasAudio ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
              disabled={!isInitialized}
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Recording controls */}
        <div className="p-4 bg-gray-50 flex justify-center">
          {!isRecording ? (
            <Button
              onClick={startRecording}
              disabled={!isInitialized}
              variant="primary"
              className="px-8"
            >
              Start Recording
            </Button>
          ) : (
            <Button
              onClick={stopRecording}
              variant="destructive"
              className="px-8"
            >
              Stop Recording
            </Button>
          )}
        </div>
      </Card>

      {/* Technical info */}
      {isInitialized && (
        <div className="mt-2 text-xs text-gray-500 text-center">
          Video: {hasVideo ? 'On' : 'Off'} | Audio: {hasAudio ? 'On' : 'Off'}
          {isRecording && ' | Recording...'}
        </div>
      )}
    </div>
  );
}