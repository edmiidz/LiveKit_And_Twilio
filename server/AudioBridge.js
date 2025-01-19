// server/AudioBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const { Room } = require('livekit-client');

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
            
            // Create access token
            const at = new AccessToken(
                this.apiKey,
                this.apiSecret,
                {
                    identity: participantIdentity,
                }
            );

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = await at.toJwt();
            console.log(`Created token for ${participantIdentity}`);

            // Create LiveKit room connection
            const room = new Room({
                adaptiveStream: false,
                dynacast: false,
                stopMicTrackOnMute: false
            });

            // Connect to the room
            await room.connect(this.livekitHost, token);
            console.log(`Connected to LiveKit room: ${roomName}`);

            // Store connection info
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connected',
                room,
                audioTrack: null
            });

            console.log('Stream info set:', {
                conferenceId,
                participantIdentity,
                status: 'connected'
            });

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
            if (!streamInfo.room || !streamInfo.room.state === 'connected') {
                console.warn(`Room not connected for ${conferenceId}`);
                return;
            }

            // Create audio buffer from the payload
            const buffer = Buffer.from(audioData, 'base64');
            
            // Create and publish audio track if not already done
            if (!streamInfo.audioTrack) {
                // Create an AudioTrack from the buffer
                streamInfo.audioTrack = await streamInfo.room.localParticipant.createAudioTrack({
                    source: 'microphone'
                });
                
                // Publish the track
                await streamInfo.room.localParticipant.publishTrack(streamInfo.audioTrack);
                console.log(`Published audio track for ${conferenceId}`);
            }

            // Send audio data through the track
            if (streamInfo.audioTrack) {
                // Update the audio track with new data
                streamInfo.audioTrack.source.audioElement.srcObject = new Blob([buffer], { 
                    type: 'audio/x-mulaw' 
                });
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
                if (streamInfo.audioTrack) {
                    await streamInfo.room.localParticipant.unpublishTrack(streamInfo.audioTrack);
                    streamInfo.audioTrack.stop();
                }
                await streamInfo.room.disconnect();
                this.activeStreams.delete(conferenceId);
                console.log(`Stream stopped for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = AudioBridge;