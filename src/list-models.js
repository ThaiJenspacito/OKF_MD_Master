const dotenv = require('dotenv');
dotenv.config();

async function checkGoogleModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    
    console.log("🔍 Rufe verfügbare Modelle von Google ab...");
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.models && data.models.length > 0) {
            console.log("\n✅ DIESE MODELLE SIND FÜR DICH VERFÜGBAR:\n");
            data.models.forEach(model => {
                // Wir filtern nach Modellen, die Text generieren können
                if (model.supportedGenerationMethods.includes('generateContent')) {
                    const shortName = model.name.replace('models/', '');
                    console.log(`👉  ${shortName}`);
                }
            });
            console.log("\n-------------------------------------------");
            console.log("Kopiere einfach einen der Namen oben, der NICHT gemini-2.0-flash heißt.");
        } else {
            console.log("🚨 Fehler von Google empfangen:", data);
        }
    } catch (error) {
        console.error("🚨 Netzwerkfehler beim Abrufen der Modelle:", error);
    }
}

checkGoogleModels();