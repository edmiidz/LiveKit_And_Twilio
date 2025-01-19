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

            // Wait for WebSocket connection to be established
            const wsPromise = new Promise((resolve, reject) => {
                const ws = new WebSocket(this.livekitHost, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                ws.on('open', () => {
                    console.log(`WebSocket connection opened for ${participantIdentity}`);
                    resolve(ws);
                });

                ws.on('error', (error) => {
                    console.error(`WebSocket error for ${participantIdentity}:`, error);
                    reject(error);
                });

                ws.on('close', (code, reason) => {
                    console.log(`WebSocket closed for ${participantIdentity}:`, code, reason);
                });

                // Set a timeout for the connection
                setTimeout(() => {
                    reject(new Error('WebSocket connection timeout'));
                }, 5000);
            });

            // Wait for WebSocket connection
            const ws = await wsPromise;
            
            // Join the LiveKit room
            const joinMessage = {
                action: 'join',
                room: roomName,
                token: token
            };
            ws.send(JSON.stringify(joinMessage));
            console.log(`Sent join message for ${participantIdentity}`);

            // Store the stream information
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connecting',
                token,
                ws
            });

            console.log(`Created bridge token for ${participantIdentity} in room ${roomName}`);
            console.log('Stream info:', this.activeStreams.get(conferenceId));

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
                console.warn(`WebSocket not connected for conference ${conferenceId}, state: ${streamInfo.ws ? streamInfo.ws.readyState : 'no websocket'}`);
                return;
            }

            // Convert audio data to proper format and send
            const audioMessage = {
                action: 'publish',
                kind: 'audio',
                data: Buffer.from(audioData, 'base64').toString('base64'),
                codec: 'opus',
                sampleRate: 48000,
                channels: 1
            };

            streamInfo.ws.send(JSON.stringify(audioMessage));
            if (streamInfo.status === 'connecting') {
                console.log('First audio packet sent successfully');
                streamInfo.status = 'connected';
            }

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
                    try {
                        const leaveMessage = {
                            action: 'leave',
                            room: streamInfo.roomName
                        };
                        streamInfo.ws.send(JSON.stringify(leaveMessage));
                        streamInfo.ws.close();
                    } catch (error) {
                        console.error('Error closing WebSocket:', error);
                    }
                }
                this.activeStreams.delete(conferenceId);
                console.log(`Stopped stream for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = AudioBridge;