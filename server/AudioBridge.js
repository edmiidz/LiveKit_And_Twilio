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

    async createStreamToRoom(conferenceId, roomName) {
        try {
            console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
            
            // Create participant identity
            const participantIdentity = `twilio-bridge-${conferenceId}`;
            
            // Create access token using AccessToken class
            const at = new AccessToken(
                this.apiKey,
                this.apiSecret,
                {
                    identity: participantIdentity,
                }
            );

            // Add grant for room access
            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = at.toJwt();

            // Create WebSocket connection to LiveKit
            const ws = new WebSocket(this.livekitHost, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            // Handle WebSocket events
            ws.on('open', () => {
                console.log(`WebSocket connection established for ${participantIdentity}`);
            });

            ws.on('error', (error) => {
                console.error(`WebSocket error for ${participantIdentity}:`, error);
            });

            // Store the stream information
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connecting',
                token,
                ws
            });

            console.log(`Created bridge token for ${participantIdentity} in room ${roomName}`);

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
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (!streamInfo) {
                console.warn(`No active stream found for conference ${conferenceId}`);
                return;
            }

            if (!streamInfo.ws || streamInfo.ws.readyState !== WebSocket.OPEN) {
                console.warn(`WebSocket not connected for conference ${conferenceId}`);
                return;
            }

            if (streamInfo.status === 'connecting') {
                // First audio packet, send join message
                try {
                    console.log(`Joining LiveKit room for conference ${conferenceId}`);
                    const joinMessage = {
                        type: 'join',
                        room: streamInfo.roomName,
                        participant: streamInfo.participantIdentity,
                        audio: true
                    };
                    streamInfo.ws.send(JSON.stringify(joinMessage));
                    streamInfo.status = 'connected';
                } catch (error) {
                    console.error('Error joining LiveKit room:', error);
                }
            }

            // Send audio data
            const audioMessage = {
                type: 'audio',
                data: audioData
            };
            streamInfo.ws.send(JSON.stringify(audioMessage));

        } catch (error) {
            console.error('Error handling audio data:', error);
        }
    }

    async stopStream(conferenceId) {
        try {
            console.log(`Stopping stream for conference ${conferenceId}`);
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                if (streamInfo.ws) {
                    streamInfo.ws.close();
                }
                await this.roomService.removeParticipant(
                    streamInfo.roomName,
                    streamInfo.participantIdentity
                );
                this.activeStreams.delete(conferenceId);
                console.log(`Stopped stream for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = AudioBridge;