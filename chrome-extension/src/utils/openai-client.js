/**
 * OpenAI Voice Assistant Client - GPT-4o-mini-audio-preview version
 * Supports audio ID reference mechanism to avoid duplicate audio data transmission
 * Significantly optimizes transmission efficiency for multi-turn conversations
 */
class OpenAIVoiceAssistant {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://api.openai.com/v1';

        // Multi-video conversation history management
        this.videoConversations = new Map(); // videoId -> conversation history
        this.currentVideoId = null;
        this.maxHistoryLength = 20; // Maximum 20 conversation records per video
        this.maxVideoCount = 10; // Maximum cache for 5 videos' conversation history

        // Audio ID cache management
        this.audioCache = new Map(); // audioId -> { data, transcript, expiresAt }
        this.cleanupInterval = null;

        // Listen for page unload to clean up all conversation history
        this.setupCleanupListener();
        this.startAudioCacheCleanup();
    }

    /**
     * Start automatic audio cache cleanup
     */
    startAudioCacheCleanup() {
        // Clean up expired audio cache every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredAudioCache();
        }, 5 * 60 * 1000);
    }

    /**
     * Clean up expired audio cache
     */
    cleanupExpiredAudioCache() {
        const now = Math.floor(Date.now() / 1000);
        let cleanedCount = 0;
        
        for (const [audioId, audioData] of this.audioCache) {
            if (audioData.expiresAt && audioData.expiresAt < now) {
                this.audioCache.delete(audioId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            Logger.log(`Audio: Cleaned up ${cleanedCount} expired audio cache entries`);
        }
    }

    /**
     * Set up cleanup listener for page unload
     */
    setupCleanupListener() {
        window.addEventListener('beforeunload', () => {
            this.clearAllConversations();
            this.clearAllCaches();
        });
    }

    /**
     * Clear all caches
     */
    clearAllCaches() {
        this.audioCache.clear();
        
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        Logger.log('Audio: Cleared all audio cache');
    }

    /**
     * Switch to specified video's conversation context
     */
    switchToVideo(videoId) {
        if (!videoId) {
            Logger.warn('OpenAI: videoId is empty, cannot switch conversation context');
            return;
        }

        const previousVideoId = this.currentVideoId;
        this.currentVideoId = videoId;

        // If it's a new video, initialize conversation history
        if (!this.videoConversations.has(videoId)) {
            this.videoConversations.set(videoId, []);
            Logger.log('OpenAI: Created conversation history for new video:', videoId);
        } else {
            Logger.log('OpenAI: Switched to existing video conversation history:', videoId);
            const history = this.videoConversations.get(videoId);
            Logger.log(`OpenAI: Restored ${history.length} conversation records`);
        }

        // Limit the number of cached videos
        if (this.videoConversations.size > this.maxVideoCount) {
            this.cleanupOldConversations();
        }

        if (previousVideoId !== videoId) {
            Logger.log(`OpenAI: Switched from video ${previousVideoId} to ${videoId}`);
        }
    }

    /**
     * Clean up oldest conversation history (LRU strategy)
     */
    cleanupOldConversations() {
        const videoIds = Array.from(this.videoConversations.keys());
        const oldestVideoId = videoIds[0]; // Map maintains insertion order, first is oldest
        
        this.videoConversations.delete(oldestVideoId);
        Logger.log('OpenAI: Cleaned up oldest conversation history:', oldestVideoId);
    }

    /**
     * Get current video's conversation history
     */
    getCurrentConversationHistory() {
        if (!this.currentVideoId) {
            return [];
        }
        return this.videoConversations.get(this.currentVideoId) || [];
    }

    /**
     * Add optimized conversation history (supports audio ID and dynamic context)
     */
    addOptimizedConversationHistory(role, content, audioBase64 = null, audioId = null, context = null) {
        if (!this.currentVideoId) {
            Logger.warn('Audio: No active video, cannot save conversation');
            return;
        }

        const conversation = this.getCurrentConversationHistory();
        const historyItem = {
            role: role,
            content: content,
            timestamp: Date.now()
        };
        
        // Add audio information and dynamic context for user messages
        if (role === 'user') {
            if (audioId) {
                historyItem.audioId = audioId;
            }
            if (audioBase64) {
                historyItem.audioBase64 = audioBase64;
            }
            // Save the dynamic context at that time (timestamp and relevant subtitles)
            if (context) {
                historyItem.dynamicContext = `Current video playback time: ${Math.floor(context.currentTime)} seconds

Subtitle content around current time position:
${context.relevantSubtitles || 'No relevant subtitles'}`;
            }
        }
        
        // Add audio ID for assistant messages (if available)
        if (role === 'assistant' && audioId) {
            historyItem.audioId = audioId;
        }
        
        conversation.push(historyItem);

        // Update Map
        this.videoConversations.delete(this.currentVideoId);
        this.videoConversations.set(this.currentVideoId, conversation);

        // Clean up overly long history
        if (conversation.length > this.maxHistoryLength) {
            for (let i = 0; i < conversation.length - 1; i++) {
                if (conversation[i].role === 'user' && 
                    conversation[i + 1].role === 'assistant') {
                    conversation.splice(i, 2);
                    Logger.log('Audio: Current video conversation history too long, removing earliest conversation round');
                    break;
                }
            }
        }
    }

    /**
     * Add message to current video's conversation history (backward compatibility)
     * @deprecated Use addOptimizedConversationHistory instead
     */
    addToConversationHistory(role, content) {
        this.addOptimizedConversationHistory(role, content, null, null, null);
    }

    /**
     * Get complete message array for API calls
     * @deprecated Recommend using getCurrentConversationHistory and manually building message array
     */
    getConversationMessages(systemMessage = null) {
        const messages = [];
        
        // Add system message (if provided)
        if (systemMessage) {
            messages.push({
                role: 'system',
                content: systemMessage
            });
        }

        // Add current video's conversation history (excluding timestamp)
        const history = this.getCurrentConversationHistory();
        history.forEach(msg => {
            messages.push({
                role: msg.role,
                content: msg.content
            });
        });

        return messages;
    }

    /**
     * Reset specified video's conversation history
     */
    resetVideoConversation(videoId = null) {
        const targetVideoId = videoId || this.currentVideoId;
        
        if (targetVideoId && this.videoConversations.has(targetVideoId)) {
            this.videoConversations.set(targetVideoId, []);
            Logger.log('OpenAI: Reset video conversation history:', targetVideoId);
        }
    }

    /**
     * Clear all conversation history (called when page unloads)
     */
    clearAllConversations() {
        this.videoConversations.clear();
        this.currentVideoId = null;
        Logger.log('OpenAI: Cleared all conversation history');
    }

    /**
     * Get conversation summary for all videos
     */
    getAllVideosSummary() {
        const summary = {};
        
        for (const [videoId, conversation] of this.videoConversations) {
            const userMessages = conversation.filter(msg => msg.role === 'user').length;
            const assistantMessages = conversation.filter(msg => msg.role === 'assistant').length;
            
            summary[videoId] = {
                totalMessages: conversation.length,
                userMessages,
                assistantMessages,
                lastActivity: conversation.length > 0 ? 
                    new Date(conversation[conversation.length - 1].timestamp).toLocaleString() : null,
                isCurrentVideo: videoId === this.currentVideoId
            };
        }
        
        return summary;
    }

    /**
     * Debug feature: Save recording and create playback interface
     */
    debugSaveRecording(audioBlob) {
        try {
            // Create blob URL for playback
            const audioUrl = URL.createObjectURL(audioBlob);
            
            // Log recording information
            Logger.log('🎵 Recording debug info (before sending to transcription API):');
            Logger.log('- File size:', (audioBlob.size / 1024).toFixed(2), 'KB');
            Logger.log('- File type:', audioBlob.type);
            Logger.log('- Playback URL:', audioUrl);
            
            // Remove previous debug player (if exists)
            const existingPlayer = document.getElementById('voice-debug-player');
            if (existingPlayer) {
                URL.revokeObjectURL(existingPlayer.audioUrl); // Release previous URL
                existingPlayer.remove();
            }
            
            // Create playback interface
            const debugContainer = document.createElement('div');
            debugContainer.id = 'voice-debug-player';
            debugContainer.audioUrl = audioUrl; // Save URL for cleanup
            debugContainer.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 12px;
                border-radius: 8px;
                z-index: 10000;
                font-family: Arial, sans-serif;
                font-size: 13px;
                max-width: 350px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                border: 1px solid #333;
            `;
            
            const timestamp = new Date().toLocaleTimeString();
            debugContainer.innerHTML = `
                <div style="margin-bottom: 8px; font-weight: bold; color: #4CAF50;">🎵 Recording Debug (Pre-transcription)</div>
                <div style="margin-bottom: 5px; color: #999;">Time: ${timestamp}</div>
                <div style="margin-bottom: 5px; color: #ccc;">Size: ${(audioBlob.size / 1024).toFixed(2)} KB</div>
                <div style="margin-bottom: 8px; color: #ccc;">Type: ${audioBlob.type}</div>
                <audio controls style="width: 100%; margin-bottom: 8px;">
                    <source src="${audioUrl}" type="${audioBlob.type}">
                    Your browser does not support audio playback
                </audio>
                <div style="text-align: center;">
                    <button id="debug-close-btn" style="background: #f44336; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-right: 8px;">Close</button>
                    <button id="debug-download-btn" style="background: #2196F3; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Download</button>
                </div>
            `;
            
            // Add to page
            document.body.appendChild(debugContainer);
            
            // Close button event
            document.getElementById('debug-close-btn').addEventListener('click', () => {
                URL.revokeObjectURL(audioUrl); // Release memory
                debugContainer.remove();
            });
            
            // Download button event
            document.getElementById('debug-download-btn').addEventListener('click', () => {
                const link = document.createElement('a');
                link.href = audioUrl;
                link.download = `recording_transcribe_${timestamp.replace(/:/g, '-')}.wav`;
                link.click();
            });
            
            // Auto cleanup after 5 minutes
            setTimeout(() => {
                if (document.getElementById('voice-debug-player')) {
                    URL.revokeObjectURL(audioUrl);
                    debugContainer.remove();
                }
            }, 5 * 60 * 1000);
            
        } catch (error) {
            Logger.error('OpenAI: Failed to create debug player:', error);
        }
    }

    /**
     * Audio transcription - using gpt-4o-mini-transcribe
     */
    async transcribeAudio(audioBlob, options = {}) {
        try {
            // Debug feature: save recording for playback
            if (Logger.isDebugMode) {
                this.debugSaveRecording(audioBlob);
            }
            
            const formData = new FormData();
            formData.append('file', audioBlob, 'audio.wav');
            formData.append('model', 'gpt-4o-mini-transcribe');
            
            // Default to text format for plain text results
            const responseFormat = options.response_format || 'text';
            formData.append('response_format', responseFormat);
            
            if (options.language) {
                formData.append('language', options.language);
            }
            if (options.temperature) {
                formData.append('temperature', options.temperature.toString());
            }
            if (options.prompt) {
                formData.append('prompt', options.prompt);
            }

            const response = await fetch(`${this.baseURL}/audio/transcriptions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Transcription API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }

            // Handle return result based on response format
            if (responseFormat === 'text') {
                return await response.text();
            } else {
                const result = await response.json();
                return result.text || result;
            }

        } catch (error) {
            Logger.error('Audio transcription failed:', error);
            throw error;
        }
    }

    /**
     * Optimized audio conversation processing - separating transcription and conversation
     */
    async optimizedAudioCompletion(audioBlob, context) {
        try {
            this.switchToVideo(context.videoId);
            
            // Step 1: First transcribe audio with gpt-4o-mini-transcribe
            Logger.log('🎤 Transcribing user voice...');
            const transcript = await this.transcribeAudio(audioBlob, {
                response_format: 'text',
                prompt: 'transcribe everything, don\'t miss any words',
                temperature: 0.0
            });
            Logger.log('📝 Transcription result:', transcript);
            
            // Step 2: Build text message array
            const messages = this.buildOptimizedTextMessages(transcript, context);
            
            const requestBody = {
                model: 'gpt-4o-mini-audio-preview',
                modalities: ['text', 'audio'],
                audio: {
                    voice: 'alloy',
                    format: 'wav'
                },
                messages: messages,
                max_completion_tokens: 1024,
                temperature: 1.0
            };

            // Output request size statistics
            const requestSize = JSON.stringify(requestBody).length;
            Logger.log(`📊 Request size: ${(requestSize / 1024).toFixed(1)}KB`);

            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Audio API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }

            const result = await response.json();
            const choice = result.choices[0];
            
            // Extract and cache audio information
            const textResponse = choice.message.content || '';
            const audioInfo = choice.message.audio;
            let audioResponse = null;
            
            if (audioInfo) {
                // Cache audio data and ID
                this.cacheAudioData(audioInfo);
                
                // Convert audio data
                audioResponse = await this.base64ToArrayBuffer(audioInfo.data);
                
                Logger.log(`🎵 Audio ID: ${audioInfo.id}, Expiry time: ${new Date(audioInfo.expires_at * 1000).toLocaleString()}`);
            }
            
            // Save conversation history (using optimized format, user messages don't save audio data)
            this.addOptimizedConversationHistory('user', transcript, null, null, context);
            this.addOptimizedConversationHistory('assistant', textResponse, null, audioInfo?.id);
            
            // Output token usage
            if (result.usage) {
                this.logTokenUsage(result.usage);
            }
            
            return {
                transcript: transcript,
                textResponse: textResponse,
                audioResponse: audioResponse
            };

        } catch (error) {
            Logger.error('Optimized audio conversation processing failed:', error);
            throw error;
        }
    }

    /**
     * Cache audio data
     */
    cacheAudioData(audioInfo) {
        if (!audioInfo || !audioInfo.id) return;
        
        this.audioCache.set(audioInfo.id, {
            data: audioInfo.data,
            transcript: audioInfo.transcript,
            expiresAt: audioInfo.expires_at,
            cachedAt: Math.floor(Date.now() / 1000)
        });
        
        Logger.log(`💾 Audio cached: ${audioInfo.id} (${this.audioCache.size} audios in cache)`);
    }

    /**
     * Play audio data
     */
    async playAudio(audioData) {
        return new Promise((resolve, reject) => {
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                audioContext.decodeAudioData(audioData)
                    .then(audioBuffer => {
                        const source = audioContext.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(audioContext.destination);
                        
                        source.onended = resolve;
                        source.start();
                    })
                    .catch(reject);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Record audio (traditional fixed-duration method, as backup)
     */
    async recordAudio(duration = 5000) {
        return new Promise(async (resolve, reject) => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        sampleRate: 16000,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true
                    } 
                });

                const mediaRecorder = new MediaRecorder(stream, {
                    mimeType: 'audio/webm;codecs=opus'
                });

                const audioChunks = [];

                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    stream.getTracks().forEach(track => track.stop());
                    resolve(audioBlob);
                };

                mediaRecorder.start();

                setTimeout(() => {
                    if (mediaRecorder.state === 'recording') {
                        mediaRecorder.stop();
                    }
                }, duration);

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Record audio using smart recorder (VAD automatic detection)
     */
    async recordAudioSmart(onStatusUpdate) {
        return new Promise(async (resolve, reject) => {
            let recorder = null;
            let timeoutId = null;
            
            try {
                recorder = new SmartVoiceRecorder();
                
                recorder.setCallbacks({
                    onSpeechStart: () => {},
                    onSpeechEnd: (audioBlob) => {
                        onStatusUpdate('Recording completed', 'processing');
                        // Clear timeout timer
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = null;
                        }
                        // VAD automatically destroys, no need to manually call destroy
                        resolve(audioBlob);
                    },
                    onStatusUpdate: onStatusUpdate
                });

                await recorder.startSmartRecording();

                // Set timeout protection (maximum 30 seconds)
                timeoutId = setTimeout(() => {
                    if (recorder && recorder.recording) {
                        Logger.log('Voice: Recording timeout, cleaning up resources...');
                        recorder.forceDestroy(); // Force release microphone on timeout
                        reject(new Error('Recording timeout, please try again'));
                    }
                }, 30000);

            } catch (error) {
                // Clear timeout timer
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                
                // Ensure recorder resources are cleaned up
                if (recorder) {
                    try {
                        recorder.forceDestroy();
                    } catch (destroyError) {
                        Logger.error('Voice: Failed to cleanup recorder:', destroyError);
                    }
                }
                
                reject(error);
            }
        });
    }

    /**
     * Build optimized text message array - supports OpenAI prefix caching
     */
    buildOptimizedTextMessages(userQuestion, context) {
        this.switchToVideo(context.videoId);
        
        // Static system message (can be cached by OpenAI)
        const staticSystemMessage = `You are a YouTube video assistant that answers questions based on video subtitle content.

Video: ${context.videoTitle || 'Unknown Title'}
Video ID: ${context.videoId}

Full Transcript:
${context.fullTranscript || 'Loading subtitles...'}

Please provide concise answers (within 30 words) since your response will be converted to speech. Focus on content relevant to the current time position. When asked to repeat what was just said in the video, provide word-by-word accurate repetition without omitting details.`;

        // Dynamic system message (current timestamp and relevant subtitles)
        const dynamicSystemMessage = `Current video playback time: ${Math.floor(context.currentTime)} seconds

Subtitle content around current time position:
${context.relevantSubtitles || 'No relevant subtitles'}`;

        const messages = [
            {
                role: 'system',
                content: staticSystemMessage // Static content, can be cached
            }
        ];
        
        // Add conversation history (insert dynamic context before each user input)
        const conversationHistory = this.getCurrentConversationHistory();
        
        conversationHistory.forEach((msg, index) => {
            if (msg.role === 'user') {
                // Insert dynamic system message before user message
                messages.push({
                    role: 'system',
                    content: msg.dynamicContext || dynamicSystemMessage // Use historical context or current one
                });
                
                // User message: now all are text messages
                messages.push({
                    role: 'user',
                    content: msg.content
                });
            } else {
                // Assistant reply: use audio ID reference (if available)
                if (msg.audioId && this.audioCache.has(msg.audioId)) {
                    Logger.log(`🔄 Referencing assistant audio ID: ${msg.audioId}`);
                    messages.push({
                        role: 'assistant',
                        content: [], // Empty content
                        audio: {
                            id: msg.audioId
                        }
                    });
                } else {
                    // Plain text reply
                    messages.push({
                        role: 'assistant',
                        content: msg.content
                    });
                }
            }
        });
        
        // Insert latest dynamic system message before current user input
        messages.push({
            role: 'system',
            content: dynamicSystemMessage
        });
        
        // Add current user text input
        messages.push({
            role: 'user',
            content: userQuestion
        });
        
        Logger.log(`📝 Message array length: ${messages.length}, Conversation history: ${conversationHistory.length}`);
        Logger.log(`💾 Static system message length: ${staticSystemMessage.length} characters (cacheable)`);
        Logger.log(`🔄 Dynamic system message length: ${dynamicSystemMessage.length} characters`);
        
        return messages;
    }

    /**
     * Build optimized message array - supports OpenAI prefix caching (audio version, deprecated)
     * @deprecated Use buildOptimizedTextMessages instead
     */
    buildOptimizedMessages(currentAudioBase64, context) {
        Logger.warn('buildOptimizedMessages (audio version) is deprecated, please use buildOptimizedTextMessages');
        return this.buildOptimizedTextMessages('Voice input', context);
    }

    /**
     * Build YouTube assistant conversation messages (backward compatibility)
     * @deprecated Use buildOptimizedMessages instead
     */
    buildYouTubeAssistantMessages(userQuestion, context) {
        Logger.warn('buildYouTubeAssistantMessages is deprecated, please use buildOptimizedMessages');
        // This method is now only for backward compatibility, won't actually be called
        return [];
    }

    /**
     * Smart voice query processing flow (separating transcription and conversation)
     */
    async processVoiceQuerySmart(context, onStatusUpdate) {
        const startTime = performance.now();
        let timings = {
            recording: 0,
            transcription: 0,
            audioCompletion: 0,
            audioPlayback: 0,
            total: 0
        };

        try {
            // onStatusUpdate('Preparing to record, please start speaking...', 'recording');
            
            // Step 1: Smart audio recording
            const recordingStart = performance.now();
            const audioBlob = await this.recordAudioSmart(onStatusUpdate);
            timings.recording = performance.now() - recordingStart;
            
            // Step 2: Voice transcription + AI conversation generation (separated processing)
            onStatusUpdate('Transcribing and generating response...', 'processing');
            const audioCompletionStart = performance.now();
            
            const result = await this.optimizedAudioCompletion(audioBlob, context);
            timings.audioCompletion = performance.now() - audioCompletionStart;
            
            Logger.log('User question:', result.transcript);
            Logger.log('AI response:', result.textResponse);
            
            // Step 3: Play response
            if (result.audioResponse) {
                onStatusUpdate('Playing response...', 'playing');
                const playbackStart = performance.now();
                await this.playAudio(result.audioResponse);
                timings.audioPlayback = performance.now() - playbackStart;
            }
            
            timings.total = performance.now() - startTime;
            
            this.logTimingStats(timings, 'Smart Voice Query (Separated)');
            onStatusUpdate(`Completed`, 'success');
            
            return {
                userQuestion: result.transcript,
                aiResponse: result.textResponse,
                audioData: result.audioResponse,
                timings: timings
            };

        } catch (error) {
            timings.total = performance.now() - startTime;
            Logger.error('Smart voice processing failed:', error);
            Logger.log('⏱️ Processing time before failure:', this.formatTimings(timings));
            
            onStatusUpdate('Error: ' + error.message, 'error');
            
            // If VAD fails, try traditional recording method
            if (error.message.includes('VAD') || error.message.includes('voice detection')) {
                Logger.log('Trying traditional recording method...');
                onStatusUpdate('Switching to traditional recording mode...', 'info');
                return await this.processVoiceQuery(context, onStatusUpdate);
            }
            
            throw error;
        }
    }

    /**
     * Traditional recording processing flow (separating transcription and conversation)
     */
    async processVoiceQuery(context, onStatusUpdate) {
        const startTime = performance.now();
        let timings = {
            recording: 0,
            transcription: 0,
            audioCompletion: 0,
            audioPlayback: 0,
            total: 0
        };

        try {
            onStatusUpdate('Starting recording...', 'recording');
            
            // Step 1: Record audio
            const recordingStart = performance.now();
            const audioBlob = await this.recordAudio(5000);
            timings.recording = performance.now() - recordingStart;
            
            // Step 2: Voice transcription + AI conversation generation (separated processing)
            onStatusUpdate('Transcribing and generating response...', 'processing');
            const audioCompletionStart = performance.now();
            
            const result = await this.optimizedAudioCompletion(audioBlob, context);
            timings.audioCompletion = performance.now() - audioCompletionStart;
            
            Logger.log('User question:', result.transcript);
            Logger.log('AI response:', result.textResponse);

            // Step 3: Play response
            if (result.audioResponse) {
                onStatusUpdate('Playing response...', 'playing');
                const playbackStart = performance.now();
                await this.playAudio(result.audioResponse);
                timings.audioPlayback = performance.now() - playbackStart;
            }
            
            timings.total = performance.now() - startTime;
            
            this.logTimingStats(timings, 'Traditional Voice Query (Separated)');
            onStatusUpdate(`Completed`, 'success');
            
            return {
                userQuestion: result.transcript,
                aiResponse: result.textResponse,
                audioData: result.audioResponse,
                timings: timings
            };

        } catch (error) {
            timings.total = performance.now() - startTime;
            Logger.error('Traditional voice processing failed:', error);
            Logger.log('⏱️ Processing time before failure:', this.formatTimings(timings));
            
            onStatusUpdate('Error: ' + error.message, 'error');
            throw error;
        }
    }

    /**
     * Get conversation history
     */
    getConversationHistory() {
        return this.getCurrentConversationHistory().map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.timestamp).toLocaleString()
        }));
    }

    /**
     * Clear conversation history
     */
    clearConversationHistory() {
        this.resetVideoConversation();
        Logger.log('OpenAI: Conversation history manually cleared');
    }

    /**
     * Get conversation summary information
     */
    getConversationSummary() {
        const userMessages = this.getCurrentConversationHistory().filter(msg => msg.role === 'user').length;
        const assistantMessages = this.getCurrentConversationHistory().filter(msg => msg.role === 'assistant').length;
        const totalMessages = this.getCurrentConversationHistory().length;
        
        return {
            totalMessages,
            userMessages,
            assistantMessages,
            currentVideoId: this.currentVideoId,
            lastActivity: totalMessages > 0 ? new Date(this.getCurrentConversationHistory()[totalMessages - 1].timestamp).toLocaleString() : null
        };
    }

    /**
     * Export conversation history (for debugging or saving)
     */
    exportConversationHistory() {
        return {
            videoId: this.currentVideoId,
            timestamp: new Date().toISOString(),
            conversation: this.getCurrentConversationHistory()
        };
    }

    /**
     * Format timing statistics
     */
    formatTimings(timings) {
        const format = (ms) => `${Math.round(ms)}ms`;
        
        return {
            recording: format(timings.recording),
            transcription: format(timings.transcription),
            chatCompletion: format(timings.chatCompletion),
            textToSpeech: format(timings.textToSpeech),
            audioPlayback: format(timings.audioPlayback),
            total: format(timings.total)
        };
    }

    /**
     * Output detailed timing statistics logs
     */
    logTimingStats(timings, operation) {
        const formatted = this.formatTimings(timings);
        
        Logger.log(`\n⏱️ ===== ${operation} Timing Statistics =====`);
        Logger.log(`🎤 Recording phase:      ${formatted.recording}`);
        
        if (timings.audioCompletion) {
            Logger.log(`🎯 Transcription+Chat:   ${formatted.audioCompletion}`);
        } else if (timings.audioProcessing) {
            Logger.log(`🎯 Audio processing:     ${formatted.audioProcessing}`);
        } else {
            // Legacy version compatibility
            Logger.log(`📝 Voice transcription:  ${formatted.transcription || '0ms'}`);
            Logger.log(`🤖 AI response generation: ${formatted.chatCompletion || '0ms'}`);
            Logger.log(`🔊 Text-to-speech:       ${formatted.textToSpeech || '0ms'}`);
        }
        
        Logger.log(`📢 Audio playback:       ${formatted.audioPlayback}`);
        Logger.log(`⏱️ Total time:           ${formatted.total}`);
        Logger.log(`================================\n`);
        
        // Calculate processing time percentage
        const processingTime = timings.audioCompletion || timings.audioProcessing;
        if (processingTime) {
            const processingPercentage = Math.round((processingTime / timings.total) * 100);
            Logger.log(`📊 AI processing time: ${Math.round(processingTime)}ms (${processingPercentage}% of total)`);
        }
    }

    /**
     * Log token usage and cache efficiency
     */
    logTokenUsage(usage) {
        Logger.log('📊 === Token Usage Details ===');
        Logger.log(`Total tokens: ${usage.total_tokens}`);
        Logger.log(`Input tokens: ${usage.prompt_tokens}`);
        Logger.log(`Output tokens: ${usage.completion_tokens}`);
        
        if (usage.prompt_tokens_details) {
            const details = usage.prompt_tokens_details;
            Logger.log(`Input details:`);
            Logger.log(`  📝 Text tokens: ${details.text_tokens || 0}`);
            Logger.log(`  🎵 Audio tokens: ${details.audio_tokens || 0}`);
            Logger.log(`  🖼️ Image tokens: ${details.image_tokens || 0}`);
        }
        
        if (usage.completion_tokens_details) {
            const details = usage.completion_tokens_details;
            Logger.log(`Output details:`);
            Logger.log(`  📝 Text tokens: ${details.text_tokens || 0}`);  
            Logger.log(`  🎵 Audio tokens: ${details.audio_tokens || 0}`);
        }
        
        // Cache efficiency statistics
        const summary = this.getConversationSummaryWithAudio();
        Logger.log(`💾 Assistant audio cache efficiency: ${summary.cacheHitRate} (${summary.cachedAudioReferences}/${summary.assistantAudioMessages})`);
        Logger.log(`🎤 User audio messages: ${summary.userAudioMessages} (always resent)`);
        Logger.log('=====================================');
    }

    /**
     * Get conversation history summary (including audio information)
     */
    getConversationSummaryWithAudio() {
        const history = this.getCurrentConversationHistory();
        let assistantAudioMessages = 0;
        let cachedAudioRefs = 0;
        let userAudioMessages = 0;
        
        history.forEach(msg => {
            if (msg.role === 'assistant' && msg.audioId) {
                assistantAudioMessages++;
                if (this.audioCache.has(msg.audioId)) {
                    cachedAudioRefs++;
                }
            } else if (msg.role === 'user' && msg.audioBase64) {
                userAudioMessages++;
            }
        });
        
        return {
            totalMessages: history.length,
            userAudioMessages: userAudioMessages,
            assistantAudioMessages: assistantAudioMessages,
            cachedAudioReferences: cachedAudioRefs,
            cacheHitRate: assistantAudioMessages > 0 ? (cachedAudioRefs / assistantAudioMessages * 100).toFixed(1) + '%' : '0%',
            currentVideoId: this.currentVideoId,
            audioCacheSize: this.audioCache.size
        };
    }

    /**
     * Convert Blob to Base64
     */
    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Convert Base64 to ArrayBuffer
     */
    async base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // ============ Backward Compatibility Methods ============

    /**
     * Reset conversation history (backward compatibility)
     * @deprecated Use resetVideoConversation or switchToVideo instead
     */
    resetConversation(videoId = null) {
        Logger.warn('OpenAI: resetConversation is deprecated, recommend using resetVideoConversation');
        if (videoId) {
            this.switchToVideo(videoId);
            this.resetVideoConversation(videoId);
        } else {
            this.resetVideoConversation();
        }
    }

    /**
     * Check video change (backward compatibility)
     * @deprecated Use switchToVideo instead
     */
    checkVideoChange(videoId) {
        Logger.warn('OpenAI: checkVideoChange is deprecated, recommend using switchToVideo');
        this.switchToVideo(videoId);
    }
}

// Export as global variable
window.OpenAIVoiceAssistant = OpenAIVoiceAssistant; 