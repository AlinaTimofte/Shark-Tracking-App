const sharks = [
    {
        tag: "The Legend",
        name: "Deep Blue",
        description: "Considered the largest Great White ever filmed. It has been seen in Hawaii and Guadalupe Island. It is over 50 years old.",
        type: "Female",
        length: "6.1m",
        weight: "2000kg",
        zone: "Pacific",
        img: "images/White_shark.jpg",
        coords: [21.5, -158.0] // Hawaii
    },
    {
        tag: "The Traveler",
        name: "Ironbound",
        description: "A formidable male named after West Ironbound Island. It is known for its long migrations between Canada and Florida.",
        type: "Male",
        length: "3.75m",
        weight: "539 kg",
        zone:"Atlantic",
        img: "images/Ironbound.jpg",
        coords: [42.0, -66.0] // Coast of Nova Scotia
    },
    {
        tag: "The Queen",
        name: "Nukumi",
        description: "Nicknamed the 'Queen of the Ocean,' she is a massive female who bears the scars of decades of life. Her name means 'Grandmother' in the Mi'kmaq language.",
        type: "Female",
        length: "5.25m",
        weight: "1565.347 kg",
        zone: "Nova Scotia",
        img: "images/Nukumi.jpg",
        coords: [38.5, -73.0]
    },
    {
        tag: "The Artist",
        name: "Breton",
        description: "Internet famous because his GPS track drew a shark shape on the map. He's been monitored for years.",
        type:"Male",
        length: "4m",
        weight: "651.81 kg",
        zone: "The gulf of mexico",
        img: "images/Breton.jpg",
        coords: [25.0, -90.0]
    }
];

let currentSharkIndex = 0;
let map;      // Holds the map object
let marker;   // Holds the red pin

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
    let shark = sharks[currentSharkIndex];

    document.getElementById("shark-type").innerText = shark.type;
    document.getElementById("tag").innerText = shark.tag;
    document.getElementById("shark-name").innerText = shark.name;
    document.getElementById("shark-description").innerText = shark.description;
    document.getElementById("shark-length").innerText = shark.length;
    document.getElementById("shark-weight").innerText = shark.weight;
    document.getElementById("shark-zone").innerText = shark.zone;
    document.getElementById("shark-image").src = shark.img;

    // --- Map animation ---
    // Move Pin
    marker.setLatLng(shark.coords);
    
    // Fly Camera (Zoom level 5)
    map.flyTo(shark.coords, 5, {
        duration: 2.5 // Seconds
    });
}

function nextShark() {
    currentSharkIndex++;
    if (currentSharkIndex >= sharks.length) {
        currentSharkIndex = 0;
    }
    updateDisplay();
}

// Start the Map
initMap();