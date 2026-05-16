import { config } from 'dotenv';
config({ path: 'apps/web/.env.local' });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('No API key found');
    process.exit(1);
}

async function testImagen() {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instances: [
                { prompt: "A beautiful sunset over the mountains" }
            ],
            parameters: {
                sampleCount: 1,
                outputOptions: { mimeType: "image/jpeg" }
            }
        })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
        console.error('Imagen failed:', data.error);
    } else {
        console.log('Imagen success!');
    }
}

testImagen();
