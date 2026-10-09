require("dotenv").config();

const express = require("express");
const cors = require("cors");
const twilio = require("twilio");

const app = express();

app.use(cors());
app.use(express.json());

const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

app.get("/", (req, res) => {
    res.send(" Twilio SOS server is running!");
});

app.post("/api/sos", async (req, res) => {
    try {
        const {
            emergencyType,
            latitude,
            longitude
        } = req.body;

        const message = `🚨 SOS ALERT
Emergency: ${emergencyType}
Location: ${latitude}, ${longitude}
Please respond immediately.`;

        const sms = await client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: process.env.EMERGENCY_PHONE_NUMBER
        });

        res.json({
            success: true,
            message: "SOS SMS sent",
            sid: sms.sid
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to send SOS SMS",
            error: error.message
        });
    }
});

app.listen(5000, () => {
    console.log("SOS backend running on http://localhost:5000");
});