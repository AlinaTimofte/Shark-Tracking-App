const express = require('express');
const cors = require('cors');
const fs = require('fs');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.static('public'));

let sharkData = [];

try {

    if (fs.existsSync('./secret_sharks.json')){
        console.log("Private mode: Loading real data...");
        const rawData = fs.readFileSync('./secret_sharks.json');
        sharkData = JSON.parse(rawData);
    }else{
        throw new Error("file do not exist");
    }
}catch (err){

    console.log("Public mode: Loading demo data...");
    const rawData = fs.readFileSync('./public_sharks.json');
    sharkData = JSON.parse(rawData);
}

app.get('/api/sharks/full-data', (req, res) => {
    res.json(sharkData);
});

app.listen(port, () => {
    console.log(`The server runs on: http://localhost:${port}`);
});