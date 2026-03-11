let sharks = [];
let currentSharkIndex = 0;
let map;      // Holds the map object
let mainMarker;   // Holds the red pin
let sharkPath;
let startPingMarker;
let endPingMarker;
let isAdmin = false;
let tempClickCoords = null;

function makeSmoothCurve(path, numPoints = 4) {
    if (!path || path.length < 2) return path;
    const result = [];
    for (let i = 0; i < path.length - 1; i++) {
        const p0 = i > 0 ? path[i - 1] : path[i];
        const p1 = path[i];
        const p2 = path[i + 1];
        const p3 = i < path.length - 2 ? path[i + 2] : path[i + 1];
        for (let t = 0; t < 1; t += 1 / numPoints) {
            const t2 = t * t;
            const t3 = t2 * t;
            const lat = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
            const lng = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
            result.push([lat, lng]);
        }
    }
    result.push(path[path.length - 1]);
    return result;
}

async function loadSharkData() {
    try{
        console.log("Request data from server...");

    const response = await fetch('http://localhost:3000/api/sharks/full-data');  
    sharks = await response.json();

    console.log("Data fetched:", sharks);
    initMap();
    }catch(error){
        console.error("Connecting error:", error);
        alert("I can't connect with the server! Make sure you have 'node server.js' running!");
    }
}

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

    map.on('click', function(e){
        tempClickCoords = [e.latlng.lat, e.latlng.lng];

        if (isAdmin) {
            alert(`Coordinates: ${tempClickCoords}`);
        }else {
            document.getElementById('click-coords').innerText = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
            document.getElementById('report-modal').classList.remove('hidden');
        }
    });

    updateDisplay();
}

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

    //  Clean up
    if (mainMarker) map.removeLayer(mainMarker);
    if (sharkPath) map.removeLayer(sharkPath);
    if (startPingMarker) map.removeLayer(startPingMarker);
    if (endPingMarker) map.removeLayer(endPingMarker);

    let markerColor = "#ef4444";
    let markerRadius = 8;

    if ( shark.isUserReport){
        markerColor = "#a855f7";
        markerRadius = 10;
    }

    if (shark.coords){
        mainMarker = L.circleMarker(shark.coords, {
            radius: markerRadius,
            fillColor: markerColor,
            color: "#fff",
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(map);
        mainMarker.bindPopup(`<strong>${shark.name}</strong><br>${shark.tag}`);
    }

    if(shark.history && shark.history.length > 1){
        let smooth = makeSmoothCurve(shark.history, 4);
        sharkPath = L.polyline(smooth, {
            color: '#fbbf24',
            weight: 2,
            opacity: 0.8,
            smoothFactor: 1
        }).addTo(map);

        let startPoint = shark.history[0];
        let endPoint = shark.history[shark.history.length - 1];

        startPingMarker = L.circleMarker(startPoint, {
            radius: 4,
            fillColor: "#ffffff",
            color: "#000",
            weight: 1,
            fillOpacity: 1
        }).addTo(map);

        endPingMarker = L.circleMarker(endPoint, {
            radius: 4,
            fillColor: markerColor,
            color: "#ffffff",
            weight: 1,
            fillOpacity: 1
        }).addTo(map);

         map.fitBounds(sharkPath.getBounds(), {padding: [50, 50]});   
    }else if (shark.coords) {
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