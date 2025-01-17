# LiveKit_And_Twilio

## Acknowledgments

This project was significantly edited with the help of ChatGPT and Claude.ai. Their assistance was instrumental in refining the code and ensuring its functionality.

## Setup Instructions

### Prerequisites
1. **Node.js**: Install the latest version of Node.js from [nodejs.org](https://nodejs.org/).
2. **Ngrok**: Download and install Ngrok from [ngrok.com](https://ngrok.com/). This is useful for exposing your localhost to the internet during development.
3. **Twilio Account**: Create a Twilio account at [twilio.com](https://www.twilio.com/) and ensure you have an active phone number and API token.
4. **LiveKit**: Obtain API credentials and SIP configuration from LiveKit.

### Environment Variables
Set up a `.env` file in the root directory of the project. Use the provided `.env.sample` as a template:

```plaintext
BASE_URL=<your_base_url>
TWILIO_ACCOUNT_SID=<your_twilio_account_sid>
TWILIO_AUTH_TOKEN=<your_twilio_auth_token>
TWILIO_PHONE_NUMBER=<your_twilio_phone_number>
LIVEKIT_API_KEY=<your_livekit_api_key>
LIVEKIT_API_SECRET=<your_livekit_api_secret>
LIVEKIT_WS_URL=<your_livekit_ws_url>
LIVEKIT_SIP_URI=<your_livekit_sip_uri>
LIVEKIT_DOMAIN=<your_livekit_domain>
```

### Steps to Set Up

1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd <repository-folder>
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up Environment Variables**:
   - Copy the `.env.sample` file and rename it to `.env`.
   - Replace placeholders with your actual credentials.

4. **Start Ngrok** (For Development):
   ```bash
   ngrok http 3000
   ```
   Note the Ngrok URL (e.g., `https://your-ngrok-url.ngrok-free.app`) and set it as `BASE_URL` in your `.env` file.

5. **Configure Twilio**:
   - Log in to your Twilio account.
   - Set the webhook URL for your active number to `https://<your-ngrok-url>/voice/connect-to-room`.

6. **Run the Application**:
   ```bash
   npm start
   ```
   The application should now be running at `http://localhost:3000`.

7. **LiveKit Configuration**:
   - Use the provided API token and SIP details in the `.env` file.
   - Ensure your LiveKit server is running and accessible.

### Usage
- Use the `/join-room` endpoint to join a room.
- Use the `/dial-out` endpoint to call participants.
- Use the `/voice/connect-to-room` endpoint to connect to LiveKit SIP.

### Notes
- Ngrok is only recommended for development purposes. In production, use a permanent and secure domain.
- Ensure your `.env` file is not committed to your repository by verifying it is listed in `.gitignore`.

For more details, refer to the [LiveKit](https://livekit.io/) and [Twilio](https://www.twilio.com/) documentation.

## License

This project is licensed under the [MIT License](./LICENSE). See the LICENSE file for details.

Copyright (c) 2025 Nik Edmiidz. All rights reserved.
