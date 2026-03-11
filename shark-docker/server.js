const express = require('express');
const cors = require('cors');
const fs = require('fs');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

const SHARKS_FILE = './secret_sharks.json';
const PUBLIC_SHARKS_FILE = './public_sharks.json';
const SIGHTINGS_FILE = './sightings.json';

function readJSON(file){
    if (fs.existsSync(file)){
        return JSON.parse(fs.readFileSync(file));
    }
    return [];
}

function writeJSON(file, data){
    fs.writeFileSync(file, JSON.stringify(data));
}

// GET : obtaining data
app.get('/api/sharks/full-data', (req, res) =>{
    try{
        const fileToRead = fs.existsSync(SHARKS_FILE) ? SHARKS_FILE : PUBLIC_SHARKS_FILE;
        const sharks = readJSON(fileToRead);
        res.json(sharks);
    }catch(err){
        res.json([]);
    }
});

// GET : getting the pins from the users
app.get('/api/sightings/pending', (req, res) => {
    const sightings = readJSON(SIGHTINGS_FILE);
    res.json(sightings);
})

// POST : the administrator "moves" a shark -> for data retrieving
app.post('/api/admin/move-shark', (req, res) => {
    const { sharkIndex, newCoords } = req.body;
    let sharks = readJSON(SHARKS_FILE);

    if (sharks[sharkIndex]){
        sharks[sharksIndex].coords = newCoords;

        if(!sharks[sharksIndex].history) sharks[sharkIndex].history = [];
        sharks[sharkIndex].history.push(newCoords);

        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year:'numeric'});
        sharks[sharkIndex].latestPing = today;

        writeJSON(SHARKS_FILE, sharks);
        res.json({ success: true, message: "The shark has been updated"});
    }else {
        res.status(404).json({ success: false, message: "Shark not found"});
    }
});

// POST: the user reports
app.post('/api/report', (req, res) => {
    const report = req.body;
    report.date = new Date().toLocaleDateString();
    report.id = Date.now();

    const sightings = readJSON(SIGHTINGS_FILE);
    sightings.push(report);
    writeJSON(SIGHTINGS_FILE, sightings);

    res.json({ success: true, message: "The report has been submitted"});
});

// POST: approving the report
app.post('/api/admin/approve-sighting', (req, res) => {
    const { id } = req.body;
    let sightings = readJSON(SIGHTINGS_FILE);
    let sharks = readJSON(SHARKS_FILE);

    const index = sightings.findIndex(s => s.id === id);
    if (index > -1){
        const report = sightings[index];

        const newShark = {
            tag: "Community",
            name: "Unknown Shark",
            description: report.description,
            type: "Unknown",
            length: "?",
            weight: "?",
            zone: "User Reported",
            img: "images/placeholder_shark.jpg",
            coords: report.coords,
            firstPing: report.date,
            latestPing: report.date,
            history: [report.coords]
        };

        sharks.push(newShark);

        sightings.splice(index, 1);

        writeJSON(SHARKS_FILE, sharks);
        writeJSON(SIGHTINGS_FILE, sightings);

        res.json({ success: true});
    }else {
        res.status(404).json({ success: false });
    }
});

// login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'shark123'){
        res.json({ success: true});
    }else {
        res.status(401).json({ success: false, message: 'Wrong password'});
    }
});

app.listen(port, () => {
    console.log(`Server activ pe http://localhost:${port}`);
    if (fs.existsSync(SHARKS_FILE)) {
        console.log("🔒 MOD: PRIVAT (Secret File Loaded)");
    } else {
        console.log("🌍 MOD: PUBLIC (Demo Mode)");
    }
});