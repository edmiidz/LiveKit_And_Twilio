// server/AudioBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const WebSocket = require('ws');

class AudioBridge {
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
    }

    createServerParticipant(roomName, identity) {
        const at = new AccessToken(
            this.apiKey,
            this.apiSecret,
            { identity }
        );

        at.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true
        });

        return at.toJwt();
    }

    async createStreamToRoom(conferenceId, roomName) {
        try {
            console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
            
            // Create participant identity
            const participantIdentity = `twilio-bridge-${conferenceId}`;
            
            // Create server participant token
            const token = await this.createServerParticipant(roomName, participantIdentity);
            console.log(`Created token for ${participantIdentity}`);

            // Join room using server token
            await this.roomService.joinRoom(roomName, participantIdentity);
            console.log(`Joined room ${roomName} as ${participantIdentity}`);

            // Create WebRTC data channel for audio
            const wsUrl = this.livekitHost.replace('wss://', '');
            const ws = new WebSocket(`wss://${wsUrl}/rtc/${roomName}/${participantIdentity}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            ws.on('open', () => {
                console.log(`WebSocket connection opened for ${participantIdentity}`);
                // Send join message
                ws.send(JSON.stringify({
                    type: 'join',
                    room: roomName,
                    token
                }));
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    console.log(`Received message from LiveKit:`, msg.type);
                } catch (err) {
                    console.error('Error parsing LiveKit message:', err);
                }
            });

            ws.on('error', (error) => {
                console.error(`WebSocket error for ${participantIdentity}:`, error);
            });

            // Store connection info
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                ws,
                token,
                status: 'connected'
            });

            console.log(`Stream connection established for ${participantIdentity}`);

            return {
                token,
                participantIdentity
            };

        } catch (error) {
            console.error('Error creating stream to room:', error);
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
            if (!streamInfo.ws || streamInfo.ws.readyState !== WebSocket.OPEN) {
                console.warn(`WebSocket not ready for ${conferenceId}, state:`, 
                    streamInfo.ws ? streamInfo.ws.readyState : 'no websocket');
                return;
            }

            // Send audio data through WebSocket
            const message = {
                type: 'audio',
                data: audioData,
                encoding: 'mulaw',
                sampleRate: 8000,
                channels: 1
            };

            streamInfo.ws.send(JSON.stringify(message));
            
            if (streamInfo.status === 'connecting') {
                console.log('First audio packet sent successfully');
                streamInfo.status = 'connected';
            }

        } catch (error) {
            console.error(`Error handling audio data for ${conferenceId}:`, error);
        }
    }

    async stopStream(conferenceId) {
        try {
            console.log(`Stopping stream for conference ${conferenceId}`);
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                if (streamInfo.ws) {
                    // Send leave message before closing
                    try {
                        streamInfo.ws.send(JSON.stringify({
                            type: 'leave',
                            room: streamInfo.roomName
                        }));
                        streamInfo.ws.close();
                    } catch (err) {
                        console.error('Error closing WebSocket:', err);
                    }
                }
                // Remove from LiveKit room
                await this.roomService.removeParticipant(streamInfo.roomName, streamInfo.participantIdentity);
                this.activeStreams.delete(conferenceId);
                console.log(`Stream stopped for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = AudioBridge;