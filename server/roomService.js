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
    // Add just this one new method
    async handleConferenceEvent(event) {
        try {
            console.log('Handling conference event:', event);
            // We'll implement the bridging logic here in small steps
            // once we confirm this doesn't break anything
            return true;
        } catch (error) {
            console.error('Error handling conference event:', error);
            return false;
        }
    }
}

module.exports = RoomService;