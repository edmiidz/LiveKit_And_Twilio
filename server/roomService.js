// server/roomService.js
const twilio = require('twilio');
const { AccessToken } = require('livekit-server-sdk');

class RoomService {
    constructor(config) {
        this.twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);
        this.twilioPhoneNumber = config.twilioPhoneNumber;
        this.baseUrl = config.baseUrl;
        this.livekitApiKey = config.livekitApiKey;
        this.livekitApiSecret = config.livekitApiSecret;
        this.livekitWsUrl = config.livekitWsUrl;
        this.activeConferences = new Map(); // Track active conferences
    }

    async dialOutToPhone(phoneNumber, roomName) {
        try {
            if (!this.baseUrl) {
                throw new Error('BASE_URL environment variable is not set');
            }
    
            const twimlUrl = `${this.baseUrl}/voice/connect-to-room?roomName=${encodeURIComponent(roomName)}`;
            console.log('Using Twilio webhook URL:', twimlUrl);
    
            const call = await this.twilioClient.calls.create({
                to: phoneNumber,
                from: this.twilioPhoneNumber,
                url: twimlUrl,
                statusCallback: `${this.baseUrl}/voice/status-callback`,
                statusCallbackEvent: ['completed', 'failed'],
                statusCallbackMethod: 'POST'
            });
    
            // Store the call information
            this.activeConferences.set(call.sid, {
                phoneNumber,
                roomName,
                status: 'initiated'
            });

            return { success: true, callSid: call.sid };
        } catch (error) {
            console.error('Error dialing out:', error);
            return { success: false, error: error.message };
        }
    }

    generateLiveKitToken(participantName, roomName) {
        const at = new AccessToken(
            this.livekitApiKey,
            this.livekitApiSecret,
            { identity: participantName }
        );

        at.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true
        });

        return at.toJwt();
    }

    async handleCallCompletion(callSid) {
        try {
            console.log(`Handling call completion for SID: ${callSid}`);
            if (this.activeConferences.has(callSid)) {
                const conferenceData = this.activeConferences.get(callSid);
                console.log(`Call completed for room: ${conferenceData.roomName}`);
                this.activeConferences.delete(callSid);
            }
        } catch (error) {
            console.error('Error handling call completion:', error);
        }
    }

    async handleConferenceEvent(event) {
        try {
            console.log('Processing conference event:', event);
            
            const eventType = event.StatusCallbackEvent;
            const conferenceSid = event.ConferenceSid;
            
            switch(eventType) {
                case 'participant-join':
                    console.log(`Participant joined conference ${conferenceSid}`);
                    // Here you would implement the logic to bridge the audio to LiveKit
                    break;
                    
                case 'participant-leave':
                    console.log(`Participant left conference ${conferenceSid}`);
                    // Clean up any LiveKit connections
                    break;
                    
                case 'conference-start':
                    console.log(`Conference ${conferenceSid} started`);
                    break;
                    
                case 'conference-end':
                    console.log(`Conference ${conferenceSid} ended`);
                    break;
                    
                default:
                    console.log(`Unhandled conference event: ${eventType}`);
            }
            
            return true;
        } catch (error) {
            console.error('Error handling conference event:', error);
            return false;
        }
    }
}

module.exports = RoomService;