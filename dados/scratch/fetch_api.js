const http = require('http');

console.log("Fetching API from http://localhost:3000/api/trades/ESM6...");

http.get('http://localhost:3000/api/trades/ESM6', (res) => {
    console.log("Success! Status:", res.statusCode);
    
    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => {
        try {
            const data = JSON.parse(rawData);
            console.log("Data length:", data.length);
            if (data.length > 0) {
                console.log("First:", data[0]);
                console.log("Last:", data[data.length - 1]);
            }
        } catch (e) {
            console.error("Error parsing JSON:", e.message);
            console.log("Raw data length:", rawData.length);
        }
    });
}).on('error', (e) => {
    console.error("Error fetching API:", e.message);
});
