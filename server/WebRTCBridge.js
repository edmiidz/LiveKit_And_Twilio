// server/WebRTCBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const { Room } = require('livekit-client');
const WebSocket = require('ws');

class WebRTCBridge {
    constructor(config) {
        this.roomService = new RoomServiceClient(
            config.livekitHost,
            config.apiKey,
            config.apiSecret
        );
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.livekitHost = config.livekitHost;
        this.activeStreams = new Map();
        this.pendingAudio = new Map();
        
        // Add audio context for processing
        this.audioContexts = new Map();
    }

    async setupRoom(roomName) {
        try {
            const rooms = await this.roomService.listRooms();
            const room = rooms.find(r => r.name === roomName);
            if (!room) {
                await this.roomService.createRoom({
                    name: roomName,
                    emptyTimeout: 300,
                });
                console.log('Created new LiveKit room:', roomName);
            }
        } catch (error) {
            console.error('Error setting up room:', error);
            throw error;
        }
    }

    async createStreamToRoom(conferenceId, roomName) {
        try {
            console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
            
            // Initialize audio context for this stream
            const audioContext = new (require('web-audio-api').AudioContext)();
            this.audioContexts.set(conferenceId, audioContext);
            
            // Initialize audio buffer
            this.pendingAudio.set(conferenceId, []);
            
            await this.setupRoom(roomName);
            
            const participantIdentity = `twilio-bridge-${conferenceId}`;
            const at = new AccessToken(this.apiKey, this.apiSecret, { 
                identity: participantIdentity 
            });

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = await at.toJwt();
            
            // Store connection info
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connecting',
                token,
                audioBuffer: [],
                audioContext: audioContext
            });

            // Start room connection process
            this.connectToRoom(conferenceId, roomName, token).catch(error => {
                console.error('Error in room connection:', error);
            });

            return { token, participantIdentity };

        } catch (error) {
            console.error('Error creating stream to room:', error);
            throw error;
        }
    }

    async connectToRoom(conferenceId, roomName, token) {
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (!streamInfo) {
                throw new Error('Stream info not found');
            }

            // Connect to LiveKit room
            const room = new Room();
            
            await room.connect(this.livekitHost, token, {
                autoSubscribe: true
            });

            // Update stream info with room connection
            streamInfo.room = room;
            streamInfo.status = 'connected';
            
            console.log(`Room connection established for ${conferenceId}`);

            // Process any buffered audio
            if (streamInfo.audioBuffer.length > 0) {
                console.log(`Processing ${streamInfo.audioBuffer.length} buffered audio packets`);
                for (const audioData of streamInfo.audioBuffer) {
                    await this.publishAudioData(conferenceId, audioData);
                }
                streamInfo.audioBuffer = [];
            }

        } catch (error) {
            console.error('Error connecting to room:', error);
            throw error;
        }
    }

    async handleAudioData(conferenceId, audioData) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo) {
            console.warn(`No active stream found for conference ${conferenceId}`);
            return;
        }

        try {
            if (streamInfo.status === 'connecting') {
                console.log('Buffering audio while connecting...');
                streamInfo.audioBuffer.push(audioData);
                return;
            }

            // Convert Twilio's mulaw audio to PCM
            const audioBuffer = await this.convertTwilioAudioToWebRTC(audioData, streamInfo.audioContext);
            await this.publishAudioData(conferenceId, audioBuffer);

        } catch (error) {
            console.error(`Error handling audio data for ${conferenceId}:`, error);
        }
    }

    async convertTwilioAudioToWebRTC(audioData, audioContext) {
        // Convert base64 to array buffer
        const binaryData = Buffer.from(audioData, 'base64');
        
        // Create audio buffer from mulaw data
        const audioBuffer = await audioContext.decodeAudioData(binaryData.buffer);
        
        // Convert to WebRTC compatible format
        const pcmData = audioBuffer.getChannelData(0);
        return pcmData;
    }

    async publishAudioData(conferenceId, audioData) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo || !streamInfo.room) return;

        try {
            const track = streamInfo.room.localParticipant.createAudioTrack({
                source: audioData
            });

            await streamInfo.room.localParticipant.publishTrack(track);

        } catch (error) {
            console.error('Error publishing audio:', error);
        }
    }

    async stopStream(conferenceId) {
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                if (streamInfo.room) {
                    await streamInfo.room.disconnect();
                }
                
                // Clean up audio context
                const audioContext = this.audioContexts.get(conferenceId);
                if (audioContext) {
                    await audioContext.close();
                    this.audioContexts.delete(conferenceId);
                }

                this.activeStreams.delete(conferenceId);
                this.pendingAudio.delete(conferenceId);
                console.log(`Stream stopped for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = WebRTCBridge;