let sharks = [];
let currentSharkIndex = 0;
let map;      // Holds the map object
let marker;   // Holds the red pin
let sharkPath;
let startPingMarker;
let endPingMarker;

async function loadSharkData() {
    try{
        console.log("Request data from server...");

    const response = await fetch('http://localhost:3000/api/sharks/full-data');  
    sharks = await response.json();

    console.log("Data fetched:", sharks);
    initMap();
    }catch(error){
        console.error("Eroare la conectare:", error);
        alert("I can't connect with the server! Make sure you have 'node server.js' running!");
    }
}
// --- Initialize map ---
function initMap() {

    const worldBounds = [
        [-90, -180],
        [90, 180]
    ];
    // Create Map (Center on 0,0)
    map = L.map('map', {
        minZoom: 2,
        maxBounds: worldBounds,
        maxBoundsViscosity: 1.0,
    }).setView([0, 0], 2);

    // Add the Map Skin (Tiles) from OpenStreetMap
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        noWrap: true,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Add a Pin
    marker = L.marker([0, 0]).addTo(map);

    // Load the first shark
    updateDisplay();
}

// --- Update function ---
function updateDisplay() {
    
    if (sharks.length === 0) return;

    let shark = sharks[currentSharkIndex];

    document.getElementById("shark-type").innerText = shark.type;
    document.getElementById("tag").innerText = shark.tag;
    document.getElementById("shark-name").innerText = shark.name;
    document.getElementById("shark-description").innerText = shark.description;
    document.getElementById("shark-length").innerText = shark.length;
    document.getElementById("shark-weight").innerText = shark.weight;
    document.getElementById("shark-zone").innerText = shark.zone;
    document.getElementById("shark-image").src = shark.img;

    // --- Clean up ---
    if (sharkPath) map.removeLayer(sharkPath);
    if (startPingMarker) map.removeLayer(startPingMarker);
    if (endPingMarker) map.removeLayer(endPingMarker);

    if (shark.coords){
        marker.setLatLng(shark.coords);
    }

    if(shark.history && shark.history.length > 0){
        sharkPath = L.polyline(shark.history, {
            color: '#4c00b0',
            weight: 2,
            opacity: 0.8,
            smoothFactor: 1
        }).addTo(map);

        let startPoint = shark.history[0];
        let endPoint = shark.history[shark.history.length - 1];

        startPingMarker = L.circleMarker(startPoint, {
            radius: 5,
            fillColor: "#ffffff",
            color: "#000",
            weight: 1,
            fillOpacity: 1
        }).addTo(map);

        startPingMarker.bindPopup(`
            <div class='ping-popup'>
                <strong>First Ping</strong><br>
                ${shark.latestPing}
            </div>
        `);

        endPingMarker = L.circleMarker(endPoint, {
            radius: 8,
            fillColor: "#0ea5e9",
            color: "#ffffff",
            weight: 2,
            fillOpacity: 1
        }).addTo(map);

        endPingMarker.bindPopup(`
            <div class='ping-popup'>
                <strong> Latest Ping</strong><br>
                ${shark.latestPing}
            </div> 
        `).openPopup();

         map.fitBounds(sharkPath.getBounds(), {padding: [50, 50]});   
    }else {
        map.flyTo(shark.coords, 5, {duration: 2.0});
    }
}

function nextShark() {
    currentSharkIndex++;
    if (currentSharkIndex >= sharks.length) {
        currentSharkIndex = 0;
    }
    updateDisplay();
}

loadSharkData();