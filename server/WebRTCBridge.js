// server/WebRTCBridge.js
const { AccessToken } = require('livekit-server-sdk');
const crypto = require('crypto');

class WebRTCBridge {
    constructor(config) {
        if (!config.livekitHost || !config.apiKey || !config.apiSecret) {
            throw new Error('Missing required LiveKit configuration');
        }

        this.baseUrl = `https://${config.livekitHost.replace('wss://', '')}`;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.activeStreams = new Map();
    }

    generateAuthHeader(method, path, body = '') {
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = crypto.randomBytes(16).toString('hex');
        
        // Construct the string to sign
        const signData = [
            timestamp.toString(),
            method.toUpperCase(),
            path,
            nonce
        ];
        
        if (body) {
            signData.push(body);
        }
        
        const toSign = signData.join('\n');
        
        // Create signature
        const signature = crypto
            .createHmac('sha256', this.apiSecret)
            .update(toSign)
            .digest('base64');
        
        // Return authorization header
        return `LiveKit-API ${this.apiKey} ${timestamp} ${nonce} ${signature}`;
    }

    fetchToCurl(url, options) {
        const { method, headers, body } = options;
        const headerString = Object.entries(headers)
            .map(([key, value]) => `-H '${key}: ${value}'`)
            .join(' ');
        
        const curlCmd = `curl -X ${method} ${headerString} ${body ? `-d '${body}'` : ''} '${url}' -v`;
        console.log('\nEquivalent CURL command::::::::::::::::::::::::');
        console.log(curlCmd);
        console.log('\n');
        return curlCmd;
    }

    async createStreamToRoom(conferenceId, roomName) {
        console.log(`Initializing stream for conference ${conferenceId} to room ${roomName}`);
        
        try {
            const apiPath = '/twirp/livekit.RoomService/CreateRoom';
            const createRoomUrl = `${this.baseUrl}${apiPath}`;
            const requestBody = JSON.stringify({
                name: roomName,
                empty_timeout: 300,
                max_participants: 20
            });
            
            const requestOptions = {
                method: 'POST',
                headers: {
                    'Authorization': this.generateAuthHeader('POST', apiPath, requestBody),
                    'Content-Type': 'application/json'
                },
                body: requestBody
            };

            // Output curl command for debugging
            this.fetchToCurl(createRoomUrl, requestOptions);

            const createRoomResponse = await fetch(createRoomUrl, requestOptions);

            const responseText = await createRoomResponse.text();
            console.log('Create room response:', responseText);

            if (!createRoomResponse.ok && !responseText.includes('already exists')) {
                throw new Error(`Failed to create room: ${responseText}`);
            }

            // Create participant token
            const at = new AccessToken(this.apiKey, this.apiSecret, {
                identity: `twilio-bridge-${conferenceId}`,
                name: `Twilio Call ${conferenceId}`
            });

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = at.toJwt();
            console.log(`Generated participant token for ${conferenceId}`);

            // Store stream info
            this.activeStreams.set(conferenceId, {
                roomName,
                token,
                status: 'connected',
                audioBuffer: [],
                createdAt: Date.now()
            });

            return { token, roomName };

        } catch (error) {
            console.error(`Failed to create stream: ${error.message}`);
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

        console.log(`Received ${track} audio for conference ${conferenceId} (${streamInfo.status})`);
        return true;
    }

    async stopStream(conferenceId) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (streamInfo) {
            try {
                const apiPath = '/twirp/livekit.RoomService/DeleteRoom';
                const deleteRoomUrl = `${this.baseUrl}${apiPath}`;
                const response = await fetch(deleteRoomUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': this.generateAuthHeader(apiPath),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: streamInfo.roomName
                    })
                });

                console.log(`Room deletion response: ${await response.text()}`);
            } catch (error) {
                console.warn(`Error deleting room: ${error.message}`);
            }

            this.activeStreams.delete(conferenceId);
            console.log(`Stream stopped for conference ${conferenceId}`);
        }
    }
}

module.exports = WebRTCBridge;