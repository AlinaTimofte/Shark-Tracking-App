let sharks = [];
let currentSharkIndex = 0;
let map;
let mainMarker;
let sharkPath;
let startPingMarker;
let endPingMarker;
let isAdmin = false;
let tempClickCoords = null;

const tokenStorageKey = 'sharkTrackerAdminToken';

function getToken() {
    return localStorage.getItem(tokenStorageKey);
}

function authHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function setStatus(message) {
    const status = document.getElementById('security-status');
    if (status) status.innerText = message;
}

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

async function loadSecurityStatus() {
    const response = await fetch('/api/security/status', { headers: authHeaders() });
    const status = await response.json();
    isAdmin = status.authenticated;
    document.body.classList.toggle('admin-mode', isAdmin);
    document.getElementById('login-panel').classList.toggle('hidden', isAdmin);
    document.getElementById('admin-panel').classList.toggle('hidden', !isAdmin);
    setStatus(isAdmin ? 'Admin mode: exact encrypted coordinates unlocked' : 'Public mode: approximate coordinates only');
}

async function loadSharkData() {
    try {
        await loadSecurityStatus();
        const response = await fetch('/api/sharks/full-data', { headers: authHeaders() });
        sharks = await response.json();
        currentSharkIndex = Math.min(currentSharkIndex, Math.max(sharks.length - 1, 0));

        if (!map) {
            initMap();
        } else {
            updateDisplay();
        }

        if (isAdmin) loadPendingSightings();
    } catch (error) {
        console.error('Connecting error:', error);
        alert("I can't connect with the server. Make sure node server.js is running.");
    }
}

function initMap() {
    const worldBounds = [
        [-90, -180],
        [90, 180]
    ];

    map = L.map('map', {
        minZoom: 2,
        maxBounds: worldBounds,
        maxBoundsViscosity: 1.0
    }).setView([0, 0], 2);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        noWrap: true,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    map.on('click', (event) => {
        tempClickCoords = [event.latlng.lat, event.latlng.lng];

        if (isAdmin) {
            document.getElementById('move-coords').innerText = `${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`;
            document.getElementById('move-button').disabled = false;
            setStatus('Admin selected exact coordinates for shark movement');
        } else {
            document.getElementById('click-coords').innerText = `${event.latlng.lat.toFixed(4)}, ${event.latlng.lng.toFixed(4)}`;
            document.getElementById('report-modal').classList.remove('hidden');
        }
    });

    updateDisplay();
}

function updateDisplay() {
    if (sharks.length === 0) return;

    const shark = sharks[currentSharkIndex];

    document.getElementById('shark-type').innerText = shark.type;
    document.getElementById('tag').innerText = shark.tag;
    document.getElementById('shark-name').innerText = shark.name;
    document.getElementById('shark-description').innerText = shark.description;
    document.getElementById('shark-length').innerText = shark.length;
    document.getElementById('shark-weight').innerText = shark.weight;
    document.getElementById('shark-zone').innerText = shark.zone;
    document.getElementById('shark-image').src = shark.img;
    document.getElementById('precision-label').innerText = shark.precision || 'public';

    if (mainMarker) map.removeLayer(mainMarker);
    if (sharkPath) map.removeLayer(sharkPath);
    if (startPingMarker) map.removeLayer(startPingMarker);
    if (endPingMarker) map.removeLayer(endPingMarker);

    let markerColor = '#ef4444';
    let markerRadius = 8;

    if (shark.isUserReport) {
        markerColor = '#a855f7';
        markerRadius = 10;
    }

    if (shark.coords) {
        mainMarker = L.circleMarker(shark.coords, {
            radius: markerRadius,
            fillColor: markerColor,
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(map);
        mainMarker.bindPopup(`<strong>${shark.name}</strong><br>${shark.tag}<br>${shark.precision || ''}`);
    }

    if (shark.history && shark.history.length > 1) {
        const smooth = makeSmoothCurve(shark.history, 4);
        sharkPath = L.polyline(smooth, {
            color: '#fbbf24',
            weight: 2,
            opacity: 0.8,
            smoothFactor: 1
        }).addTo(map);

        const startPoint = shark.history[0];
        const endPoint = shark.history[shark.history.length - 1];

        startPingMarker = L.circleMarker(startPoint, {
            radius: 4,
            fillColor: '#ffffff',
            color: '#000',
            weight: 1,
            fillOpacity: 1
        }).addTo(map);

        endPingMarker = L.circleMarker(endPoint, {
            radius: 4,
            fillColor: markerColor,
            color: '#ffffff',
            weight: 1,
            fillOpacity: 1
        }).addTo(map);

        map.fitBounds(sharkPath.getBounds(), { padding: [50, 50] });
    } else if (shark.coords) {
        map.flyTo(shark.coords, 5, { duration: 2.0 });
    }
}

function nextShark() {
    currentSharkIndex++;
    if (currentSharkIndex >= sharks.length) currentSharkIndex = 0;
    updateDisplay();
}

async function loginAdmin(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const result = await response.json();

    if (!response.ok) {
        setStatus(result.message || 'Login failed');
        return;
    }

    localStorage.setItem(tokenStorageKey, result.token);
    document.getElementById('password').value = '';
    setStatus('Admin authenticated');
    loadSharkData();
}

async function logoutAdmin() {
    await fetch('/api/logout', {
        method: 'POST',
        headers: { ...authHeaders() }
    }).catch(() => {});
    localStorage.removeItem(tokenStorageKey);
    tempClickCoords = null;
    document.getElementById('move-button').disabled = true;
    loadSharkData();
}

async function submitReport(event) {
    event.preventDefault();
    if (!tempClickCoords) return;

    const description = document.getElementById('report-description').value;
    const reporter = document.getElementById('reporter').value;
    const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, reporter, coords: tempClickCoords })
    });
    const result = await response.json();

    if (response.ok) {
        closeReportModal();
        setStatus(result.message);
        document.getElementById('report-form').reset();
    } else {
        setStatus(result.message || 'Report could not be submitted');
    }
}

function closeReportModal() {
    document.getElementById('report-modal').classList.add('hidden');
}

async function moveCurrentShark() {
    if (!tempClickCoords) return;

    const response = await fetch('/api/admin/move-shark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ sharkIndex: currentSharkIndex, newCoords: tempClickCoords })
    });
    const result = await response.json();
    setStatus(result.message || 'Move request completed');

    if (response.ok) {
        tempClickCoords = null;
        document.getElementById('move-button').disabled = true;
        document.getElementById('move-coords').innerText = 'Click the map';
        loadSharkData();
    }
}

async function loadPendingSightings() {
    const list = document.getElementById('pending-list');
    list.innerHTML = '<li>Loading signed reports...</li>';

    const response = await fetch('/api/sightings/pending', { headers: authHeaders() });
    if (!response.ok) {
        list.innerHTML = '<li>Admin token required.</li>';
        return;
    }

    const sightings = await response.json();
    if (sightings.length === 0) {
        list.innerHTML = '<li>No pending community sightings.</li>';
        return;
    }

    list.innerHTML = '';
    sightings.forEach((sighting) => {
        const item = document.createElement('li');
        item.innerHTML = `
            <strong>${sighting.reporter}</strong>
            <span>${sighting.description}</span>
            <small>${sighting.coords.map((coord) => Number(coord).toFixed(4)).join(', ')} | signature: ${sighting.validSignature ? 'valid' : 'invalid'}</small>
            <button ${sighting.validSignature ? '' : 'disabled'} onclick="approveSighting(${sighting.id})">Approve</button>
        `;
        list.appendChild(item);
    });
}

async function approveSighting(id) {
    const response = await fetch('/api/admin/approve-sighting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id })
    });
    const result = await response.json();
    setStatus(result.message || (response.ok ? 'Signed report approved' : 'Report rejected'));
    loadSharkData();
}

document.getElementById('login-form').addEventListener('submit', loginAdmin);
document.getElementById('logout-button').addEventListener('click', logoutAdmin);
document.getElementById('report-form').addEventListener('submit', submitReport);
document.getElementById('close-report').addEventListener('click', closeReportModal);
document.getElementById('move-button').addEventListener('click', moveCurrentShark);

loadSharkData();
