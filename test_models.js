const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

async function run() {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    // There is no listModels in the new SDK easily exposed, but let's try a test query with gemini-1.5-flash
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        await model.generateContent("Test");
        console.log("gemini-flash-latest worked");
    } catch(e) {
        console.error("gemini-flash-latest failed:", e.message);
    }
    
    try {
        const model2 = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        await model2.generateContent("Test");
        console.log("gemini-3.5-flash worked");
    } catch(e) {
        console.error("gemini-3.5-flash failed:", e.message);
    }
}

run();
