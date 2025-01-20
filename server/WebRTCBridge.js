// server/WebRTCBridge.js
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const { Room, RoomEvent } = require('livekit-client');

class AudioProcessor {
    constructor() {
        this.sampleRate = 8000;  // Twilio's mulaw sample rate
        this.channels = 1;
    }

    async convertMulawToPCM(base64Audio) {
        const buffer = Buffer.from(base64Audio, 'base64');
        const pcmData = new Int16Array(buffer.length);
        
        for (let i = 0; i < buffer.length; i++) {
            pcmData[i] = this.mulawToPCM(buffer[i]);
        }
        
        return pcmData;
    }

    mulawToPCM(mulawByte) {
        const MULAW_BIAS = 0x84;
        mulawByte = ~mulawByte;
        let sign = (mulawByte & 0x80) ? -1 : 1;
        let exponent = ((mulawByte & 0x70) >> 4);
        let mantissa = mulawByte & 0x0F;
        let magnitude = ((mantissa << 3) + MULAW_BIAS) << exponent;
        return sign * (magnitude - MULAW_BIAS);
    }

    createAudioTrack(pcmData) {
        try {
            // Create an AudioContext
            const audioContext = new (require('web-audio-api').AudioContext)();
            const buffer = audioContext.createBuffer(1, pcmData.length, this.sampleRate);
            
            // Copy the PCM data to the buffer
            const channelData = buffer.getChannelData(0);
            for (let i = 0; i < pcmData.length; i++) {
                channelData[i] = pcmData[i] / 32768.0; // Convert to float (-1.0 to 1.0)
            }

            return buffer;
        } catch (error) {
            console.error('Error creating audio track:', error);
            throw error;
        }
    }
}

class WebRTCBridge {
    constructor(config) {
        if (!config.livekitHost || !config.apiKey || !config.apiSecret) {
            throw new Error('Missing required LiveKit configuration');
        }

        this.baseUrl = `https://${config.livekitHost.replace('wss://', '')}`;
        this.wsUrl = config.livekitHost;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.activeStreams = new Map();
        this.roomService = new RoomServiceClient(
            this.baseUrl,
            this.apiKey,
            this.apiSecret
        );
        this.audioProcessor = new AudioProcessor();
    }

    async createStreamToRoom(conferenceId, roomName) {
        console.log(`Initializing stream for conference ${conferenceId} to room ${roomName}`);
        
        try {
            // List rooms to verify connection
            const rooms = await this.roomService.listRooms();
            console.log('Successfully connected to LiveKit. Available rooms:', rooms);

            // Create room if it doesn't exist
            try {
                await this.roomService.createRoom({
                    name: roomName,
                    empty_timeout: 300,
                    max_participants: 20
                });
                console.log(`Room ${roomName} created successfully`);
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    throw error;
                }
                console.log(`Room ${roomName} already exists`);
            }

            // Generate participant token
            const participantIdentity = `twilio-bridge-${conferenceId}`;
            const at = new AccessToken(this.apiKey, this.apiSecret, {
                identity: participantIdentity,
                ttl: 86400
            });

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = at.toJwt();
            console.log(`Generated participant token for ${conferenceId}`);

            // Create LiveKit room
            const room = new Room({
                adaptiveStream: true,
                dynacast: true,
                audioMode: 'music'
            });

            // Set up room event handlers
            room.on(RoomEvent.Connected, () => {
                console.log(`Connected to LiveKit room: ${roomName}`);
            });

            room.on(RoomEvent.Disconnected, () => {
                console.log(`Disconnected from LiveKit room: ${roomName}`);
            });

            room.on(RoomEvent.TrackPublished, (track, publication, participant) => {
                console.log(`Track published by ${participant.identity}: ${track.kind}`);
            });

            // Connect to LiveKit
            await room.connect(this.wsUrl, token, {
                autoSubscribe: true
            });

            // Store stream info
            this.activeStreams.set(conferenceId, {
                roomName,
                token,
                status: 'connected',
                participantIdentity,
                room,
                audioBuffer: [],
                createdAt: Date.now()
            });

            console.log(`Successfully initialized stream for ${conferenceId}`);
            return { token, roomName };

        } catch (error) {
            console.error(`Failed to create stream:`, error);
            this.activeStreams.delete(conferenceId);
            throw error;
        }
    }

    async handleAudioData(conferenceId, audioData, track) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo) {
            console.warn(`No active stream found for conference ${conferenceId}`);
            return;
        }

        try {
            // Convert audio data
            const pcmData = await this.audioProcessor.convertMulawToPCM(audioData);
            const audioBuffer = this.audioProcessor.createAudioTrack(pcmData);
            
            if (streamInfo.room && streamInfo.room.localParticipant) {
                // Create and publish audio track
                await streamInfo.room.localParticipant.publishTrack(audioBuffer, {
                    name: track,
                    source: track === 'inbound' ? 'microphone' : 'audiofile'
                });
            }

            return true;
        } catch (error) {
            console.error('Error processing audio:', error);
            return false;
        }
    }

    async stopStream(conferenceId) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (streamInfo) {
            try {
                if (streamInfo.room) {
                    await streamInfo.room.disconnect();
                }
                await this.roomService.deleteRoom(streamInfo.roomName);
                console.log(`Room ${streamInfo.roomName} deleted`);
            } catch (error) {
                console.warn(`Error deleting room: ${error.message}`);
            }

            this.activeStreams.delete(conferenceId);
            console.log(`Stream stopped for conference ${conferenceId}`);
        }
    }
}

module.exports = WebRTCBridge;